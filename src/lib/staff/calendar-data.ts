import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import {
  clinicHours,
  clinicSettings,
  closedDates,
  dentists,
  dentistTreatments,
  entries,
  patients,
  treatments,
  workingHours,
} from "@/lib/db/schema";
import { overlaps } from "@/lib/db/range";
import type { Actor } from "@/lib/auth/roles";
import { can } from "@/lib/auth/permissions";
import { countPublicSlots, getDaySlots } from "@/lib/booking/availability";
import { effectiveHours, type HoursRange } from "@/lib/slots/engine";
import { dayBounds } from "@/lib/calendar/geometry";
import { addDays, atIstanbul, istanbulDateOf, istanbulTimeOf, weekdayOf } from "@/lib/time";
import { BookingError } from "@/lib/booking/errors";
import { isDemo } from "@/lib/demo/mode";
import { maskPhone } from "@/lib/demo/mask";
import { findOutsideHours } from "./outside-hours";
import type { BlockReason } from "./blocks";

/** The name typed for this booking, else the shared patient row's (seeded and legacy rows). */
const contactName = sql<string | null>`coalesce(${entries.contactName}, ${patients.name})`;

export type CalStatus = "booked" | "arrived" | "completed" | "no_show";

/**
 * One calendar entry as the staff UI sees it. Times are ISO instants; `editable` comes from
 * `can`. Phone numbers and block notes are only included on entries the viewer may edit.
 */
export type CalEntry = {
  id: string;
  dentistId: number;
  kind: "appointment" | "block";
  start: string;
  end: string;
  status?: CalStatus;
  patientName?: string;
  patientPhone?: string;
  treatmentId?: number;
  treatmentName?: string;
  blockReason?: BlockReason;
  blockNote?: string;
  seriesId?: string;
  editable: boolean;
  mine?: boolean;
  /** Demo mode: another visitor's online booking, so the phone is masked (see lib/demo/mask). */
  contactMasked?: boolean;
};

export type Counters = { appointments: number; arrived: number; noShows: number; freeSlotsToday: number };

export type CalendarData = {
  dentists: { id: number; name: string }[];
  entries: CalEntry[];
  counters: Counters;
  outsideHours: string[];
};

type Opts = { locale?: "en" | "tr"; mine?: string[] };

async function loadEntries(
  db: DbOrTx,
  actor: Actor,
  dentistIds: number[],
  from: string,
  days: number,
  opts: Opts,
): Promise<CalEntry[]> {
  if (dentistIds.length === 0) return [];
  const window = { start: atIstanbul(from, "00:00"), end: atIstanbul(addDays(from, days), "00:00") };
  const rows = await db
    .select({
      id: entries.id,
      dentistId: entries.dentistId,
      kind: entries.kind,
      during: entries.during,
      status: entries.status,
      blockReason: entries.blockReason,
      blockNote: entries.blockNote,
      seriesId: entries.seriesId,
      treatmentId: entries.treatmentId,
      nameEn: treatments.nameEn,
      nameTr: treatments.nameTr,
      patientName: contactName,
      patientPhone: patients.phoneE164,
    })
    .from(entries)
    .leftJoin(treatments, eq(treatments.id, entries.treatmentId))
    .leftJoin(patients, eq(patients.id, entries.patientId))
    .where(
      and(
        inArray(entries.dentistId, dentistIds),
        inArray(entries.kind, ["appointment", "block"]),
        eq(entries.active, true),
        overlaps(entries.during, window),
      ),
    )
    .orderBy(asc(entries.during));
  const mine = new Set(opts.mine ?? []);
  const demo = isDemo();
  return rows.map((r): CalEntry => {
    const base = {
      id: r.id,
      dentistId: r.dentistId,
      start: r.during.start.toISOString(),
      end: r.during.end.toISOString(),
    };
    if (r.kind === "block") {
      const editable = can(actor, "block.manage", { dentistId: r.dentistId });
      return {
        ...base,
        kind: "block",
        blockReason: r.blockReason ?? "other",
        blockNote: editable ? (r.blockNote ?? undefined) : undefined,
        seriesId: editable ? (r.seriesId ?? undefined) : undefined,
        editable,
      };
    }
    const editable = can(actor, "appointment.manage", { dentistId: r.dentistId });
    // Public demo: only this browser's own bookings carry the real phone number. Staff-created ones
    // are masked too: another visitor signed in as staff may have typed someone's real number.
    const masked = demo && !mine.has(r.id);
    const phone = r.patientPhone ? (masked ? maskPhone(r.patientPhone) : r.patientPhone) : undefined;
    return {
      ...base,
      kind: "appointment",
      status: (r.status ?? "booked") as CalStatus,
      patientName: r.patientName ?? "",
      patientPhone: editable ? phone : undefined,
      ...(masked && editable && phone ? { contactMasked: true } : {}),
      treatmentId: r.treatmentId ?? undefined,
      treatmentName: (opts.locale === "tr" ? r.nameTr : r.nameEn) ?? "",
      editable,
      mine: mine.has(r.id),
    };
  });
}

