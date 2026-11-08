import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import PageHeader from "@/components/site/PageHeader";
import PricingNote from "@/components/site/PricingNote";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "public.international" });
  return { title: t("metaTitle") };
}

const ICONS = {
  english: "M4 6h16v10H9l-5 4V6Zm4 4h8M8 13h5",
  time: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.5V12l3 2",
  quote: "M6 3.5h9l3 3v14H6v-17Zm3 6h6M9 13h6M9 16.5h4",
} as const;

export default async function InternationalPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("public.international");
  const nav = await getTranslations("public.nav");
  const features = [
    { key: "english", title: t("englishTitle"), body: t("englishBody") },
    { key: "time", title: t("timeTitle"), body: t("timeBody") },
    { key: "quote", title: t("quoteTitle"), body: t("quoteBody") },
  ] as const;
  const steps = [1, 2, 3, 4] as const;

  return (
    <>
      <PageHeader kicker={t("kicker")} title={t("title")} lead={t("lead")}>
        <Link
          href="/book"
          className="mt-8 inline-flex rounded-card bg-brand px-5 py-3 text-[15px] font-semibold text-white hover:bg-ink"
        >
          {nav("book")}
        </Link>
      </PageHeader>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <ul className="grid gap-5 py-14 md:grid-cols-3">
          {features.map((f) => (
            <li key={f.key} className="rounded-card border border-line p-6">
              <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-soft text-brand">
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={ICONS[f.key]} />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold text-ink">{f.title}</h2>
              <p className="mt-2 leading-relaxed text-mute">{f.body}</p>
            </li>
          ))}
        </ul>

        <section className="rounded-[22px] bg-soft p-8 sm:p-10">
          <h2 className="text-2xl font-bold text-ink">{t("stepsTitle")}</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((n) => (
              <li key={n}>
                <span aria-hidden="true" className="text-sm font-bold text-brand">
                  0{n}
                </span>
                <h3 className="mt-2 font-semibold text-ink">{t(`step${n}Title`)}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-mute">{t(`step${n}`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid gap-10 py-14 lg:grid-cols-2">
          <section>
            <h2 className="text-2xl font-bold text-ink">{t("gettingTitle")}</h2>
            <p className="mt-3 leading-relaxed text-mute">{t("gettingBody")}</p>
          </section>
          <PricingNote />
        </div>
      </div>
    </>
  );
}
