import { randomUUID } from "node:crypto";
import { and, asc, eq, or } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/lib/db/client";
import { blockReason, entries, patients } from "@/lib/db/schema";
import { overlaps } from "@/lib/db/range";
import type { Actor } from "@/lib/auth/roles";
import { can } from "@/lib/auth/permissions";
import { insertEntry, lockDentists, updateEntryRange } from "@/lib/booking/entries";
import { BookingError } from "@/lib/booking/errors";
import { guardCapacity } from "@/lib/demo/floor";
import type { Interval } from "@/lib/slots/engine";
import { addDays, istanbulDateOf } from "@/lib/time";

export type BlockReason = (typeof blockReason.enumValues)[number];

export type BlockConflict = { appointmentId: string; start: string; patientName: string; occurrenceStart: string };

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** One block (one occurrence) spans at most this long, e.g. a few weeks of leave. */
const MAX_BLOCK_DAYS = 31;
const MAX_SERIES = 52;
const NOTE_MAX = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validRange(start: Date, end: Date): boolean {
  return (
    start instanceof Date &&
    end instanceof Date &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    start < end &&
    end.getTime() - start.getTime() <= MAX_BLOCK_DAYS * DAY_MS
  );
}

function cleanFields(reason: BlockReason, note: string | undefined): { reason: BlockReason; note: string | null } {
  if (!(blockReason.enumValues as readonly string[]).includes(reason)) throw new BookingError("invalid");
  const n = note?.trim() ?? "";
  if (n.length > NOTE_MAX) throw new BookingError("invalid");
  return { reason, note: n || null };
}

/**
 * The block's occurrences: just the one, or weekly copies for `count` weeks (≤ 52, counting the
 * first) and/or until the date `until` (Istanbul, inclusive, ≤ 1 year after the first).
 * Istanbul has no DST, so a week is always 7 × 24 hours.
 */
export function expandWeekly(first: Interval, repeat?: { count?: number; until?: string }): Interval[] {
  if (!repeat) return [first];
  const { count, until } = repeat;
  if (count === undefined && until === undefined) throw new BookingError("invalid");
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > MAX_SERIES)) {
    throw new BookingError("invalid");
  }
  const firstDate = istanbulDateOf(first.start);
  if (until !== undefined && (!DATE_RE.test(until) || until < firstDate || until > addDays(firstDate, 365))) {
    throw new BookingError("invalid");
  }
  // Longer than a week would overlap the next copy.
  if (first.end.getTime() - first.start.getTime() > WEEK_MS) throw new BookingError("invalid");
  const out: Interval[] = [];
  for (let i = 0; i < (count ?? MAX_SERIES); i++) {
    const o = { start: new Date(first.start.getTime() + i * WEEK_MS), end: new Date(first.end.getTime() + i * WEEK_MS) };
    if (until !== undefined && istanbulDateOf(o.start) > until) break;
    out.push(o);
  }
  return out;
}

/** Live appointments of the dentist overlapping any occurrence, one row per (appointment, occurrence). */
async function findConflicts(tx: DbOrTx, dentistId: number, occ: Interval[]): Promise<BlockConflict[]> {
  const rows = await tx
    .select({ id: entries.id, during: entries.during, patientName: patients.name })
    .from(entries)
    .leftJoin(patients, eq(patients.id, entries.patientId))
    .where(
      and(
        eq(entries.dentistId, dentistId),
        eq(entries.kind, "appointment"),
        eq(entries.active, true),
        or(...occ.map((o) => overlaps(entries.during, o))),
      ),
    )
    .orderBy(asc(entries.during));
  const out: BlockConflict[] = [];
  for (const o of occ) {
    for (const r of rows) {
      if (r.during.start < o.end && o.start < r.during.end) {
        out.push({
          appointmentId: r.id,
          start: r.during.start.toISOString(),
          patientName: r.patientName ?? "",
          occurrenceStart: o.start.toISOString(),
        });
      }
    }
  }
  return out;
}

async function assertNoConflicts(tx: DbOrTx, dentistId: number, occ: Interval[]): Promise<void> {
  const conflicts = await findConflicts(tx, dentistId, occ);
  if (conflicts.length) throw new BookingError("block_conflict", { conflicts });
}

