import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Heatmap from "@/components/staff/dashboard/Heatmap";
import PeriodPicker from "@/components/staff/dashboard/PeriodPicker";
import Tiles from "@/components/staff/dashboard/Tiles";
import UtilisationBars from "@/components/staff/dashboard/UtilisationBars";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { dashboardData } from "@/lib/dashboard/metrics";
import { PERIODS, type Period } from "@/lib/dashboard/periods";
import type { Locale } from "@/i18n/routing";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.dashboard" });
  return { title: t("metaTitle") };
}

const h2 = "text-base font-bold tracking-tight text-ink";

export default async function DashboardPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw as Locale;
  const actor = await requireActor();
  if (!can(actor, "dashboard.view")) notFound();

  const q = (await searchParams).period;
  const period: Period = PERIODS.find((p) => p === (Array.isArray(q) ? q[0] : q)) ?? "week";
  const t = await getTranslations("staff.dashboard");
  // Scoped inside dashboardData: a dentist's result holds only their own numbers and name.
  const data = await dashboardData(await db(), actor, period, new Date());

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{t("title")}</h1>
          <p className="mt-1 text-sm text-mute">{data.scope.dentistId === null ? t("leadClinic") : t("leadOwn")}</p>
        </div>
        <PeriodPicker active={period} />
      </div>

      <section aria-labelledby="dash-headline" className="mt-6">
        <h2 id="dash-headline" className={`${h2} mb-3`}>{t("headline")}</h2>
        <Tiles data={data} locale={locale} />
      </section>

      <section aria-labelledby="dash-util" className="mt-8">
        <h2 id="dash-util" className={h2}>{t("utilisation.title")}</h2>
        <p className="mt-0.5 mb-3 text-sm text-mute">
          {t("utilisation.lead")}
          {period === "week" && (
            <>
              {" "}
              <strong className="font-semibold text-ink">{t("utilisation.weekNote")}</strong>.
            </>
          )}
        </p>
        <UtilisationBars data={data} locale={locale} />
      </section>

      <section aria-labelledby="dash-heat" className="mt-8">
        <h2 id="dash-heat" className={h2}>{t("heatmap.title")}</h2>
        <p className="mt-0.5 mb-3 text-sm text-mute">{t("heatmap.lead")}</p>
        <Heatmap data={data} locale={locale} />
      </section>
    </div>
  );
}
