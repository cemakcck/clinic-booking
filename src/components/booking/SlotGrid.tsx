"use client";

import { useTranslations } from "next-intl";
import type { SlotView } from "./types";

/** Free start times grouped Morning (before 12:00) and Afternoon. Labels come from the server. */
export default function SlotGrid({
  slots,
  dayLabel,
  selected,
  onPick,
}: {
  slots: SlotView[];
  dayLabel: string;
  selected: string | null;
  onPick: (start: string) => void;
}) {
  const t = useTranslations("booking.time");
  const groups = [
    { key: "morning", label: t("morning"), items: slots.filter((s) => s.label < "12:00") },
    { key: "afternoon", label: t("afternoon"), items: slots.filter((s) => s.label >= "12:00") },
  ].filter((g) => g.items.length > 0);

  return (
    <div data-testid="slot-list" role="group" aria-label={t("slotsFor", { day: dayLabel })} className="mt-2">
      {groups.map((g) => (
        <div key={g.key} className="mt-4">
          <h3 id={`slots-${g.key}`} className="text-[13px] font-semibold tracking-wide text-mute uppercase">
            {g.label}
          </h3>
          <ul aria-labelledby={`slots-${g.key}`} className="mt-2 flex flex-wrap gap-2">
            {g.items.map((s) => {
              const on = s.start === selected;
              return (
                <li key={s.start}>
                  <button
                    type="button"
                    data-testid="slot"
                    aria-pressed={on}
                    onClick={() => onPick(s.start)}
                    className={`min-w-[4.5rem] rounded-card border-[1.5px] px-3.5 py-2.5 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                      on ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-brand hover:bg-soft"
                    }`}
                  >
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
