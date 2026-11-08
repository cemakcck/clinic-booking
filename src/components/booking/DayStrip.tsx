"use client";

import { useTranslations } from "next-intl";
import type { DayData } from "./types";

const arrow =
  "flex size-10 shrink-0 items-center justify-center rounded-card border-[1.5px] border-line bg-white text-brand hover:border-brand disabled:cursor-not-allowed disabled:text-mute disabled:opacity-50";

/** Seven days at a time. Days without a free time are disabled; the chosen day is pressed. */
export default function DayStrip({
  day,
  disabled,
  onPick,
}: {
  day: DayData;
  disabled: boolean;
  onPick: (date: string, focus?: boolean) => void;
}) {
  const t = useTranslations("booking.time");
  return (
    <div role="group" aria-label={t("days")} className="mt-6 flex items-stretch gap-2">
      <button
        type="button"
        className={arrow}
        disabled={!day.prevFrom || disabled}
        onClick={() => day.prevFrom && onPick(day.prevFrom)}
        aria-label={t("prev")}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m14.5 6-6 6 6 6" />
        </svg>
      </button>
      <ul className="grid min-w-0 flex-1 grid-cols-7 gap-1.5 sm:gap-2">
        {day.strip.map((d) => {
          const on = d.date === day.date;
          return (
            <li key={d.date} className="min-w-0">
              <button
                type="button"
                data-testid="day"
                data-date={d.date}
                aria-pressed={on}
                disabled={!d.available || disabled}
                onClick={() => onPick(d.date, true)}
                className={`flex w-full flex-col items-center rounded-card border-[1.5px] px-0.5 py-2 text-xs transition-colors sm:py-2.5 ${
                  on
                    ? "border-brand bg-soft text-brand"
                    : d.available
                      ? "border-line bg-white text-mute hover:border-brand"
                      : "cursor-not-allowed border-dashed border-line bg-white text-mute/70"
                } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`}
              >
                <span className="sr-only">{d.available ? d.long : `${d.long}, ${t("unavailable")}`}</span>
                <span aria-hidden="true" className="truncate">{d.dow}</span>
                <span aria-hidden="true" className={`mt-0.5 text-lg font-bold sm:text-[19px] ${d.available ? "text-ink" : "text-mute/70 line-through"}`}>
                  {d.dom}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className={arrow}
        disabled={!day.nextFrom || disabled}
        onClick={() => day.nextFrom && onPick(day.nextFrom)}
        aria-label={t("next")}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m9.5 6 6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}
