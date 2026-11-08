"use client";

import { useTranslations } from "next-intl";

/** Colour key under the grid; every colour is also spelled out on the entries themselves. */
export default function Legend() {
  const t = useTranslations("staff.calendar.legend");
  const items: [string, string][] = [
    ["bg-booked", t("booked")],
    ["bg-arrived", t("arrived")],
    ["bg-noshow", t("noShow")],
    ["bg-[#7d8f8c]", t("completed")],
    ["bg-mine", t("mine")],
    ["[background-image:repeating-linear-gradient(45deg,#c9c9c4_0_3px,#9a9a95_3px_6px)]", t("blocked")],
  ];
  return (
    <ul data-testid="legend" aria-label={t("label")} className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-mute">
      {items.map(([cls, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <i aria-hidden="true" className={`inline-block size-2.5 rounded-[3px] ${cls}`} />
          {label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="font-bold text-[#8a1c14]">⚠</span>
        {t("outside")}
      </li>
    </ul>
  );
}
