import { and, asc, eq, inArray } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { clinicHours, dentists, entries, patients, treatments } from "@/lib/db/schema";
import { getDaySlots } from "@/lib/booking/availability";
import { addDays, atIstanbul, istanbulDateOf, istanbulTimeOf, weekdayOf } from "@/lib/time";
import { DEMO_FLOOR } from "@/config/booking";

/** The demo server's database (see playwright.config). */
const URL = "postgres://clinic:clinic@localhost:5433/clinic_e2e";

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = createDb(URL);
  try {
    return await fn(db);
  } finally {
    await db.$client.end();
  }
}

/**
 * A weekday outside the demo capacity floor (today plus the next open days) but inside the
 * seeded fortnight, so staff moves and blocks there never trip the floor.
 */
export async function quietDate(now = new Date()): Promise<string> {
  return withDb(async (db) => {
    const open = new Set(
      (await db.select().from(clinicHours)).filter((h) => h.open).map((h) => h.weekday),
    );
    const today = istanbulDateOf(now);
    let d = today;
    for (let n = 1; n < DEMO_FLOOR.days; ) {
      d = addDays(d, 1);
      if (open.has(weekdayOf(d))) n++;
    }
    d = addDays(d, 1);
    while (!open.has(weekdayOf(d)) || weekdayOf(d) === 6) d = addDays(d, 1);
    return d;
  });
}

type Appt = { id: string; dentistId: number; treatmentId: number; start: Date; end: Date };

async function bookedOn(db: Db, date: string): Promise<Appt[]> {
  const rows = await db
    .select({ id: entries.id, dentistId: entries.dentistId, treatmentId: entries.treatmentId, during: entries.during })
    .from(entries)
    .where(and(eq(entries.kind, "appointment"), eq(entries.active, true), eq(entries.status, "booked")))
    .orderBy(asc(entries.during));
  return rows
    .filter((r) => r.treatmentId !== null && istanbulDateOf(r.during.start) === date)
    .map((r) => ({ id: r.id, dentistId: r.dentistId, treatmentId: r.treatmentId!, start: r.during.start, end: r.during.end }));
}

/**
 * A booked appointment that can move `deltaMin` later on its own calendar: on `date`, or failing
 * that on a later quiet weekday of the seeded fortnight (repeated runs use up the easy ones).
 */
export async function findMovable(date: string, deltaMin: number) {
  const last = addDays(date, 7);
  for (let d = date; d <= last; d = addDays(d, 1)) {
    if (weekdayOf(d) === 0 || weekdayOf(d) === 6) continue;
    const found = await findMovableOn(d, deltaMin);
    if (found) return { ...found, date: d };
  }
  throw new Error(`no appointment movable by ${deltaMin} min from ${date}`);
}

async function findMovableOn(date: string, deltaMin: number) {
  return withDb(async (db) => {
    const now = new Date();
    for (const a of await bookedOn(db, date)) {
      const target = new Date(a.start.getTime() + deltaMin * 60_000);
      if (istanbulDateOf(target) !== date) continue;
      const slots = await getDaySlots(db, {
        treatmentId: a.treatmentId,
        dentistId: a.dentistId,
        date,
        now,
        audience: "staff",
        ignoreEntryId: a.id,
      });
      if (slots.some((s) => s.start.getTime() === target.getTime())) {
        return { id: a.id, dentistId: a.dentistId, from: istanbulTimeOf(a.start), to: istanbulTimeOf(target) };
      }
    }
    return null;
  });
}

/** Two booked appointments of one dentist on `date`: dragging `id` onto `onto` must be refused. */
export async function findClash(date: string) {
  return withDb(async (db) => {
    const list = await bookedOn(db, date);
    for (const a of list) {
      const b = list.find((x) => x.dentistId === a.dentistId && x.id !== a.id && x.start.getTime() > a.end.getTime());
      if (b) return { id: a.id, from: istanbulTimeOf(a.start), onto: istanbulTimeOf(b.start), dentistId: a.dentistId };
    }
    throw new Error(`no clash pair on ${date}`);
  });
}

/** A free 30-minute window on `date` (any dentist), e.g. for a block. */
export async function freeWindow(date: string) {
  return withDb(async (db) => {
    const [t] = await db.select({ id: treatments.id }).from(treatments).where(eq(treatments.slug, "checkup"));
    const slots = await getDaySlots(db, { treatmentId: t.id, dentistId: "any", date, now: new Date(), audience: "staff" });
    const s = slots[Math.floor(slots.length / 2)];
    if (!s) throw new Error(`no free window on ${date}`);
    const [d] = await db.select({ name: dentists.name }).from(dentists).where(eq(dentists.id, s.dentistIds[0]));
    return {
      dentistId: s.dentistIds[0],
      dentistName: d.name,
      start: istanbulTimeOf(s.start),
      end: istanbulTimeOf(new Date(s.start.getTime() + 30 * 60_000)),
    };
  });
}

/** Current status of some entries, straight from the database. */
export async function entryRows(ids: string[]) {
  return withDb(async (db) => {
    const rows = await db
      .select({ id: entries.id, during: entries.during, status: entries.status, dentistId: entries.dentistId })
      .from(entries)
      .where(inArray(entries.id, ids));
    return rows.map((r) => ({ ...r, start: istanbulTimeOf(r.during.start), date: istanbulDateOf(r.during.start) }));
  });
}

/**
 * An active booked appointment at `from`–`to` on `date` for the first dentist, inserted directly
 * (as if the admin later shrank the hours). Returns its id and a cleanup function.
 */
export async function insertOutsideHours(date: string, from: string, to: string) {
  return withDb(async (db) => {
    const [d] = await db.select({ id: dentists.id }).from(dentists).orderBy(asc(dentists.sortOrder)).limit(1);
    const [t] = await db.select({ id: treatments.id }).from(treatments).where(eq(treatments.slug, "checkup"));
    const phone = `+90532${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    const [p] = await db
      .insert(patients)
      .values({ name: "Early Bird Kaya", phoneE164: phone, email: "early@example.com", locale: "en" })
      .returning({ id: patients.id });
    const [e] = await db
      .insert(entries)
      .values({
        dentistId: d.id,
        kind: "appointment",
        during: { start: atIstanbul(date, from), end: atIstanbul(date, to) },
        treatmentId: t.id,
        patientId: p.id,
        status: "booked",
        source: "staff",
        createdBy: "e2e",
      })
      .returning({ id: entries.id });
    return {
      id: e.id,
      dentistId: d.id,
      cleanup: () =>
        withDb(async (db2) => {
          await db2.delete(entries).where(eq(entries.id, e.id));
          await db2.delete(patients).where(eq(patients.id, p.id));
        }),
    };
  });
}

export { atIstanbul };
