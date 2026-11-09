import type { Locale } from "@/i18n/routing";

export const TZ = "Europe/Istanbul";

const LOCALE_TAG: Record<Locale, string> = { en: "en-GB", tr: "tr-TR" };

/** Clinic wall time (Istanbul, UTC+3, no DST) to an instant. date YYYY-MM-DD, time HH:MM. */
export function atIstanbul(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+03:00`);
}

function parts(d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

export function istanbulDateOf(d: Date): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

export function istanbulTimeOf(d: Date): string {
  const p = parts(d);
  return `${p.hour}:${p.minute}`;
}

/** 0 = Sunday. Pure calendar arithmetic, independent of process TZ. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Locale is accepted for API symmetry; 24h HH:MM is the same in en and tr.
export function formatSlotTime(d: Date, locale: Locale): string {
  void locale;
  return istanbulTimeOf(d);
}

export function formatLongDate(d: Date | string, locale: Locale): string {
  const inst = typeof d === "string" ? atIstanbul(d, "12:00") : d;
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(inst);
}
