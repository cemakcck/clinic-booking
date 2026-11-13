import { addDays, atIstanbul, istanbulDateOf, weekdayOf } from "@/lib/time";

export type Period = "week" | "4w" | "3m";
export type Window = { start: Date; end: Date };

export const PERIODS: readonly Period[] = ["week", "4w", "3m"];

const DAY_MS = 86_400_000;
const SPAN_DAYS: Record<Exclude<Period, "week">, number> = { "4w": 28, "3m": 91 };

/**
 * Spec §6.2 windows, half-open [start, end). Istanbul has no DST, so fixed-length millisecond
 * arithmetic is exact; the Monday is found on the Istanbul calendar, never the process TZ.
 */
export function periodBounds(
  period: Period,
  now: Date,
): { current: Window; previous: Window; utilisation: Window } {
  if (period === "week") {
    const today = istanbulDateOf(now);
    const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
    const start = atIstanbul(monday, "00:00");
    const current = { start, end: now };
    return {
      current,
      previous: { start: new Date(start.getTime() - 7 * DAY_MS), end: new Date(now.getTime() - 7 * DAY_MS) },
      utilisation: { start, end: atIstanbul(addDays(monday, 7), "00:00") },
    };
  }
  const span = SPAN_DAYS[period] * DAY_MS;
  const current = { start: new Date(now.getTime() - span), end: now };
  return {
    current,
    previous: { start: new Date(now.getTime() - 2 * span), end: current.start },
    utilisation: current,
  };
}
