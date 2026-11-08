import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { clinic } from "@/config/clinic";
import Logo from "@/components/site/Logo";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-soft px-4 text-center">
      <Link href="/" className="mb-10">
        <Logo name={clinic.shortName} />
      </Link>
      <p aria-hidden="true" className="text-7xl font-bold tracking-tight text-accent">
        404
      </p>
      <h1 className="mt-4 text-2xl font-bold text-ink">{t("title")}</h1>
      <Link href="/" className="mt-6 inline-flex rounded-card bg-brand px-5 py-3 font-semibold text-white hover:bg-ink">
        {t("back")}
      </Link>
    </main>
  );
}
