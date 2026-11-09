"use client";

import { useTranslations } from "next-intl";
import type { Counters as C } from "./types";

/** The summary chips above the grid; "Needs attention" only when something is outside hours. */
export default function Counters({ counters, attention, view }: { counters: C; attention: number; view: "day" | "week" }) {
  const t = useTranslations("staff.calendar.counters");
  const chip = "rounded-card border border-line bg-white px-3 py-2 text-[12px] text-mute";
  const num = "mr-1 text-[16px] font-bold text-ink tabular-nums";
  return (
    <ul data-testid="counters" aria-label={view === "day" ? t("dayLabel") : t("weekLabel")} className="mb-3.5 flex flex-wrap gap-2.5">
      <li className={chip}>
        <b className={num}>{counters.appointments}</b>
        {t("appointments", { count: counters.appointments })}
      </li>
      <li className={chip}>
        <b className={num}>{counters.arrived}</b>
        {t("arrived")}
      </li>
      <li className={chip}>
        <b className={num}>{counters.noShows}</b>
        {t("noShows", { count: counters.noShows })}
      </li>
      <li className={chip}>
        <b className={num}>{counters.freeSlotsToday}</b>
        {t("free", { count: counters.freeSlotsToday })}
      </li>
      {attention > 0 && (
        <li data-testid="attention" title={t("attentionHint")} className="rounded-card border border-mine bg-[#fff4d6] px-3 py-2 text-[12px] font-semibold text-[#5c4100]">
          <span aria-hidden="true">⚠ </span>
          {t("attention", { count: attention })}
          <span className="sr-only">. {t("attentionHint")}</span>
        </li>
      )}
    </ul>
  );
}