/**
 * Blocks time for a dentist, optionally weekly. Refused with `block_conflict` (listing every
 * clashing appointment) when any occurrence overlaps an appointment; an active hold or another
 * block gives `slot_taken`. All or nothing, in one transaction.
 */
export async function createBlock(
  db: Db,
  actor: Actor,
  q: {
    dentistId: number;
    start: Date;
    end: Date;
    reason: BlockReason;
    note?: string;
    repeatWeekly?: { count?: number; until?: string };
    now: Date;
  },
): Promise<{ seriesId: string | null; entryIds: string[] }> {
  if (!can(actor, "block.manage", { dentistId: q.dentistId })) throw new BookingError("forbidden");
  if (!validRange(q.start, q.end)) throw new BookingError("invalid");
  const fields = cleanFields(q.reason, q.note);
  const occ = expandWeekly({ start: q.start, end: q.end }, q.repeatWeekly);
  const seriesId = q.repeatWeekly ? randomUUID() : null;

  const entryIds = await db.transaction((tx) =>
    guardCapacity(tx, q.now, async () => {
      // Under the dentist lock no appointment can appear between the check and the inserts.
      await lockDentists(tx, [q.dentistId]);
      await assertNoConflicts(tx, q.dentistId, occ);
      const ids: string[] = [];
      for (const o of occ) {
        ids.push(
          await insertEntry(
            tx,
            {
              dentistId: q.dentistId,
              kind: "block",
              during: o,
              blockReason: fields.reason,
              blockNote: fields.note,
              seriesId,
              createdBy: actor.userId,
              updatedAt: q.now,
            },
            q.now,
          ),
        );
      }
      return ids;
    }),
  );
  return { seriesId, entryIds };
}

/** Locks the block's dentist, then the row; `not_found` unless it is a block. */
async function lockBlock(tx: DbOrTx, actor: Actor, entryId: string) {
  if (!z.uuid().safeParse(entryId).success) throw new BookingError("not_found");
  const [peek] = await tx
    .select({ dentistId: entries.dentistId, kind: entries.kind })
    .from(entries)
    .where(eq(entries.id, entryId));
  if (!peek || peek.kind !== "block") throw new BookingError("not_found");
  if (!can(actor, "block.manage", { dentistId: peek.dentistId })) throw new BookingError("forbidden");
  await lockDentists(tx, [peek.dentistId]);
  const [row] = await tx.select().from(entries).where(eq(entries.id, entryId)).for("update");
  if (!row || row.kind !== "block") throw new BookingError("not_found");
  // Blocks never change dentist, so the lock we hold is the right one.
  return row;
}

/** Changes one block (one occurrence of a series), with the same conflict rule as createBlock. */
export async function updateBlock(
  db: Db,
  actor: Actor,
  q: { entryId: string; start: Date; end: Date; reason: BlockReason; note?: string; now: Date },
): Promise<void> {
  if (!validRange(q.start, q.end)) throw new BookingError("invalid");
  const fields = cleanFields(q.reason, q.note);
  await db.transaction((tx) =>
    guardCapacity(tx, q.now, async () => {
      const row = await lockBlock(tx, actor, q.entryId);
      const range = { start: q.start, end: q.end };
      await assertNoConflicts(tx, row.dentistId, [range]);
      await updateEntryRange(tx, row.id, row.dentistId, range, q.now);
      await tx
        .update(entries)
        .set({ blockReason: fields.reason, blockNote: fields.note, updatedAt: q.now })
        .where(eq(entries.id, row.id));
    }),
  );
}

/** Deletes one block, or with `wholeSeries` every occurrence of its series. */
export async function deleteBlock(db: Db, actor: Actor, q: { entryId: string; wholeSeries?: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockBlock(tx, actor, q.entryId);
    const where =
      q.wholeSeries && row.seriesId
        ? and(eq(entries.seriesId, row.seriesId), eq(entries.kind, "block"), eq(entries.dentistId, row.dentistId))
        : eq(entries.id, row.id);
    await tx.delete(entries).where(where);
  });
}
