import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { TreatmentSummary } from "@/lib/public/queries";
import PricingNote from "./PricingNote";

export function Duration({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-brand ring-1 ring-line">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
      {label}
    </span>
  );
}

export default async function TreatmentCard({
  treatment,
  withPricing = false,
  headingLevel = 3,
}: {
  treatment: TreatmentSummary;
  withPricing?: boolean;
  headingLevel?: 2 | 3;
}) {
  const t = await getTranslations("public.treatments");
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <article
      data-testid="treatment-card"
      className="group flex flex-col rounded-card bg-soft p-5 transition-shadow hover:shadow-[0_10px_30px_-14px_rgba(16,48,46,0.35)]"
    >
      <Duration label={t("minutes", { count: treatment.durationMin })} />
      <H className="mt-4 text-lg font-bold leading-snug text-ink">
        <Link href={`/treatments/${treatment.slug}`} className="underline-offset-4 hover:underline">
          {treatment.name}
        </Link>
      </H>
      <p className="mt-2 text-sm leading-relaxed text-mute">{treatment.description}</p>
      <div className="mt-auto pt-5">
        {withPricing && (
          <div className="mb-4 border-t border-line pt-4">
            <PricingNote treatmentSlug={treatment.slug} compact />
          </div>
        )}
        <Link
          href={`/treatments/${treatment.slug}`}
          aria-label={t("detailsFor", { name: treatment.name })}
          className="inline-flex items-center text-sm font-semibold text-brand"
        >
          {t("details")}
          <span aria-hidden="true" className="ml-1 transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      </div>
    </article>
  );
}
