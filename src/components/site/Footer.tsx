import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { clinic } from "@/config/clinic";
import { db } from "@/lib/db/client";
import { getOpeningHours } from "@/lib/public/queries";
import { summarizeHours } from "@/lib/public/hours";
import { LogoMark } from "./Logo";
import { NAV_ITEMS } from "./navItems";

const heading = "text-xs font-bold tracking-[0.14em] text-accent uppercase";

export default async function Footer({ locale }: { locale: Locale }) {
  const [t, nav, c] = await Promise.all([
    getTranslations("public.footer"),
    getTranslations("public.nav"),
    getTranslations("public.contact"),
  ]);
  const hours = await getOpeningHours(await db());

  return (
    <footer className="mt-24 bg-ink text-white/80">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.2fr_1fr]">
        <div>
          <p className="flex items-center gap-2 text-xl font-bold text-white">
            <LogoMark className="size-7 text-accent" />
            {clinic.name}
          </p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed">{t("tagline")}</p>
          <p className="mt-6 max-w-xs text-xs leading-relaxed text-white/70">{t("demoNote")}</p>
        </div>

        <div>
          <h2 className={heading}>{t("explore")}</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {NAV_ITEMS.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className="hover:text-white hover:underline">
                  {nav(i.key)}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/book" className="font-semibold text-white hover:underline">
                {nav("book")}
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h2 className={heading}>{t("visit")}</h2>
          <address className="mt-4 space-y-2.5 text-sm leading-relaxed not-italic">
            <p>{clinic.address}</p>
            <p>
              <a href={`tel:${clinic.phoneE164}`} className="hover:text-white hover:underline">
                {clinic.phoneDisplay}
              </a>
            </p>
            <p>
              <a href={`mailto:${clinic.email}`} className="hover:text-white hover:underline">
                {clinic.email}
              </a>
            </p>
          </address>
        </div>

        <div>
          <h2 className={heading}>{t("hours")}</h2>
          <dl className="mt-4 space-y-2.5 text-sm">
            {summarizeHours(hours.days, locale).map((row) => (
              <div key={row.label} className="flex justify-between gap-4">
                <dt>{row.label}</dt>
                <dd className="tabular-nums text-white">{row.hours ?? c("closed")}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-white/70 sm:px-6">
          {t("rights", { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
