import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import DemoBanner from "@/components/site/DemoBanner";
import Footer from "@/components/site/Footer";
import Nav from "@/components/site/Nav";

export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("public.nav");

  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-card bg-brand px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t("skip")}
      </a>
      <DemoBanner role="patient" />
      <Nav />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <Footer locale={locale as Locale} />
    </>
  );
}
