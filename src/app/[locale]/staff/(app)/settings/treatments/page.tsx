import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { btnPrimary } from "@/components/calendar/ui";
import { Link } from "@/i18n/navigation";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { listAllTreatments } from "@/lib/staff/settings";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.settings.treatments" });
  return { title: t("metaTitle") };
}

export default async function TreatmentsSettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await requireActor();
  if (!can(actor, "settings.view")) notFound();
  const t = await getTranslations("staff.settings");
  const rows = await listAllTreatments(await db(), actor);
  return (
    <div className="max-w-3xl">
      <Link href="/staff/settings" className="text-sm font-semibold text-brand underline-offset-4 hover:underline">
        <span aria-hidden="true">←&nbsp;</span>{t("back")}
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t("treatments.title")}</h1>
        <Link href="/staff/settings/treatments/new" className={btnPrimary}>{t("treatments.new")}</Link>
      </div>
      <p className="mt-1 text-sm text-mute">{t("treatments.lead")}</p>
      {rows.length === 0 ? (
        <p className="mt-4 rounded-card border border-line bg-white p-5 text-sm text-mute">{t("treatments.empty")}</p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/staff/settings/treatments/${r.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-white px-4 py-3 hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span><b className="text-ink">{locale === "tr" ? r.nameTr : r.nameEn}</b> <span className="text-sm text-mute">{t("treatments.minutes", { n: r.durationMin })}</span></span>
                {!r.active && <span className="rounded-full bg-[#eef1f0] px-2.5 py-1 text-xs font-semibold text-[#3f5250]">{t("no")}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
