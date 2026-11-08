import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { clinic } from "@/config/clinic";
import { db } from "@/lib/db/client";
import { listDentists, listTreatments } from "@/lib/public/queries";
import DentistCard from "@/components/site/DentistCard";
import HeroArt from "@/components/site/HeroArt";
import NextFreeSlot from "@/components/site/NextFreeSlot";
import PricingNote from "@/components/site/PricingNote";
import TreatmentCard from "@/components/site/TreatmentCard";

// The "Next free slot" card is computed live on every request.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "public.home" });
  return { title: t("metaTitle") };
}

const btn = "inline-flex items-center justify-center rounded-card px-5 py-3 text-[15px] font-semibold transition-colors";

function SectionHead({ kicker, title, lead, link }: { kicker: string; title: string; lead: string; link?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold text-brand">{kicker}</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-[34px]">{title}</h2>
        <p className="mt-3 leading-relaxed text-mute">{lead}</p>
      </div>
      {link}
    </div>
  );
}

const arrowLink = "inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand underline-offset-4 hover:underline";

export default async function HomePage({ params }: Props) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw as Locale;
  const t = await getTranslations("public.home");
  const nav = await getTranslations("public.nav");
  const conn = await db();
  const [treatments, dentists] = await Promise.all([listTreatments(conn, locale), listDentists(conn, locale)]);

  const reviews = [1, 2, 3] as const;

  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-20 lg:pb-24">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-soft px-3 py-1.5 text-[13px] font-semibold text-brand">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-brand-2" />
            {t("eyebrow")}
          </p>
          <h1 className="mt-5 text-[40px] leading-[1.06] font-bold tracking-[-0.02em] text-balance text-ink sm:text-5xl lg:text-[54px]">
            {t.rich("title", { em: (chunks) => <span className="text-brand-2">{chunks}</span> })}
          </h1>
          <p className="mt-5 max-w-[520px] text-lg leading-relaxed text-mute">{t("lead")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/book" className={`${btn} bg-brand text-white hover:bg-ink`}>
              {nav("book")}
            </Link>
            <Link href="/treatments" className={`${btn} border-[1.5px] border-brand text-brand hover:bg-soft`}>
              {t("seeTreatments")}
            </Link>
          </div>
          <ul className="mt-10 flex flex-wrap gap-x-10 gap-y-4 text-[13px] text-mute">
            <li>
              <span className="block text-2xl font-bold text-ink">{t("trustRating")}</span>
              {t("trustRatingLabel")}
            </li>
            <li>
              <span className="block text-2xl font-bold text-ink">{dentists.length}</span>
              {t("trustDentistsLabel")}
            </li>
            <li>
              <span className="block text-2xl font-bold text-ink">{t("trustLanguages")}</span>
              {t("trustLanguagesLabel")}
            </li>
          </ul>
        </div>

        <div className="relative lg:pl-4">
          <div className="aspect-[13/11] overflow-hidden rounded-[22px] ring-1 ring-line">
            <HeroArt label={t("artLabel")} />
          </div>
          <NextFreeSlot
            locale={locale}
            className="relative mx-4 -mt-12 sm:absolute sm:bottom-7 sm:-left-6 sm:mx-0 sm:mt-0 sm:min-w-[260px]"
          />
        </div>
      </section>

      {/* Treatments */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <SectionHead
          kicker={t("treatmentsKicker")}
          title={t("treatmentsTitle")}
          lead={t("treatmentsLead")}
          link={
            <Link href="/treatments" className={arrowLink}>
              {t("allTreatments")} <span aria-hidden="true">→</span>
            </Link>
          }
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {treatments.slice(0, 4).map((tr) => (
            <TreatmentCard key={tr.slug} treatment={tr} />
          ))}
        </div>
        <div className="mt-5 rounded-card border border-dashed border-line px-5 py-4">
          <PricingNote compact />
        </div>
      </section>

      {/* Dentists */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <SectionHead
          kicker={t("dentistsKicker")}
          title={t("dentistsTitle")}
          lead={t("dentistsLead")}
          link={
            <Link href="/dentists" className={arrowLink}>
              {t("allDentists")} <span aria-hidden="true">→</span>
            </Link>
          }
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {dentists.map((d, i) => (
            <DentistCard key={d.slug} dentist={d} index={i} variant="compact" />
          ))}
        </div>
      </section>

      {/* Reviews (demo) */}
      <section className="mt-12 bg-soft">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-brand">{t("reviewsKicker")}</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-[34px]">{t("reviewsTitle")}</h2>
            </div>
            <p className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-mute ring-1 ring-line">
              {t("reviewsTag")}
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {reviews.map((n) => (
              <figure key={n} className="flex flex-col rounded-card bg-white p-6">
                <svg aria-hidden="true" viewBox="0 0 32 24" className="h-5 w-7 text-accent">
                  <path
                    fill="currentColor"
                    d="M0 24V14C0 6 4.5 1.3 12 0l1.4 3.6C9 5 7 7.6 6.8 11H12v13H0Zm19 0V14c0-8 4.5-12.7 12-14l1 3.6c-4.4 1.4-6.4 4-6.6 7.4H31v13H19Z"
                  />
                </svg>
                <blockquote className="mt-4 leading-relaxed text-ink">{t(`review${n}`)}</blockquote>
                <figcaption className="mt-auto pt-5 text-sm font-semibold text-mute">{t(`review${n}Name`)}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* International + CTA */}
      <section className="mx-auto grid max-w-6xl gap-4 px-4 pt-16 sm:px-6 lg:grid-cols-2">
        <div className="rounded-[22px] border border-line p-8 sm:p-10">
          <h2 className="text-2xl font-bold text-ink">{t("intlTitle")}</h2>
          <p className="mt-3 max-w-md leading-relaxed text-mute">{t("intlBody")}</p>
          <Link href="/international" className={`${arrowLink} mt-6`}>
            {t("intlLink")} <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="relative overflow-hidden rounded-[22px] bg-brand p-8 text-white sm:p-10">
          <svg aria-hidden="true" viewBox="-30 -40 60 44" className="absolute -top-6 -right-8 w-48 rotate-[200deg] text-white/10">
            <path fill="currentColor" d="M0 0C-15-5-24-21-14-32-7-39 0-35 0-28 0-35 7-39 14-32 24-21 15-5 0 0Z" />
          </svg>
          <h2 className="relative text-2xl font-bold">{t("ctaTitle")}</h2>
          <p className="relative mt-3 max-w-md leading-relaxed text-white/85">{t("ctaBody")}</p>
          <div className="relative mt-6 flex flex-wrap gap-3">
            <Link href="/book" className={`${btn} bg-white text-brand hover:bg-soft`}>
              {nav("book")}
            </Link>
            <a href={`tel:${clinic.phoneE164}`} className={`${btn} border-[1.5px] border-white/60 text-white hover:bg-white/10`}>
              {clinic.phoneDisplay}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
