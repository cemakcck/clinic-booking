"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Avatar from "@/components/site/Avatar";
import { bookHref } from "./href";
import type { DentistOption, TreatmentOption } from "./types";

const card =
  "flex h-full items-center gap-3 rounded-card border-[1.5px] border-line bg-white p-4 transition-colors hover:border-brand hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default function StepDentist({
  treatment,
  notOffered,
}: {
  treatment: TreatmentOption & { dentists: DentistOption[] };
  notOffered: string | null;
}) {
  const t = useTranslations("booking.dentist");
  return (
    <>
      <p className="mt-1 text-[15px] text-mute">{t("sub", { treatment: treatment.name })}</p>
      {notOffered && (
        <p role="status" className="mt-4 rounded-card bg-soft p-3 text-sm text-ink ring-1 ring-line">
          {t("notOffered", { name: notOffered })}
        </p>
      )}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        <li className="sm:col-span-2">
          <Link data-testid="dentist-option" href={bookHref({ treatment: treatment.slug, dentist: "any" })} className={card}>
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-soft text-brand ring-1 ring-line">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="8" r="3" />
                <circle cx="17" cy="9" r="2.4" />
                <path d="M3.5 19a5.5 5.5 0 0 1 11 0M14.5 15.2A4.5 4.5 0 0 1 21 19" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink">{t("anyone")}</span>
              <span className="block text-[13px] leading-snug text-mute">{t("anyoneHint")}</span>
            </span>
          </Link>
        </li>
        {treatment.dentists.map((d, i) => (
          <li key={d.slug}>
            <Link data-testid="dentist-option" href={bookHref({ treatment: treatment.slug, dentist: d.slug })} className={card}>
              <Avatar name={d.name} index={i} size="sm" />
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{d.name}</span>
                <span className="block text-[13px] leading-snug text-mute">{d.title}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
