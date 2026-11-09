import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { db } from "@/lib/db/client";
import { listTreatments } from "@/lib/public/queries";
import PageHeader from "@/components/site/PageHeader";
import TreatmentCard from "@/components/site/TreatmentCard";

export const revalidate = 300;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "public.treatments" });
  return { title: t("metaTitle") };
}

export default async function TreatmentsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("public.treatments");
  const treatments = await listTreatments(await db(), locale as Locale);

  return (
    <>
      <PageHeader kicker={t("kicker")} title={t("title")} lead={t("lead")} />
      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {treatments.map((tr) => (
          <TreatmentCard key={tr.slug} treatment={tr} withPricing headingLevel={2} />
        ))}
      </div>
    </>
  );
}
