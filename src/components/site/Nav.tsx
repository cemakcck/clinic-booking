"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { clinic } from "@/config/clinic";
import LanguageSwitch from "./LanguageSwitch";
import Logo from "./Logo";
import MobileMenu from "./MobileMenu";
import { isActive, NAV_ITEMS } from "./navItems";

export default function Nav() {
  const t = useTranslations("public.nav");
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6 lg:h-[72px]">
        <Link href="/" className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
          <Logo name={clinic.shortName} />
        </Link>

        <nav aria-label={t("main")} className="hidden md:block">
          <ul className="flex items-center gap-1 text-[15px]">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative rounded-lg px-3 py-2 transition-colors ${
                      active ? "font-semibold text-ink" : "text-mute hover:text-ink"
                    }`}
                  >
                    {t(item.key)}
                    {active && (
                      <span aria-hidden="true" className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-brand-2 lg:-bottom-[17px]" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitch />
          <Link
            href="/book"
            className="hidden rounded-card bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink md:inline-flex"
          >
            {t("book")}
          </Link>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
