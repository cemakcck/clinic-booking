import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { db } from "@/lib/db/client";
import { listDentists, listTreatments } from "@/lib/public/queries";
import { loadDayData, resolveSelection } from "@/lib/booking/wizard";
import PricingNote from "@/components/site/PricingNote";
import Wizard from "@/components/booking/Wizard";
import type { WizardProps } from "@/components/booking/types";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "booking" });
  return { title: t("metaTitle") };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Steps 1-3 are derived from ?treatment=<slug>&dentist=<slug>|any&date=YYYY-MM-DD, server side. */
export default async function BookPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("booking");
  const conn = await db();

  const [treatments, dentists, sel] = await Promise.all([
    listTreatments(conn, locale),
    listDentists(conn, locale),
    resolveSelection(conn, locale, one(sp.treatment), one(sp.dentist)),
  ]);
  const linked = dentists.find((d) => d.slug === one(sp.dentist)) ?? null;
  const preDentist = linked ? { slug: linked.slug, name: linked.name, title: linked.title } : null;

  let step: WizardProps["step"] = 1;
  let day: WizardProps["day"] = null;
  if (sel) {
    step = sel.dentistId === null ? 2 : 3;
    if (sel.dentistId !== null) {
      day = await loadDayData(conn, {
        treatmentId: sel.treatment.id,
        dentistId: sel.dentistId,
        date: one(sp.date),
        now: new Date(),
        locale,
      });
    }
  }

  return (
    <>
      <div className="border-b border-line bg-soft">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          <p className="text-sm font-semibold text-brand">{t("kicker")}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-mute">{t("lead")}</p>
        </div>
      </div>
      <Wizard
        locale={locale}
        step={step}
        treatments={treatments.map(({ slug, name, description, durationMin }) => ({ slug, name, description, durationMin }))}
        treatment={
          sel
            ? {
                slug: sel.treatment.slug,
                name: sel.treatment.name,
                description: sel.treatment.description,
                durationMin: sel.treatment.durationMin,
                dentists: sel.treatment.dentists.map(({ slug, name, title }) => ({ slug, name, title })),
              }
            : null
        }
        dentist={sel?.dentistSlug ?? null}
        preDentist={step === 1 ? preDentist : null}
        notOffered={step === 2 && preDentist ? preDentist.name : null}
        day={day}
        pricing={<PricingNote compact treatmentSlug={sel?.treatment.slug} />}
      />
    </>
  );
}
