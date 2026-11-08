import type { Locale } from "@/i18n/routing";
import type { OpeningHours } from "./queries";

const TAG: Record<Locale, string> = { en: "en-GB", tr: "tr-TR" };

/** Weekday name (0 = Sunday) via Intl on a fixed UTC calendar date, independent of process TZ. */
export function weekdayName(weekday: number, locale: Locale, style: "long" | "short" = "long"): string {
  // 2024-01-07 was a Sunday.
  const d = new Date(Date.UTC(2024, 0, 7 + weekday, 12));
  return new Intl.DateTimeFormat(TAG[locale], { weekday: style, timeZone: "UTC" }).format(d);
}

export const range = (open: string | null, close: string | null) => (open && close ? `${open}–${close}` : null);

/** Groups consecutive days with identical hours: [{ label: "Mon–Fri", hours: "09:00–18:00" }, ...]. */
export function summarizeHours(days: OpeningHours["days"], locale: Locale): { label: string; hours: string | null }[] {
  const groups: { from: number; to: number; hours: string | null }[] = [];
  for (const d of days) {
    const hours = range(d.open, d.close);
    const last = groups.at(-1);
    if (last && last.hours === hours) last.to = d.weekday;
    else groups.push({ from: d.weekday, to: d.weekday, hours });
  }
  return groups.map((g) => ({
    label:
      g.from === g.to
        ? weekdayName(g.from, locale, "short")
        : `${weekdayName(g.from, locale, "short")}–${weekdayName(g.to, locale, "short")}`,
    hours: g.hours,
  }));
}
