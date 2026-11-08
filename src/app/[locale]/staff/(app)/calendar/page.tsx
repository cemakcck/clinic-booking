import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

// PLACEHOLDER (Task 12): lands the receptionist/admin role redirect and the magic-moment
// `?date=` link somewhere real. Task 14 replaces this with the receptionist calendar.

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.placeholder" });
  return { title: t("calendarTitle") };
}

export default async function CalendarPlaceholder({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("staff.placeholder");
  const d = (await searchParams).date;
  const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  return (
    <div data-testid="calendar-placeholder" data-date={date ?? undefined}>
      <h1 className="text-2xl font-bold tracking-tight text-ink">{t("calendarTitle")}</h1>
      <p className="mt-2 text-mute">{t("body")}</p>
    </div>
  );
}
