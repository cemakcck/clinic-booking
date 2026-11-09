import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import DemoDisabledNote from "@/components/staff/DemoDisabledNote";
import DentistForm from "@/components/staff/settings/DentistForm";
import { Link } from "@/i18n/navigation";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { isDemo } from "@/lib/demo/mode";
import { getDentist, listAllTreatments } from "@/lib/staff/settings";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.settings.dentists" });
  return { title: t("metaTitle") };
}

export default async function DentistSettingsPage({ params }: Props) {
  const { locale, id: raw } = await params;
  setRequestLocale(locale);
  const actor = await requireActor();
  if (!can(actor, "settings.view")) notFound();
  const t = await getTranslations("staff.settings");
  const conn = await db();
  const isNew = raw === "new";
  const id = Number(raw);
  if (!isNew && !(Number.isInteger(id) && id > 0)) notFound();
  const existing = isNew ? null : await getDentist(conn, actor, id);
  if (!isNew && !existing) notFound();
  const all = await listAllTreatments(conn, actor);

  return (
    <div>
      <Link href="/staff/settings/dentists" className="text-sm font-semibold text-brand underline-offset-4 hover:underline">
        <span aria-hidden="true">←&nbsp;</span>{t("backDentists")}
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-bold tracking-tight text-ink">
        {existing ? existing.name : t("dentists.newTitle")}
      </h1>
      <DentistForm
        // Remount when switching dentists so typed state never leaks between records.
        key={existing?.id ?? "new"}
        demo={isDemo()}
        note={<DemoDisabledNote />}
        treatments={all.map((x) => ({ id: x.id, name: locale === "tr" ? x.nameTr : x.nameEn }))}
        initial={
          existing ?? {
            slug: "", name: "", titleEn: "", titleTr: "", bioEn: "", bioTr: "",
            sortOrder: 0, active: true, treatmentIds: [], hours: [],
          }
        }
      />
    </div>
  );
}
