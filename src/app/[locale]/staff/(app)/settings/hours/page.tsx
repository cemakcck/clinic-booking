import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import DemoDisabledNote from "@/components/staff/DemoDisabledNote";
import ClosedDates from "@/components/staff/settings/ClosedDates";
import HoursForm from "@/components/staff/settings/HoursForm";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { isDemo } from "@/lib/demo/mode";
import { getClinicHours, listClosedDates } from "@/lib/staff/settings";
import { formatLongDate } from "@/lib/time";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.settings.hours" });
  return { title: t("metaTitle") };
}

export default async function HoursSettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await requireActor();
  if (!can(actor, "settings.view")) notFound();
  const t = await getTranslations("staff.settings");
  const conn = await db();
  const [hours, closed] = await Promise.all([getClinicHours(conn, actor), listClosedDates(conn, actor)]);
  const demo = isDemo();
  return (
    <div>
      <Link href="/staff/settings" className="text-sm font-semibold text-brand underline-offset-4 hover:underline">
        <span aria-hidden="true">←&nbsp;</span>{t("back")}
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">{t("hours.title")}</h1>
      <p className="mt-1 mb-4 text-sm text-mute">{t("hours.lead")}</p>
      <HoursForm initial={hours} demo={demo} note={<DemoDisabledNote />} />
      <ClosedDates
        demo={demo}
        note={<DemoDisabledNote />}
        items={closed.map((c) => ({
          date: c.date,
          label: locale === "tr" ? c.labelTr : c.labelEn,
          shown: `${formatLongDate(c.date, locale as Locale)} ${c.date.slice(0, 4)}`,
        }))}
      />
    </div>
  );
}
