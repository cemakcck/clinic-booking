import { and, asc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { clinicHours, clinicSettings, closedDates, dentists, entries, workingHours } from "@/lib/db/schema";
import { overlaps } from "@/lib/db/range";
import type { Actor } from "@/lib/auth/roles";
import { can } from "@/lib/auth/permissions";
import { BookingError } from "@/lib/booking/errors";
import { effectiveHours, type HoursRange, type Interval } from "@/lib/slots/engine";
import { addDays, atIstanbul, istanbulDateOf, TZ, weekdayOf } from "@/lib/time";
import { periodBounds, type Period, type Window } from "./periods";

export type { Period, Window } from "./periods";

export type Headline = { appointments: number; cancellations: number; noShowRate: number | null; online: number; staff: number };

export type DashboardData = {
  period: Period;
  scope: { dentistId: number | null };
  current: Headline;
  /** null when the previous window has no appointments at all (cancelled ones included). */
  previous: Headline | null;
  utilisation: { dentistId: number; name: string; bookedMin: number; workingMin: number; ratio: number | null }[];
  /** Istanbul weekday 1–7 (Mon=1) × hour, every hour the clinic is open, zeros included. */
  heatmap: { weekday: number; hour: number; count: number }[];
};

const MIN_MS = 60_000;

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const start = sql`lower(${entries.during})`;

function scoped(dentistId: number | null): SQL {
  return dentistId === null ? sql`true` : eq(entries.dentistId, dentistId);
}

/** Appointments (any status) whose start falls in [w.start, w.end). */
function startsIn(w: Window, dentistId: number | null): SQL | undefined {
  return and(
    eq(entries.kind, "appointment"),
    scoped(dentistId),
    sql`${start} >= ${ts(w.start)}`,
    sql`${start} < ${ts(w.end)}`,
  );
}

async function headline(
  db: DbOrTx,
  w: Window,
  now: Date,
  dentistId: number | null,
): Promise<{ h: Headline; any: boolean }> {
  const started = sql`${start} <= ${ts(now)}`;
  const [r] = await db
    .select({
      appointments: sql<number>`count(*) filter (where ${entries.status} <> 'cancelled')::int`,
      cancellations: sql<number>`count(*) filter (where ${entries.status} = 'cancelled')::int`,
      noShows: sql<number>`count(*) filter (where ${entries.status} = 'no_show' and ${started})::int`,
      seen: sql<number>`count(*) filter (where ${entries.status} in ('completed', 'arrived') and ${started})::int`,
      online: sql<number>`count(*) filter (where ${entries.status} <> 'cancelled' and ${entries.source} = 'online')::int`,
      staff: sql<number>`count(*) filter (where ${entries.status} <> 'cancelled' and ${entries.source} = 'staff')::int`,
    })
    .from(entries)
    .where(startsIn(w, dentistId));
  const denom = r.noShows + r.seen;
  return {
    h: {
      appointments: r.appointments,
      cancellations: r.cancellations,
      noShowRate: denom === 0 ? null : r.noShows / denom,
      online: r.online,
      staff: r.staff,
    },
    any: r.appointments + r.cancellations > 0,
  };
}

/** `from` minus every interval in `cut`. */
function subtract(from: Interval[], cut: Interval[]): Interval[] {
  let out = from;
  for (const c of cut) {
    const next: Interval[] = [];
    for (const i of out) {
      if (c.end <= i.start || c.start >= i.end) {
        next.push(i);
        continue;
      }
      if (c.start > i.start) next.push({ start: i.start, end: c.start });
      if (c.end < i.end) next.push({ start: c.end, end: i.end });
    }
    out = next;
  }
  return out;
}

function clippedMs(i: Interval, w: Window): number {
  const s = Math.max(i.start.getTime(), w.start.getTime());
  const e = Math.min(i.end.getTime(), w.end.getTime());
  return Math.max(0, e - s);
}

async function utilisation(db: DbOrTx, w: Window, dentistId: number | null): Promise<DashboardData["utilisation"]> {
  const ds = await db
    .select({ id: dentists.id, name: dentists.name })
    .from(dentists)
    .where(dentistId === null ? eq(dentists.active, true) : eq(dentists.id, dentistId))
    .orderBy(asc(dentists.sortOrder), asc(dentists.id));
  if (ds.length === 0) return [];
  const ids = ds.map((d) => d.id);

  const firstDate = istanbulDateOf(w.start);
  const lastDate = istanbulDateOf(new Date(w.end.getTime() - 1));

  const [hoursRows, clinicRows, [settings], closedRows, entryRows] = await Promise.all([
    db
      .select({ dentistId: workingHours.dentistId, weekday: workingHours.weekday, start: workingHours.start, end: workingHours.end })
      .from(workingHours)
      .where(inArray(workingHours.dentistId, ids)),
    db.select().from(clinicHours),
    db.select({ start: clinicSettings.lunchStart, end: clinicSettings.lunchEnd }).from(clinicSettings).where(eq(clinicSettings.id, 1)),
    db
      .select({ date: closedDates.date })
      .from(closedDates)
      .where(and(gte(closedDates.date, firstDate), lte(closedDates.date, lastDate))),
    db
      .select({ dentistId: entries.dentistId, kind: entries.kind, during: entries.during })
      .from(entries)
      .where(
        and(
          inArray(entries.dentistId, ids),
          overlaps(entries.during, w),
          sql`(${entries.kind} = 'block' and ${entries.active}) or (${entries.kind} = 'appointment' and ${ne(entries.status, "cancelled")})`,
        ),
      ),
  ]);

  const clinicBy = new Map<number, HoursRange | null>(
    clinicRows.map((c) => [c.weekday, c.open && c.close ? { start: c.open, end: c.close } : null]),
  );
  const lunch: HoursRange | null = settings ?? null;
  const closed = new Set(closedRows.map((c) => c.date));
  const dates: string[] = [];
  for (let d = firstDate; d <= lastDate; d = addDays(d, 1)) dates.push(d);

  return ds.map(({ id, name }) => {
    const mine = entryRows.filter((e) => e.dentistId === id);
    const blocks = mine.filter((e) => e.kind === "block").map((e) => e.during);
    const own = new Map(hoursRows.filter((h) => h.dentistId === id).map((h) => [h.weekday, h]));

    let workingMs = 0;
    for (const date of dates) {
      if (closed.has(date)) continue;
      const wd = weekdayOf(date);
      const dh = own.get(wd);
      const hours = effectiveHours(clinicBy.get(wd) ?? null, dh ? { start: dh.start, end: dh.end } : null, lunch);
      if (!hours) continue;
      const at = (r: HoursRange): Interval => ({ start: atIstanbul(date, r.start), end: atIstanbul(date, r.end) });
      const free = subtract([at(hours.open)], [...hours.breaks.map(at), ...blocks]);
      for (const i of free) workingMs += clippedMs(i, w);
    }
    const bookedMs = mine
      .filter((e) => e.kind === "appointment")
      .reduce((n, e) => n + clippedMs(e.during, w), 0);

    const workingMin = Math.round(workingMs / MIN_MS);
    const bookedMin = Math.round(bookedMs / MIN_MS);
    return { dentistId: id, name, bookedMin, workingMin, ratio: workingMin === 0 ? null : bookedMin / workingMin };
  });
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

async function heatmap(db: DbOrTx, w: Window, dentistId: number | null): Promise<DashboardData["heatmap"]> {
  const local = sql`(${start} at time zone ${TZ})`;
  const [counts, clinicRows] = await Promise.all([
    db
      .select({
        weekday: sql<number>`extract(isodow from ${local})::int`,
        hour: sql<number>`extract(hour from ${local})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(entries)
      .where(and(startsIn(w, dentistId), ne(entries.status, "cancelled")))
      .groupBy(sql`1`, sql`2`),
    db.select().from(clinicHours),
  ]);
  const by = new Map(counts.map((c) => [`${c.weekday}:${c.hour}`, c.count]));
  const out: DashboardData["heatmap"] = [];
  for (const c of clinicRows) {
    if (!c.open || !c.close) continue;
    const weekday = c.weekday === 0 ? 7 : c.weekday;
    const from = Math.floor(toMin(c.open) / 60);
    const to = Math.ceil(toMin(c.close) / 60);
    for (let hour = from; hour < to; hour++) out.push({ weekday, hour, count: by.get(`${weekday}:${hour}`) ?? 0 });
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
}

/**
 * Spec §6.3 numbers for one period. Receptionists and admins get the whole clinic; a dentist
 * gets only their own calendar, and no other dentist's id or name appears in the result.
 */
export async function dashboardData(db: DbOrTx, actor: Actor, period: Period, now: Date): Promise<DashboardData> {
  if (!can(actor, "dashboard.view")) throw new BookingError("forbidden");
  let dentistId: number | null = null;
  if (actor.role === "dentist") {
    if (actor.dentistId == null) throw new BookingError("forbidden");
    dentistId = actor.dentistId;
  }
  const w = periodBounds(period, now);
  const [cur, prev, util, heat] = await Promise.all([
    headline(db, w.current, now, dentistId),
    headline(db, w.previous, now, dentistId),
    utilisation(db, w.utilisation, dentistId),
    heatmap(db, w.current, dentistId),
  ]);
  return {
    period,
    scope: { dentistId },
    current: cur.h,
    previous: prev.any ? prev.h : null,
    utilisation: util,
    heatmap: heat,
  };
}
