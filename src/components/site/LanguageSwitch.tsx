"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export default function LanguageSwitch() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("language");
  const other = routing.locales.find((l) => l !== locale) ?? routing.defaultLocale;

  return (
    <nav aria-label={t("label")} className="flex justify-end">
      <Link href={pathname} locale={other} hrefLang={other} lang={other} className="text-sm font-semibold text-brand underline">
        {t(other)}
      </Link>
    </nav>
  );
}
