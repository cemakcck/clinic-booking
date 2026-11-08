import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { dentists, entries, treatments } from "@/lib/db/schema";
import { overlaps } from "@/lib/db/range";
import { HOLD_MINUTES } from "@/config/booking";
import { addDays, atIstanbul, istanbulDateOf } from "@/lib/time";
import { pickAnyDentist } from "@/lib/slots/engine";
import type { Locale } from "@/i18n/routing";
import { assertBookable, getDaySlots } from "./availability";
import { BookingError } from "./errors";
import { insertEntry, updateEntryRange } from "./entries";
import { upsertPatient } from "./patients";
import { checkAndRecordRate } from "@/lib/security/rate-limit";
import { hashToken, newToken } from "@/lib/security/tokens";

const MIN = 60_000;

export type PlacedHold = { holdId: string; holdToken: string; dentistId: number; expiresAt: Date };

/**
 * A slot that fails the rules check is `slot_taken` when a live entry (appointment, block or
 * unexpired hold) overlaps it, which is what a loser of a race sees; otherwise `outside_rules`.
 */
async function notBookableReason(
  db: Db,
  dentistId: number | null,
  range: { start: Date; end: Date },
  now: Date,
): Promise<BookingError> {
  const rows = await db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        dentistId === null ? sql`true` : eq(entries.dentistId, dentistId),
        eq(entries.active, true),
        overlaps(entries.during, range),
        or(isNull(entries.expiresAt), gt(entries.expiresAt, now)),
      ),
    )
    .limit(1);
  return new BookingError(rows.length ? "slot_taken" : "outside_rules");
}

export async function placeHold(
  db: Db,
  q: { treatmentId: number; dentistId: number | "any"; start: Date; now: Date; ipHash: string },
): Promise<PlacedHold> {
  await checkAndRecordRate(db, "hold", q.ipHash, q.now);

  const [t] = await db
    .select({ d: treatments.durationMin })
    .from(treatments)
    .where(and(eq(treatments.id, q.treatmentId), eq(treatments.active, true)));
  if (!t) throw new BookingError("not_found");
  const range = { start: q.start, end: new Date(q.start.getTime() + t.d * MIN) };

  let order: number[];
  if (q.dentistId === "any") {
    const date = istanbulDateOf(q.start);
    const slots = await getDaySlots(db, {
      treatmentId: q.treatmentId,
      dentistId: "any",
      date,
      now: q.now,
      audience: "public",
    });
    const ids = slots.find((s) => s.start.getTime() === q.start.getTime())?.dentistIds ?? [];
    if (ids.length === 0) throw await notBookableReason(db, null, range, q.now);
    const info = await db
      .select({
        id: dentists.id,
        sortOrder: dentists.sortOrder,
        dayCount: sql<number>`(
          SELECT count(*)::int FROM entries e
          WHERE e.dentist_id = "dentists"."id" AND e.kind = 'appointment' AND e.active
            AND e.during && tstzrange(${atIstanbul(date, "00:00").toISOString()}::timestamptz, ${atIstanbul(addDays(date, 1), "00:00").toISOString()}::timestamptz, '[)'))`,
      })
      .from(dentists);
    const remaining = info
      .filter((d) => ids.includes(d.id))
      .map((d) => ({ dentistId: d.id, sortOrder: d.sortOrder, dayCount: d.dayCount }));
    order = [];
    while (remaining.length) {
      const next = pickAnyDentist(remaining)!;
      order.push(next);
      remaining.splice(remaining.findIndex((c) => c.dentistId === next), 1);
    }
  } else {
    try {
      await assertBookable(db, {
        treatmentId: q.treatmentId,
        dentistId: q.dentistId,
        start: q.start,
        now: q.now,
        audience: "public",
      });
    } catch (e) {
      if (e instanceof BookingError && e.code === "outside_rules") {
        throw await notBookableReason(db, q.dentistId, range, q.now);
      }
      throw e;
    }
    order = [q.dentistId];
  }

  const holdToken = newToken();
  const expiresAt = new Date(q.now.getTime() + HOLD_MINUTES * MIN);
  for (const dentistId of order) {
    try {
      // Own transaction per attempt: a constraint violation aborts the transaction it happens in.
      const holdId = await db.transaction((tx) =>
        insertEntry(
          tx,
          {
            dentistId,
            kind: "hold",
            during: range,
            expiresAt,
            holdTokenHash: hashToken(holdToken),
            treatmentId: q.treatmentId,
          },
          q.now,
        ),
      );
      return { holdId, holdToken, dentistId, expiresAt };
    } catch (e) {
      if (!(e instanceof BookingError && e.code === "slot_taken")) throw e;
    }
  }
  throw new BookingError("slot_taken");
}

export type ConfirmedBooking = {
  appointmentId: string;
  manageToken: string;
  start: Date;
  end: Date;
  dentistId: number;
  treatmentId: number;
  created: boolean;
};

export async function confirmBooking(
  db: Db,
  q: {
    holdId: string;
    holdToken: string;
    patient: { name: string; phone: string; email: string; locale: Locale };
    now: Date;
    ipHash: string;
    demoOwner?: string;
  },
): Promise<ConfirmedBooking> {
  // Every call counts against the limit, including idempotent repeats.
  await checkAndRecordRate(db, "confirm", q.ipHash, q.now);

  return db.transaction(async (tx) => {
    // FOR UPDATE serialises concurrent double submits of the same hold.
    const [row] = await tx.select().from(entries).where(eq(entries.id, q.holdId)).for("update");
    if (!row) throw new BookingError("hold_expired");
    if (!row.holdTokenHash || row.holdTokenHash !== hashToken(q.holdToken)) throw new BookingError("not_found");
    if (row.treatmentId === null) throw new BookingError("not_found");
    const treatmentId = row.treatmentId;
    const result = (manageToken: string, created: boolean): ConfirmedBooking => ({
      appointmentId: row.id,
      manageToken,
      start: row.during.start,
      end: row.during.end,
      dentistId: row.dentistId,
      treatmentId,
      created,
    });

    const manageToken = newToken();
    if (row.kind === "appointment") {
      await tx
        .update(entries)
        .set({ manageTokenHash: hashToken(manageToken), updatedAt: q.now })
        .where(eq(entries.id, row.id));
      return result(manageToken, false);
    }
    if (row.kind !== "hold") throw new BookingError("not_found");

    if (row.expiresAt && row.expiresAt <= q.now) {
      try {
        await assertBookable(tx, {
          treatmentId,
          dentistId: row.dentistId,
          start: row.during.start,
          now: q.now,
          audience: "public",
          ignoreEntryId: row.id,
        });
        await updateEntryRange(tx, row.id, row.dentistId, row.during, q.now);
      } catch (e) {
        if (e instanceof BookingError && (e.code === "slot_taken" || e.code === "outside_rules")) {
          throw new BookingError("hold_expired");
        }
        throw e;
      }
    }

    const patientId = await upsertPatient(tx, q.patient);
    await tx
      .update(entries)
      .set({
        kind: "appointment",
        expiresAt: null,
        status: "booked",
        source: "online",
        patientId,
        manageTokenHash: hashToken(manageToken),
        createdBy: q.demoOwner ?? null,
        updatedAt: q.now,
      })
      .where(eq(entries.id, row.id));
    return result(manageToken, true);
  });
}