function count(list: CalEntry[]): Omit<Counters, "freeSlotsToday"> {
  const appts = list.filter((e) => e.kind === "appointment");
  return {
    appointments: appts.length,
    arrived: appts.filter((e) => e.status === "arrived" || e.status === "completed").length,
    noShows: appts.filter((e) => e.status === "no_show").length,
  };
}

/** Active dentists in display order. */
export async function activeDentists(db: DbOrTx) {
  return db
    .select({ id: dentists.id, name: dentists.name })
    .from(dentists)
    .where(eq(dentists.active, true))
    .orderBy(asc(dentists.sortOrder), asc(dentists.id));
}

/**
 * The day view: every active dentist, their live appointments and blocks touching `date`
 * (Istanbul), the day's counters and the appointments that fall outside working hours.
 * `freeSlotsToday` is the public free-slot count (the floor's probe) for the shown day.
 */
export async function getCalendarDay(
  db: DbOrTx,
  actor: Actor,
  date: string,
  now: Date,
  opts: Opts = {},
): Promise<CalendarData> {
  const ds = await activeDentists(db);
  const [list, free, outsideHours] = await Promise.all([
    loadEntries(
      db,
      actor,
      ds.map((d) => d.id),
      date,
      1,
      opts,
    ),
    countPublicSlots(db, date, now),
    findOutsideHours(db, date, date),
  ]);
  const dayOnly = list.filter((e) => e.kind === "block" || istanbulDateOf(new Date(e.start)) === date);
  return { dentists: ds, entries: list, counters: { ...count(dayOnly), freeSlotsToday: free }, outsideHours };
}

/** The week view: seven days from `weekStart` for one dentist, in the same shape. */
export async function getCalendarWeek(
  db: DbOrTx,
  actor: Actor,
  dentistId: number,
  weekStart: string,
  now: Date = new Date(),
  opts: Opts = {},
): Promise<CalendarData> {
  const ds = (await activeDentists(db)).filter((d) => d.id === dentistId);
  if (ds.length === 0) return { dentists: [], entries: [], counters: { appointments: 0, arrived: 0, noShows: 0, freeSlotsToday: 0 }, outsideHours: [] };
  const weekEnd = addDays(weekStart, 6);
  const [list, outside, shortest] = await Promise.all([
    loadEntries(db, actor, [dentistId], weekStart, 7, opts),
    findOutsideHours(db, weekStart, weekEnd),
    db
      .select({ id: treatments.id })
      .from(treatments)
      .innerJoin(
        dentistTreatments,
        and(eq(dentistTreatments.treatmentId, treatments.id), eq(dentistTreatments.dentistId, dentistId)),
      )
      .where(eq(treatments.active, true))
      .orderBy(asc(treatments.durationMin), asc(treatments.sortOrder))
      .limit(1),
  ]);
  let free = 0;
  if (shortest[0]) {
    for (let i = 0; i < 7; i++) {
      free += (
        await getDaySlots(db, {
          treatmentId: shortest[0].id,
          dentistId,
          date: addDays(weekStart, i),
          now,
          audience: "public",
        })
      ).length;
    }
  }
  const ids = new Set(list.map((e) => e.id));
  const inWeek = list.filter((e) => e.kind === "block" || istanbulDateOf(new Date(e.start)) >= weekStart);
  return {
    dentists: ds,
    entries: list,
    counters: { ...count(inWeek), freeSlotsToday: free },
    outsideHours: outside.filter((id) => ids.has(id)),
  };
}

// --- grid layout ------------------------------------------------------------------------------

export type ColumnHours = { open: HoursRange | null; breaks: HoursRange[]; closed: boolean };

/** Grid bounds (union of clinic hours) and each (dentist, date) column's effective hours. */
export async function getGridHours(
  db: DbOrTx,
  dentistIds: number[],
  dates: string[],
): Promise<{ bounds: { open: string; close: string }; hours: Record<string, ColumnHours> }> {
  const [ch, wh, settings, closed] = await Promise.all([
    db.select().from(clinicHours),
    dentistIds.length ? db.select().from(workingHours).where(inArray(workingHours.dentistId, dentistIds)) : [],
    db.select().from(clinicSettings).where(eq(clinicSettings.id, 1)),
    db
      .select({ date: closedDates.date })
      .from(closedDates)
      .where(and(gte(closedDates.date, dates[0]), lte(closedDates.date, dates[dates.length - 1]))),
  ]);
  const closedSet = new Set(closed.map((c) => c.date));
  const lunch = settings[0] ? { start: settings[0].lunchStart, end: settings[0].lunchEnd } : null;
  const hours: Record<string, ColumnHours> = {};
  for (const date of dates) {
    const wd = weekdayOf(date);
    const c = ch.find((x) => x.weekday === wd);
    const clinic = c?.open && c.close ? { start: c.open, end: c.close } : null;
    for (const id of dentistIds) {
      const w = wh.find((x) => x.dentistId === id && x.weekday === wd);
      const eff = closedSet.has(date) ? null : effectiveHours(clinic, w ? { start: w.start, end: w.end } : null, lunch);
      hours[`${id}|${date}`] = { open: eff?.open ?? null, breaks: eff?.breaks ?? [], closed: closedSet.has(date) || !clinic };
    }
  }
  return { bounds: dayBounds(ch), hours };
}

