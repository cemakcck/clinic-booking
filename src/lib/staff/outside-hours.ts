import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { clinicHours, clinicSettings, closedDates, entries, workingHours } from "@/lib/db/schema";
import { overlaps } from "@/lib/db/range";
import { effectiveHours } from "@/lib/slots/engine";
import { addDays, atIstanbul, istanbulDateOf, weekdayOf } from "@/lib/time";

/**
 * Ids of live booked appointments starting on Istanbul dates `from`..`to` (inclusive) that no
 * longer fit their dentist's effective hours (clinic ∩ dentist, minus lunch) or fall on a closed
 * date, e.g. after an admin shrank the hours. Changing hours never deletes appointments; reception
 * gets these flagged instead. Ordered by start.
 */
export async function findOutsideHours(db: DbOrTx, from: string, to: string): Promise<string[]> {
  const window = { start: atIstanbul(from, "00:00"), end: atIstanbul(addDays(to, 1), "00:00") };
  const [appts, wh, ch, settings, closed] = await Promise.all([
    db
      .select({ id: entries.id, dentistId: entries.dentistId, during: entries.during })
      .from(entries)
      .where(
        and(
          eq(entries.kind, "appointment"),
          eq(entries.active, true),
          eq(entries.status, "booked"),
          overlaps(entries.during, window),
        ),
      )
      .orderBy(asc(entries.during)),
    db.select().from(workingHours),
    db.select().from(clinicHours),
    db.select().from(clinicSettings).where(eq(clinicSettings.id, 1)),
    db
      .select({ date: closedDates.date })
      .from(closedDates)
      .where(and(gte(closedDates.date, addDays(from, -1)), lte(closedDates.date, addDays(to, 1)))),
  ]);
  const closedSet = new Set(closed.map((c) => c.date));
  const lunch = settings[0] ? { start: settings[0].lunchStart, end: settings[0].lunchEnd } : null;
  const clinicBy = new Map(ch.map((c) => [c.weekday, c.open && c.close ? { start: c.open, end: c.close } : null]));
  const dentistBy = new Map(wh.map((w) => [`${w.dentistId}:${w.weekday}`, { start: w.start, end: w.end }]));

  const out: string[] = [];
  for (const a of appts) {
    const date = istanbulDateOf(a.during.start);
    if (date < from || date > to) continue;
    const wd = weekdayOf(date);
    const hours = effectiveHours(clinicBy.get(wd) ?? null, dentistBy.get(`${a.dentistId}:${wd}`) ?? null, lunch);
    const fits =
      !closedSet.has(date) &&
      hours !== null &&
      a.during.start >= atIstanbul(date, hours.open.start) &&
      a.during.end <= atIstanbul(date, hours.open.end) &&
      !hours.breaks.some((b) => a.during.start < atIstanbul(date, b.end) && atIstanbul(date, b.start) < a.during.end);
    if (!fits) out.push(a.id);
  }
  return out;
}
