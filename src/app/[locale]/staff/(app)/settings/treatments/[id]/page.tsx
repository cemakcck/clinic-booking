import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import DemoDisabledNote from "@/components/staff/DemoDisabledNote";
import TreatmentForm from "@/components/staff/settings/TreatmentForm";
import { Link } from "@/i18n/navigation";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { isDemo } from "@/lib/demo/mode";
import { getTreatment } from "@/lib/staff/settings";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.settings.treatments" });
  return { title: t("metaTitle") };
}

export default async function TreatmentSettingsPage({ params }: Props) {
  const { locale, id: raw } = await params;
  setRequestLocale(locale);
  const actor = await requireActor();
  if (!can(actor, "settings.view")) notFound();
  const t = await getTranslations("staff.settings");
  const isNew = raw === "new";
  const id = Number(raw);
  if (!isNew && !(Number.isInteger(id) && id > 0)) notFound();
  const existing = isNew ? null : await getTreatment(await db(), actor, id);
  if (!isNew && !existing) notFound();

  return (
    <div>
      <Link href="/staff/settings/treatments" className="text-sm font-semibold text-brand underline-offset-4 hover:underline">
        <span aria-hidden="true">←&nbsp;</span>{t("backTreatments")}
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-bold tracking-tight text-ink">
        {existing ? (locale === "tr" ? existing.nameTr : existing.nameEn) : t("treatments.newTitle")}
      </h1>
      <TreatmentForm
        key={existing?.id ?? "new"}
        demo={isDemo()}
        note={<DemoDisabledNote />}
        initial={existing ?? { slug: "", nameEn: "", nameTr: "", descEn: "", descTr: "", durationMin: 30, sortOrder: 0, active: true }}
      />
    </div>
  );
}
