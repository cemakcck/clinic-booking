import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { clinic } from "@/config/clinic";

const href = (slug?: string) => (slug ? `/contact?treatment=${encodeURIComponent(slug)}#callback` : "/contact#callback");

/** Shown wherever a price would be. Never a number: a call link and a call-back request instead. */
export default async function PricingNote({
  treatmentSlug,
  compact = false,
}: {
  treatmentSlug?: string;
  compact?: boolean;
}) {
  const t = await getTranslations("public.pricing");

  if (compact) {
    return (
      <div data-testid="pricing-note" className="text-[13px] leading-relaxed text-mute">
        <p>{t("note")}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 font-semibold">
          <a href={`tel:${clinic.phoneE164}`} className="text-brand underline-offset-4 hover:underline">
            {t("callShort")}
          </a>
          <Link href={href(treatmentSlug)} className="text-brand underline-offset-4 hover:underline">
            {t("callback")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div data-testid="pricing-note" className="rounded-card border border-line bg-soft p-5 sm:p-6">
      <div className="flex gap-4">
        <span aria-hidden="true" className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-brand">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 12.5V5.8C4 4.8 4.8 4 5.8 4h6.7l7.5 7.5-8.5 8.5L4 12.5Z" strokeLinejoin="round" />
            <circle cx="8.5" cy="8.5" r="1.3" />
          </svg>
        </span>
        <div>
          <p className="font-semibold text-ink">{t("note")}</p>
          <p className="mt-1 text-sm leading-relaxed text-mute">{t("body")}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={`tel:${clinic.phoneE164}`}
              className="inline-flex items-center gap-2 rounded-card bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 4h3l1.5 4-2 1.2a11 11 0 0 0 7.3 7.3l1.2-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
              </svg>
              {t("call", { phone: clinic.phoneDisplay })}
            </a>
            <Link
              href={href(treatmentSlug)}
              className="inline-flex items-center rounded-card border-[1.5px] border-brand bg-white px-4 py-2.5 text-sm font-semibold text-brand hover:bg-soft"
            >
              {t("callback")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
