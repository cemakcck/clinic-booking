"use client";

import { useTranslations } from "next-intl";
import DayStrip from "./DayStrip";
import SlotGrid from "./SlotGrid";
import type { DayData } from "./types";

export default function StepTime({
  day,
  selected,
  loading,
  notice,
  onPickDay,
  onPickSlot,
}: {
  day: DayData;
  selected: string | null;
  loading: boolean;
  notice: string | null;
  onPickDay: (date: string, focus?: boolean) => void;
  onPickSlot: (start: string) => void;
}) {
  const t = useTranslations("booking.time");
  const current = day.strip.find((d) => d.date === day.date);
  const anyDay = day.strip.some((d) => d.available);

  return (
    <>
      <p className="mt-1 text-[15px] text-mute">{t("sub")}</p>
      {notice && (
        <p role="alert" className="mt-4 rounded-card bg-[#fdf3dc] p-3 text-sm font-semibold text-ink ring-1 ring-mine">
          {notice}
        </p>
      )}
      <DayStrip day={day} disabled={loading} onPick={onPickDay} />
      <p role="status" className="sr-only">
        {loading ? t("loading") : ""}
      </p>
      <div aria-busy={loading} className={loading ? "opacity-60 transition-opacity" : ""}>
        {day.slots.length > 0 ? (
          <SlotGrid slots={day.slots} dayLabel={current?.long ?? day.date} selected={selected} disabled={loading} onPick={onPickSlot} />
        ) : (
          <p className="mt-6 rounded-card bg-soft p-4 text-sm text-ink">{anyDay ? t("noSlots") : t("noDays")}</p>
        )}
      </div>
    </>
  );
}
