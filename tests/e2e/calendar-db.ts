import { and, asc, eq, inArray } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { callbackRequests, clinicHours, dentists, entries, patients, treatments } from "@/lib/db/schema";
import { getDaySlots } from "@/lib/booking/availability";
import { addDays, atIstanbul, istanbulDateOf, istanbulTimeOf, weekdayOf } from "@/lib/time";
import { DEMO_FLOOR, PUBLIC_MIN_LEAD_MIN } from "@/config/booking";

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

/** Minutes left in the Istanbul day, for tests that need room "today" (they skip near midnight). */
export function minutesLeftToday(now = new Date()): number {
  const midnight = atIstanbul(addDays(istanbulDateOf(now), 1), "00:00");
  return Math.floor((midnight.getTime() - now.getTime()) / 60_000);
}

/**
 * Minutes of today's clinic hours still bookable online (after the public lead time); 0 when
 * closed. Tests that book "today" skip it below a margin so they pass at any hour.
 */
export async function publicMinutesLeftToday(now = new Date()): Promise<number> {
  return withDb(async (db) => {
    const today = istanbulDateOf(now);
    const [h] = await db.select().from(clinicHours).where(eq(clinicHours.weekday, weekdayOf(today)));
    if (!h?.open || !h.close) return 0;
    const from = Math.max(now.getTime() + PUBLIC_MIN_LEAD_MIN * 60_000, atIstanbul(today, h.open).getTime());
    return Math.max(0, Math.floor((atIstanbul(today, h.close).getTime() - from) / 60_000));
  });
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

/** The seeded demo dentist (Dr. Elif Aydın). */
export async function elifId(): Promise<number> {
  return withDb(async (db) => {
    const [d] = await db.select({ id: dentists.id }).from(dentists).where(eq(dentists.slug, "elif-aydin"));
    return d.id;
  });
}

async function insertAppt(db: Db, dentistId: number, start: Date, minutes: number, name: string) {
  const [t] = await db.select({ id: treatments.id }).from(treatments).where(eq(treatments.slug, "checkup"));
  const phone = `+90532${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const [p] = await db
    .insert(patients)
    .values({ name, phoneE164: phone, email: "dentist-e2e@example.com", locale: "en" })
    .returning({ id: patients.id });
  try {
    const [e] = await db
      .insert(entries)
      .values({
        dentistId,
        kind: "appointment",
        during: { start, end: new Date(start.getTime() + minutes * 60_000) },
        treatmentId: t.id,
        patientId: p.id,
        status: "booked",
        source: "staff",
        createdBy: "e2e",
      })
      .returning({ id: entries.id });
    return { id: e.id, patientId: p.id };
  } catch (err) {
    await db.delete(patients).where(eq(patients.id, p.id));
    throw err;
  }
}

/** An appointment inserted directly, with a cleanup that removes it and its patient. */
export async function addAppointment(dentistId: number, date: string, from: string, name: string, minutes = 30) {
  return withDb(async (db) => {
    const a = await insertAppt(db, dentistId, atIstanbul(date, from), minutes, name);
    return { id: a.id, cleanup: () => removeAppointment(a.id, a.patientId) };
  });
}

function removeAppointment(id: string, patientId: string) {
  return withDb(async (db) => {
    await db.delete(entries).where(eq(entries.id, id));
    await db.delete(patients).where(eq(patients.id, patientId));
  });
}

/**
 * A booked 30-minute appointment for `dentistId` later today (Istanbul): the next free 15-minute
 * start from 10 minutes ahead. Independent of what the seed put on today's calendar.
 */
export async function addTodayAppointment(dentistId: number, name: string) {
  return withDb(async (db) => {
    const now = new Date();
    const today = istanbulDateOf(now);
    const first = new Date(Math.ceil((now.getTime() + 10 * 60_000) / 900_000) * 900_000);
    for (let t = first; istanbulDateOf(new Date(t.getTime() + 30 * 60_000)) === today; t = new Date(t.getTime() + 900_000)) {
      try {
        const a = await insertAppt(db, dentistId, t, 30, name);
        return { id: a.id, time: istanbulTimeOf(t), cleanup: () => removeAppointment(a.id, a.patientId) };
      } catch {
        // Overlaps something on the calendar: try the next start.
      }
    }
    throw new Error("no room left today for a test appointment");
  });
}

/** Free start times (HH:MM) of a 30-minute check-up for one dentist on `date`, under staff rules. */
export async function freeStarts(dentistId: number, date: string): Promise<string[]> {
  return withDb(async (db) => {
    const [t] = await db.select({ id: treatments.id }).from(treatments).where(eq(treatments.slug, "checkup"));
    const slots = await getDaySlots(db, { treatmentId: t.id, dentistId, date, now: new Date(), audience: "staff" });
    return slots.map((s) => istanbulTimeOf(s.start));
  });
}

/**
 * The first weekday from the quiet date on where `dentistId` has free starts that satisfy `ok`.
 * Elif's seeded days are dense, so tests look further out (empty days beyond the seeded fortnight).
 */
export async function freeDay(dentistId: number, ok: (starts: string[]) => boolean = (s) => s.length > 0) {
  let date = await quietDate();
  for (let n = 0; n < 40; n++, date = addDays(date, 1)) {
    if (weekdayOf(date) === 0 || weekdayOf(date) === 6) continue;
    const starts = await freeStarts(dentistId, date);
    if (ok(starts)) return { date, starts };
  }
  throw new Error("no suitable day found");
}

/** A start free on `date` and on the same weekday for the next `weeks` weeks too (weekly block). */
export async function weeklyFreeStart(dentistId: number, date: string, weeks: number): Promise<string> {
  const base = await freeStarts(dentistId, date);
  const later = await Promise.all(Array.from({ length: weeks }, (_, i) => freeStarts(dentistId, addDays(date, 7 * (i + 1)))));
  const hit = base.find((s) => later.every((l) => l.includes(s) && l.includes(addMinutes(s, 15))));
  if (!hit) throw new Error(`no start free for ${weeks + 1} weeks from ${date}`);
  return hit;
}

/**
 * The first weekday from the quiet date on where `dentistId` has a 30-minute start free on that day
 * and the same weekday for the next `weeks` weeks (a weekly block that must not hit appointments).
 */
export async function weeklyFreeDay(dentistId: number, weeks: number): Promise<{ date: string; from: string }> {
  let date = await quietDate();
  for (let n = 0; n < 40; n++, date = addDays(date, 1)) {
    if (weekdayOf(date) === 0 || weekdayOf(date) === 6) continue;
    const from = await weeklyFreeStart(dentistId, date, weeks).catch(() => null);
    if (from) return { date, from };
  }
  throw new Error(`no weekday with a start free for ${weeks + 1} weeks`);
}

export function addMinutes(time: string, n: number): string {
  const [h, m] = time.split(":").map(Number);
  const t = h * 60 + m + n;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Removes an appointment created through the UI, with its patient. */
export async function deleteEntryAndPatient(id: string) {
  return withDb(async (db) => {
    const [e] = await db.select({ p: entries.patientId }).from(entries).where(eq(entries.id, id));
    await db.delete(entries).where(eq(entries.id, id));
    if (e?.p) await db.delete(patients).where(eq(patients.id, e.p));
  });
}

/** Blocks created by a test carry a unique note; this removes them all. */
export async function deleteBlocksByNote(note: string) {
  return withDb(async (db) => {
    await db.delete(entries).where(and(eq(entries.kind, "block"), eq(entries.blockNote, note)));
  });
}

export async function blocksByNote(note: string) {
  return withDb(async (db) => {
    const rows = await db.select({ during: entries.during }).from(entries).where(and(eq(entries.kind, "block"), eq(entries.blockNote, note)));
    return rows.map((r) => ({ date: istanbulDateOf(r.during.start), start: istanbulTimeOf(r.during.start) })).sort((a, b) => a.date.localeCompare(b.date));
  });
}

export { atIstanbul };

/** A new call-back request inserted directly; returns its id and a cleanup. */
export async function addRequest(name: string) {
  return withDb(async (db) => {
    const [r] = await db
      .insert(callbackRequests)
      .values({ name, phoneE164: "+905325550123", locale: "en", message: "E2E request", ipHash: "e2e" })
      .returning({ id: callbackRequests.id });
    return { id: r.id, cleanup: () => withDb((d) => d.delete(callbackRequests).where(eq(callbackRequests.id, r.id))) };
  });
}
