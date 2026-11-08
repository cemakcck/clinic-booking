import { and, asc, eq, inArray, ne, or, gt, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import {
  clinicHours,
  clinicSettings,
  closedDates,
  dentists,
  dentistTreatments,
  entries,
  treatments,
  workingHours,
} from "@/lib/db/schema";
import { overlaps } from "@/lib/db/range";
import { addDays, atIstanbul, istanbulDateOf, weekdayOf } from "@/lib/time";
import { computeSlots, effectiveHours, type Interval } from "@/lib/slots/engine";
import {
  DEMO_FLOOR,
  PUBLIC_HORIZON_DAYS,
  PUBLIC_MIN_LEAD_MIN,
  STAFF_HORIZON_DAYS,
  STAFF_MIN_LEAD_MIN,
} from "@/config/booking";
import { BookingError } from "./errors";

export type Audience = "public" | "staff";

const rules = (a: Audience) =>
  a === "public"
    ? { minLeadMin: PUBLIC_MIN_LEAD_MIN, horizonDays: PUBLIC_HORIZON_DAYS }
    : { minLeadMin: STAFF_MIN_LEAD_MIN, horizonDays: STAFF_HORIZON_DAYS };

type Candidates = { treatmentId: number | null; dentistId: number | "any" };

/**
 * Per-dentist free start times for one day, in at most 4 queries:
 * candidate dentists, hours (working + clinic + lunch), closed date, entries.
 */
async function dentistStarts(
  db: DbOrTx,
  c: Candidates & { date: string; durationMin: number; now: Date; audience: Audience; ignoreEntryId?: string },
): Promise<Map<number, Date[]>> {
  const out = new Map<number, Date[]>();

  const cond = [eq(dentists.active, true)];
  if (c.dentistId !== "any") cond.push(eq(dentists.id, c.dentistId));
  const cands =
    c.treatmentId === null
      ? await db
          .select({ id: dentists.id })
          .from(dentists)
          .where(and(...cond))
          .orderBy(asc(dentists.sortOrder), asc(dentists.id))
      : await db
          .select({ id: dentists.id })
          .from(dentists)
          .innerJoin(
            dentistTreatments,
            and(eq(dentistTreatments.dentistId, dentists.id), eq(dentistTreatments.treatmentId, c.treatmentId)),
          )
          .where(and(...cond))
          .orderBy(asc(dentists.sortOrder), asc(dentists.id));
  const ids = cands.map((r) => r.id);
  if (ids.length === 0) return out;

  const wd = weekdayOf(c.date);
  const dayStart = atIstanbul(c.date, "00:00");
  const dayEnd = atIstanbul(addDays(c.date, 1), "00:00");

  const [hoursRows, closedRows, entryRows] = await Promise.all([
    db
      .select({
        dentistId: workingHours.dentistId,
        start: workingHours.start,
        end: workingHours.end,
        open: clinicHours.open,
        close: clinicHours.close,
        lunchStart: clinicSettings.lunchStart,
        lunchEnd: clinicSettings.lunchEnd,
      })
      .from(workingHours)
      .leftJoin(clinicHours, eq(clinicHours.weekday, workingHours.weekday))
      .leftJoin(clinicSettings, eq(clinicSettings.id, 1))
      .where(and(inArray(workingHours.dentistId, ids), eq(workingHours.weekday, wd))),
    db.select({ date: closedDates.date }).from(closedDates).where(eq(closedDates.date, c.date)),
    db
      .select({ dentistId: entries.dentistId, during: entries.during })
      .from(entries)
      .where(
        and(
          inArray(entries.dentistId, ids),
          eq(entries.active, true),
          overlaps(entries.during, { start: dayStart, end: dayEnd }),
          or(ne(entries.kind, "hold"), isNull(entries.expiresAt), gt(entries.expiresAt, c.now)),
          c.ignoreEntryId ? ne(entries.id, c.ignoreEntryId) : sql`true`,
        ),
      ),
  ]);

  const closed = closedRows.length > 0;
  const busy = new Map<number, Interval[]>();
  for (const e of entryRows) {
    const list = busy.get(e.dentistId) ?? [];
    list.push(e.during);
    busy.set(e.dentistId, list);
  }
  const hoursBy = new Map(hoursRows.map((h) => [h.dentistId, h]));

  for (const id of ids) {
    const h = hoursBy.get(id);
    const clinic = h?.open && h.close ? { start: h.open, end: h.close } : null;
    const lunch = h?.lunchStart && h.lunchEnd ? { start: h.lunchStart, end: h.lunchEnd } : null;
    const hours = effectiveHours(clinic, h ? { start: h.start, end: h.end } : null, lunch);
    out.set(
      id,
      computeSlots({
        date: c.date,
        durationMin: c.durationMin,
        hours,
        closed,
        busy: busy.get(id) ?? [],
        now: c.now,
        ...rules(c.audience),
      }),
    );
  }
  return out;
}

async function durationOf(db: DbOrTx, treatmentId: number): Promise<number | null> {
  const [t] = await db
    .select({ d: treatments.durationMin })
    .from(treatments)
    .where(and(eq(treatments.id, treatmentId), eq(treatments.active, true)));
  return t?.d ?? null;
}

export async function getDaySlots(
  db: DbOrTx,
  q: {
    treatmentId: number;
    dentistId: number | "any";
    date: string;
    now: Date;
    audience: Audience;
    ignoreEntryId?: string;
  },
): Promise<{ start: Date; dentistIds: number[] }[]> {
  const durationMin = await durationOf(db, q.treatmentId);
  if (durationMin === null) return [];
  const per = await dentistStarts(db, { ...q, durationMin });
  const merged = new Map<number, number[]>();
  for (const [id, starts] of per) {
    for (const s of starts) {
      const k = s.getTime();
      const l = merged.get(k) ?? [];
      l.push(id);
      merged.set(k, l);
    }
  }
  return [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, ids]) => ({ start: new Date(t), dentistIds: ids.sort((a, b) => a - b) }));
}

