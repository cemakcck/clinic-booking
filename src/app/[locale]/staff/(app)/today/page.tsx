import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import TodayList from "@/components/staff/TodayList";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { getTodayForDentist } from "@/lib/staff/calendar-data";
import { formatLongDate, istanbulDateOf, istanbulTimeOf } from "@/lib/time";
import type { Locale } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.today" });
  return { title: t("metaTitle") };
}

/** The dentist's phone-first landing: today's own patients, the next one highlighted. */
export default async function TodayPage({ params }: Props) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw as Locale;
  // Pages authorize themselves: the layout's check alone can be skipped by segment requests.
  const actor = await requireActor();
  if (actor.dentistId === null || !can(actor, "appointment.status", { dentistId: actor.dentistId })) notFound();

  const now = new Date();
  const t = await getTranslations("staff.today");
  const { items, nextId } = await getTodayForDentist(await db(), actor, now, { locale });
  const hour = Number(istanbulTimeOf(now).slice(0, 2));
  const greeting = hour < 12 ? t("greetingMorning") : hour < 18 ? t("greetingAfternoon") : t("greetingEvening");
  const today = istanbulDateOf(now);

  return (
    <TodayList
      locale={locale}
      greeting={greeting}
      name={actor.name}
      dateLabel={formatLongDate(today, locale)}
      today={today}
      dentistId={actor.dentistId}
      items={items}
      nextId={nextId}
    />
  );
}
