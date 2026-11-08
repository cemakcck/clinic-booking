import type { DbOrTx } from "@/lib/db/client";
import { getDaySlots, getDayStrip } from "@/lib/booking/availability";
import { getTreatment, type TreatmentDetail } from "@/lib/public/queries";
import { PUBLIC_HORIZON_DAYS } from "@/config/booking";
import { addDays, atIstanbul, formatLongDate, formatSlotTime, istanbulDateOf, TZ } from "@/lib/time";
import type { Locale } from "@/i18n/routing";

/** Server-side helpers shared by the /book page and its server actions. */

export type StripDay = { date: string; available: boolean; dow: string; dom: string; short: string; long: string };
export type SlotView = { start: string; label: string };
export type DayData = {
  date: string;
  strip: StripDay[];
  slots: SlotView[];
  prevFrom: string | null;
  nextFrom: string | null;
};

export type Selection = { treatment: TreatmentDetail; dentistId: number | "any" | null; dentistSlug: string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCALE_TAG: Record<Locale, string> = { en: "en-GB", tr: "tr-TR" };
const STRIP_DAYS = 7;

export const isDate = (s: unknown): s is string =>
  typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && addDays(s, 0) === s;

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Resolves slugs from the URL or the client to ids, server side. The dentist must perform the
 * treatment; otherwise it resolves to null so the dentist step is shown.
 */
export async function resolveSelection(
  db: DbOrTx,
  locale: Locale,
  treatmentSlug: unknown,
  dentist: unknown,
): Promise<Selection | null> {
  if (typeof treatmentSlug !== "string" || treatmentSlug.length > 80) return null;
  const treatment = await getTreatment(db, treatmentSlug, locale);
  if (!treatment) return null;
  if (dentist === "any") return { treatment, dentistId: "any", dentistSlug: "any" };
  const d = typeof dentist === "string" ? treatment.dentists.find((x) => x.slug === dentist) : undefined;
  return { treatment, dentistId: d?.id ?? null, dentistSlug: d?.slug ?? null };
}

function dayLabels(date: string, locale: Locale) {
  const inst = atIstanbul(date, "12:00");
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE_TAG[locale], { timeZone: TZ, ...o }).format(inst);
  return {
    dow: f({ weekday: "short" }),
    dom: f({ day: "numeric" }),
    short: formatLongDate(date, locale),
    long: f({ weekday: "long", day: "numeric", month: "long" }),
  };
}

/**
 * A 7-day page of the strip (pages start today and step by 7 up to the public horizon) and the
 * free times of one day. If the requested day has nothing free, the first free day on that page
 * is chosen instead. All labels are Istanbul wall time, formatted here on the server.
 */
export async function loadDayData(
  db: DbOrTx,
  q: { treatmentId: number; dentistId: number | "any"; date?: string; now: Date; locale: Locale },
): Promise<DayData> {
  const today = istanbulDateOf(q.now);
  const lastDay = addDays(today, PUBLIC_HORIZON_DAYS);
  let date = isDate(q.date) ? q.date : today;
  if (date < today || date > lastDay) date = today;

  const page = Math.floor(daysBetween(today, date) / STRIP_DAYS);
  const from = addDays(today, page * STRIP_DAYS);
  const raw = await getDayStrip(db, {
    treatmentId: q.treatmentId,
    dentistId: q.dentistId,
    from,
    days: STRIP_DAYS,
    now: q.now,
    audience: "public",
  });
  const strip = raw.map((d) => ({ ...d, ...dayLabels(d.date, q.locale) }));
  if (!strip.find((d) => d.date === date)?.available) {
    date = strip.find((d) => d.available)?.date ?? date;
  }

  const slots = await getDaySlots(db, {
    treatmentId: q.treatmentId,
    dentistId: q.dentistId,
    date,
    now: q.now,
    audience: "public",
  });
  const nextFrom = addDays(from, STRIP_DAYS);
  return {
    date,
    strip,
    slots: slots.map((s) => ({ start: s.start.toISOString(), label: formatSlotTime(s.start, q.locale) })),
    prevFrom: page > 0 ? addDays(from, -STRIP_DAYS) : null,
    nextFrom: nextFrom <= lastDay ? nextFrom : null,
  };
}
