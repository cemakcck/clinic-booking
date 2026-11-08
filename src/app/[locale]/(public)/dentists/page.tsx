import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { db } from "@/lib/db/client";
import { listDentists } from "@/lib/public/queries";
import DentistCard from "@/components/site/DentistCard";
import PageHeader from "@/components/site/PageHeader";

export const revalidate = 300;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "public.dentists" });
  return { title: t("metaTitle") };
}

export default async function DentistsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("public.dentists");
  const dentists = await listDentists(await db(), locale as Locale);

  return (
    <>
      <PageHeader kicker={t("kicker")} title={t("title")} lead={t("lead")} />
      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-14 sm:px-6 md:grid-cols-2">
        {dentists.map((d, i) => (
          <DentistCard key={d.slug} dentist={d} index={i} />
        ))}
      </div>
    </>
  );
}
