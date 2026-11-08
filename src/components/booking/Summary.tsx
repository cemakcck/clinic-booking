"use client";

import { useTranslations } from "next-intl";

/** The side panel from the mockup. Where the mockup shows a price, the PricingNote sits instead. */
export default function Summary({
  step,
  treatment,
  dentist,
  when,
  canContinue,
  holding,
  onContinue,
  pricing,
}: {
  step: 1 | 2 | 3 | 4;
  treatment: { name: string; durationMin: number } | null;
  dentist: string | null;
  when: string | null;
  canContinue: boolean;
  holding: boolean;
  onContinue: () => void;
  pricing: React.ReactNode;
}) {
  const t = useTranslations("booking.summary");
  const tm = useTranslations("booking.treatment");
  const none = <span className="text-mute">{t("notChosen")}</span>;
  const row = "flex justify-between gap-4 border-b border-line py-2.5";

  return (
    <aside data-testid="summary" aria-labelledby="summary-title" className="self-start rounded-[18px] bg-soft p-5 text-sm lg:sticky lg:top-6">
      <h2 id="summary-title" className="mb-3 text-lg font-bold text-ink">
        {t("title")}
      </h2>
      <dl>
        <div className={row}>
          <dt className="text-mute">{t("treatment")}</dt>
          <dd className="text-right font-medium text-ink">
            {treatment ? `${treatment.name} · ${tm("minutes", { count: treatment.durationMin })}` : none}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-mute">{t("dentist")}</dt>
          <dd className="text-right font-medium text-ink">{dentist ?? none}</dd>
        </div>
        <div className={row}>
          <dt className="text-mute">{t("when")}</dt>
          <dd className="text-right font-medium text-ink">
            {when ? (
              <>
                {when}
                <span className="block text-xs font-normal text-mute">{t("tz")}</span>
              </>
            ) : (
              none
            )}
          </dd>
        </div>
        <div className="border-b border-line py-2.5">
          <dt className="sr-only">{t("pricing")}</dt>
          <dd>{pricing}</dd>
        </div>
      </dl>
      {step === 3 && (
        <>
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="mt-4 w-full rounded-card bg-brand px-5 py-3 text-[15px] font-semibold text-white hover:bg-ink disabled:cursor-not-allowed disabled:bg-brand/50"
          >
            {holding ? t("holding") : t("continue")}
          </button>
          <p className="mt-2.5 text-[13px] leading-snug text-mute">{t("holdNote")}</p>
        </>
      )}
    </aside>
  );
}
