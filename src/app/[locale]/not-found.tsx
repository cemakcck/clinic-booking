import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold text-brand">{t("title")}</h1>
      <Link href="/" className="mt-4 inline-block text-brand-2 underline">
        {t("back")}
      </Link>
    </main>
  );
}
