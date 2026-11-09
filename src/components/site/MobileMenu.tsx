"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { isActive, NAV_ITEMS } from "./navItems";

/** Phone-width menu. It is "open for a pathname", so navigating anywhere closes it without an effect. */
export default function MobileMenu() {
  const t = useTranslations("public.nav");
  const pathname = usePathname();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const close = () => setOpenAt(null);

  return (
    <div className="md:hidden" onKeyDown={(e) => e.key === "Escape" && close()}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpenAt(open ? null : pathname)}
        className="-mr-2 flex size-11 items-center justify-center rounded-card text-ink hover:bg-soft"
      >
        <span className="sr-only">{t("menu")}</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h10" />}
        </svg>
      </button>

      <div
        id="mobile-menu"
        data-testid="mobile-menu"
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-line bg-white shadow-[0_18px_30px_-20px_rgba(16,48,46,0.4)]"
      >
        <nav aria-label={t("mobile")} className="px-4 pt-2 pb-5">
          <ul className="divide-y divide-line">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center justify-between py-3.5 text-base ${active ? "font-semibold text-brand" : "text-ink"}`}
                  >
                    {t(item.key)}
                    <span aria-hidden="true" className="text-mute">
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            href="/book"
            onClick={close}
            className="mt-4 flex justify-center rounded-card bg-brand px-4 py-3 font-semibold text-white"
          >
            {t("book")}
          </Link>
        </nav>
      </div>
    </div>
  );
}