/** One entry's piece within one day column, in minutes after Istanbul midnight. */
export type GridItem = {
  entryId: string;
  dentistId: number;
  date: string;
  startMin: number;
  endMin: number;
  /** "10:00–10:45" in clinic time, for the entry as a whole. */
  timeLabel: string;
  startTime: string;
};

/** Splits entries into per-day pieces (a leave block can span days), using Istanbul clock times. */
export function layoutEntries(list: CalEntry[], dates: string[]): GridItem[] {
  const out: GridItem[] = [];
  for (const e of list) {
    const s = new Date(e.start);
    const en = new Date(e.end);
    const startTime = istanbulTimeOf(s);
    const timeLabel = `${startTime}–${istanbulTimeOf(en)}`;
    for (const date of dates) {
      const dayStart = atIstanbul(date, "00:00").getTime();
      const dayEnd = dayStart + 86_400_000;
      if (s.getTime() >= dayEnd || en.getTime() <= dayStart) continue;
      out.push({
        entryId: e.id,
        dentistId: e.dentistId,
        date,
        startMin: Math.round((Math.max(s.getTime(), dayStart) - dayStart) / 60_000),
        endMin: Math.round((Math.min(en.getTime(), dayEnd) - dayStart) / 60_000),
        timeLabel,
        startTime,
      });
    }
  }
  return out;
}

/** Treatments with the dentists who perform them, for the dialogs' selects. */
export async function treatmentOptions(db: DbOrTx, locale: "en" | "tr") {
  const [ts, links] = await Promise.all([
    db
      .select({ id: treatments.id, nameEn: treatments.nameEn, nameTr: treatments.nameTr, durationMin: treatments.durationMin })
      .from(treatments)
      .where(eq(treatments.active, true))
      .orderBy(asc(treatments.sortOrder), asc(treatments.id)),
    db.select().from(dentistTreatments),
  ]);
  return ts.map((t) => ({
    id: t.id,
    name: locale === "tr" ? t.nameTr : t.nameEn,
    durationMin: t.durationMin,
    dentistIds: links.filter((l) => l.treatmentId === t.id).map((l) => l.dentistId),
  }));
}

export type TodayItem = {
  id: string;
  start: string;
  end: string;
  patientName: string;
  treatmentName: string;
  status: CalStatus;
};

/**
 * The signed-in dentist's own live appointments for the Istanbul day of `now`, in time order.
 * `nextId` is the first booked or arrived one whose end is after `now` (the patient to see next).
 */
export async function getTodayForDentist(
  db: DbOrTx,
  actor: Actor,
  now: Date,
  opts: { locale?: "en" | "tr" } = {},
): Promise<{ items: TodayItem[]; nextId: string | null }> {
  if (actor.dentistId === null || !can(actor, "appointment.status", { dentistId: actor.dentistId })) {
    throw new BookingError("forbidden");
  }
  const day = istanbulDateOf(now);
  const window = { start: atIstanbul(day, "00:00"), end: atIstanbul(addDays(day, 1), "00:00") };
  const rows = await db
    .select({
      id: entries.id,
      during: entries.during,
      status: entries.status,
      patientName: contactName,
      nameEn: treatments.nameEn,
      nameTr: treatments.nameTr,
    })
    .from(entries)
    .leftJoin(treatments, eq(treatments.id, entries.treatmentId))
    .leftJoin(patients, eq(patients.id, entries.patientId))
    .where(
      and(
        eq(entries.dentistId, actor.dentistId),
        eq(entries.kind, "appointment"),
        eq(entries.active, true),
        overlaps(entries.during, window),
      ),
    )
    .orderBy(asc(entries.during));
  const items = rows
    .filter((r) => istanbulDateOf(r.during.start) === day)
    .map(
      (r): TodayItem => ({
        id: r.id,
        start: r.during.start.toISOString(),
        end: r.during.end.toISOString(),
        patientName: r.patientName ?? "",
        treatmentName: (opts.locale === "tr" ? r.nameTr : r.nameEn) ?? "",
        status: (r.status ?? "booked") as CalStatus,
      }),
    );
  const next = items.find((i) => (i.status === "booked" || i.status === "arrived") && new Date(i.end) > now);
  return { items, nextId: next?.id ?? null };
}
