import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { btnPrimary } from "@/components/calendar/ui";
import { Link } from "@/i18n/navigation";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { listDentists } from "@/lib/staff/settings";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.settings.dentists" });
  return { title: t("metaTitle") };
}

export default async function DentistsSettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await requireActor();
  if (!can(actor, "settings.view")) notFound();
  const t = await getTranslations("staff.settings");
  const rows = await listDentists(await db(), actor);
  return (
    <div className="max-w-3xl">
      <Link href="/staff/settings" className="text-sm font-semibold text-brand underline-offset-4 hover:underline">
        <span aria-hidden="true">←&nbsp;</span>{t("back")}
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t("dentists.title")}</h1>
        <Link href="/staff/settings/dentists/new" className={btnPrimary}>{t("dentists.new")}</Link>
      </div>
      <p className="mt-1 text-sm text-mute">{t("dentists.lead")}</p>
      {rows.length === 0 ? (
        <p className="mt-4 rounded-card border border-line bg-white p-5 text-sm text-mute">{t("dentists.empty")}</p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {rows.map((d) => (
            <li key={d.id}>
              <Link
                href={`/staff/settings/dentists/${d.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-white px-4 py-3 hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span><b className="text-ink">{d.name}</b> <span className="text-sm text-mute">{locale === "tr" ? d.titleTr : d.titleEn}</span></span>
                {!d.active && <span className="rounded-full bg-[#eef1f0] px-2.5 py-1 text-xs font-semibold text-[#3f5250]">{t("no")}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
