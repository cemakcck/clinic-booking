import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.settings" });
  return { title: t("metaTitle") };
}

const SECTIONS = [
  { key: "dentists", href: "/staff/settings/dentists" },
  { key: "treatments", href: "/staff/settings/treatments" },
  { key: "hours", href: "/staff/settings/hours" },
] as const;

export default async function SettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await requireActor();
  if (!can(actor, "settings.view")) notFound();
  const t = await getTranslations("staff.settings");
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-ink">{t("title")}</h1>
      <p className="mt-1 text-sm text-mute">{t("lead")}</p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-3">
        {SECTIONS.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className="block h-full rounded-card border border-line bg-white p-4 hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <h2 className="text-[16px] font-bold text-ink">{t(`sections.${s.key}.title`)}</h2>
              <p className="mt-1 text-sm text-mute">{t(`sections.${s.key}.body`)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
