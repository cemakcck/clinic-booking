"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { bookHref } from "./href";
import type { DentistOption, TreatmentOption } from "./types";

export default function StepTreatment({
  treatments,
  preDentist,
}: {
  treatments: TreatmentOption[];
  preDentist: DentistOption | null;
}) {
  const t = useTranslations("booking.treatment");
  return (
    <>
      <p className="mt-1 text-[15px] text-mute">{preDentist ? t("with", { name: preDentist.name }) : t("sub")}</p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {treatments.map((tr) => (
          <li key={tr.slug}>
            <Link
              data-testid="treatment-option"
              href={bookHref({ treatment: tr.slug, dentist: preDentist?.slug })}
              className="group flex h-full flex-col rounded-card border-[1.5px] border-line bg-white p-4 transition-colors hover:border-brand hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-ink">{tr.name}</span>
                <span className="shrink-0 text-[13px] font-medium text-mute">{t("minutes", { count: tr.durationMin })}</span>
              </span>
              <span className="mt-1 line-clamp-2 text-sm leading-relaxed text-mute">{tr.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
