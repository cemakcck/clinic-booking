import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { db } from "@/lib/db/client";
import { getTreatment } from "@/lib/public/queries";
import Avatar from "@/components/site/Avatar";
import PricingNote from "@/components/site/PricingNote";
import { Duration } from "@/components/site/TreatmentCard";

export const revalidate = 300;

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const tr = await getTreatment(await db(), slug, locale as Locale);
  return tr ? { title: tr.name, description: tr.description } : {};
}

export default async function TreatmentPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const treatment = await getTreatment(await db(), slug, locale as Locale);
  if (!treatment) notFound();
  const t = await getTranslations("public.treatments");
  const steps = [1, 2, 3] as const;

  return (
    <>
      <div className="border-b border-line bg-soft">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <Link href="/treatments" className="text-sm font-semibold text-brand underline-offset-4 hover:underline">
            <span aria-hidden="true">←&nbsp;</span>
            {t("back")}
          </Link>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-ink sm:text-5xl">{treatment.name}</h1>
          <div className="mt-4 flex items-center gap-3 text-sm text-mute">
            <span className="sr-only">{t("duration")}:</span>
            <Duration label={t("minutes", { count: treatment.durationMin })} />
          </div>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-mute">{treatment.description}</p>
          <Link
            href={`/book?treatment=${treatment.slug}`}
            className="mt-8 inline-flex rounded-card bg-brand px-5 py-3 text-[15px] font-semibold text-white hover:bg-ink"
          >
            {t("book")}
          </Link>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <h2 className="text-2xl font-bold text-ink">{t("visitTitle")}</h2>
          <ol className="mt-6 space-y-6">
            {steps.map((n) => (
              <li key={n} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-bold text-brand ring-1 ring-line"
                >
                  {n}
                </span>
                <div>
                  <h3 className="font-semibold text-ink">{t(`visit${n}Title`)}</h3>
                  <p className="mt-1 leading-relaxed text-mute">{t(`visit${n}`)}</p>
                </div>
              </li>
            ))}
          </ol>

          <h2 className="mt-12 text-2xl font-bold text-ink">{t("who")}</h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {treatment.dentists.map((d, i) => (
              <li key={d.slug} className="flex items-center gap-3 rounded-card border border-line p-3">
                <Avatar name={d.name} index={i} size="sm" />
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{d.name}</p>
                  <p className="text-[13px] leading-snug text-mute">{d.title}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <aside className="lg:pt-1">
          <PricingNote treatmentSlug={treatment.slug} />
        </aside>
      </div>
    </>
  );
}
