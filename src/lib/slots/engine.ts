import { SLOT_STEP_MIN } from "@/config/booking";
import { addDays, atIstanbul, istanbulDateOf } from "@/lib/time";

export type Interval = { start: Date; end: Date };
export type HoursRange = { start: string; end: string }; // HH:MM

const MIN = 60_000;

export function effectiveHours(
  clinic: HoursRange | null,
  dentist: HoursRange | null,
  lunch: HoursRange | null,
): { open: HoursRange; breaks: HoursRange[] } | null {
  if (!clinic || !dentist) return null;
  // HH:MM strings compare correctly lexicographically.
  const start = clinic.start > dentist.start ? clinic.start : dentist.start;
  const end = clinic.end < dentist.end ? clinic.end : dentist.end;
  if (start >= end) return null;
  const breaks: HoursRange[] = [];
  if (lunch) {
    const s = lunch.start > start ? lunch.start : start;
    const e = lunch.end < end ? lunch.end : end;
    if (s < e) breaks.push({ start: s, end: e });
  }
  return { open: { start, end }, breaks };
}

export function computeSlots(q: {
  date: string;
  durationMin: number;
  hours: ReturnType<typeof effectiveHours>;
  closed: boolean;
  busy: Interval[];
  now: Date;
  minLeadMin: number;
  horizonDays: number;
  stepMin?: number;
}): Date[] {
  if (q.closed || !q.hours) return [];
  if (q.date > addDays(istanbulDateOf(q.now), q.horizonDays)) return [];
  const step = (q.stepMin ?? SLOT_STEP_MIN) * MIN;
  const dur = q.durationMin * MIN;
  const openEnd = atIstanbul(q.date, q.hours.open.end).getTime();
  const earliest = q.now.getTime() + q.minLeadMin * MIN;
  const blocked: Interval[] = [
    ...q.hours.breaks.map((b) => ({ start: atIstanbul(q.date, b.start), end: atIstanbul(q.date, b.end) })),
    ...q.busy,
  ];
  const out: Date[] = [];
  for (let t = atIstanbul(q.date, q.hours.open.start).getTime(); t + dur <= openEnd; t += step) {
    if (t < earliest) continue;
    const end = t + dur;
    if (blocked.some((b) => t < b.end.getTime() && b.start.getTime() < end)) continue;
    out.push(new Date(t));
  }
  return out;
}

export function pickAnyDentist(
  c: { dentistId: number; sortOrder: number; dayCount: number }[],
): number | null {
  if (c.length === 0) return null;
  return [...c].sort((a, b) => a.dayCount - b.dayCount || a.sortOrder - b.sortOrder)[0].dentistId;
}
