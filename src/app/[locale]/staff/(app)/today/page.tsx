import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

// PLACEHOLDER (Task 12): lands the dentist role redirect somewhere real. Task 15 replaces this
// with the dentist's "today" phone view.

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.placeholder" });
  return { title: t("todayTitle") };
}

export default async function TodayPlaceholder({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("staff.placeholder");
  return (
    <div data-testid="today-placeholder">
      <h1 className="text-2xl font-bold tracking-tight text-ink">{t("todayTitle")}</h1>
      <p className="mt-2 text-mute">{t("body")}</p>
    </div>
  );
}
