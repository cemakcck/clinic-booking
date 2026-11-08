import { getTranslations, setRequestLocale } from "next-intl/server";
import LanguageSwitch from "@/components/site/LanguageSwitch";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <main className="mx-auto max-w-3xl p-6">
      <LanguageSwitch />
      <h1 className="mt-8 text-3xl font-bold text-brand">{t("title")}</h1>
    </main>
  );
}