export async function getDayStrip(
  db: DbOrTx,
  q: {
    treatmentId: number;
    dentistId: number | "any";
    from: string;
    days: number;
    now: Date;
    audience: Audience;
    ignoreEntryId?: string;
  },
): Promise<{ date: string; available: boolean }[]> {
  const out: { date: string; available: boolean }[] = [];
  for (let i = 0; i < q.days; i++) {
    const date = addDays(q.from, i);
    const slots = await getDaySlots(db, { ...q, date });
    out.push({ date, available: slots.length > 0 });
  }
  return out;
}

export async function nextFreeSlot(
  db: DbOrTx,
  now: Date,
): Promise<{ start: Date; dentistId: number; treatmentId: number } | null> {
  const [t] = await db
    .select({ id: treatments.id })
    .from(treatments)
    .where(eq(treatments.active, true))
    .orderBy(asc(treatments.durationMin), asc(treatments.sortOrder), asc(treatments.id))
    .limit(1);
  if (!t) return null;
  const today = istanbulDateOf(now);
  for (let i = 0; i < 14; i++) {
    const slots = await getDaySlots(db, {
      treatmentId: t.id,
      dentistId: "any",
      date: addDays(today, i),
      now,
      audience: "public",
    });
    if (slots.length > 0) return { start: slots[0].start, dentistId: slots[0].dentistIds[0], treatmentId: t.id };
  }
  return null;
}

export async function countPublicSlots(db: DbOrTx, date: string, now: Date): Promise<number> {
  const per = await dentistStarts(db, {
    treatmentId: null,
    dentistId: "any",
    date,
    durationMin: DEMO_FLOOR.probeDurationMin,
    now,
    audience: "public",
  });
  let n = 0;
  for (const s of per.values()) n += s.length;
  return n;
}

export async function assertBookable(
  db: DbOrTx,
  q: {
    treatmentId: number;
    dentistId: number;
    start: Date;
    now: Date;
    audience: Audience;
    ignoreEntryId?: string;
  },
): Promise<void> {
  const slots = await getDaySlots(db, { ...q, date: istanbulDateOf(q.start) });
  const t = q.start.getTime();
  if (!slots.some((s) => s.start.getTime() === t && s.dentistIds.includes(q.dentistId))) {
    throw new BookingError("outside_rules");
  }
}

/**
 * Why a start time failed the rules check: `slot_taken` when a live entry (appointment, block or
 * unexpired hold, other than `ignoreEntryId`) overlaps the range, which is what the loser of a
 * race sees; otherwise `outside_rules`. `dentistId` null checks every dentist.
 */
export async function notBookableReason(
  db: DbOrTx,
  dentistId: number | null,
  range: Interval,
  now: Date,
  ignoreEntryId?: string,
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
        ignoreEntryId ? ne(entries.id, ignoreEntryId) : sql`true`,
      ),
    )
    .limit(1);
  return new BookingError(rows.length ? "slot_taken" : "outside_rules");
}

/** assertBookable, but a time that is only blocked by a live entry gives `slot_taken`. */
export async function assertBookableOrTaken(
  db: DbOrTx,
  q: Parameters<typeof assertBookable>[1] & { end: Date },
): Promise<void> {
  try {
    await assertBookable(db, q);
  } catch (e) {
    if (e instanceof BookingError && e.code === "outside_rules") {
      throw await notBookableReason(db, q.dentistId, { start: q.start, end: q.end }, q.now, q.ignoreEntryId);
    }
    throw e;
  }
}
