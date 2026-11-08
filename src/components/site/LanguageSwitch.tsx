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
    <nav aria-label={t("label")} className="flex">
      <Link
        href={pathname}
        locale={other}
        hrefLang={other}
        lang={other}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-semibold text-brand hover:bg-soft"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5Z" />
        </svg>
        {t(other)}
      </Link>
    </nav>
  );
}
