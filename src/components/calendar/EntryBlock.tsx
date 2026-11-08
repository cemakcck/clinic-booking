"use client";

import { useDraggable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { PX_PER_MIN, minToTime, minutesToY } from "@/lib/calendar/geometry";
import type { CalEntry } from "./types";
import { BLOCK_STYLE, MINE_STYLE, STATUS_STYLE } from "./ui";

export type EntryDragData = { entryId: string; name: string; treatmentId?: number; startMin: number; height: number };

/**
 * One appointment or block on the grid. Always a real button (Enter/Space open its dialog);
 * editable booked appointments are also pointer-draggable.
 */
export default function EntryBlock({
  entry,
  date,
  startMin,
  endMin,
  timeLabel,
  openMin,
  draggable,
  outside,
  moving,
  onOpen,
}: {
  entry: CalEntry;
  date: string;
  startMin: number;
  endMin: number;
  timeLabel: string;
  openMin: number;
  draggable: boolean;
  outside: boolean;
  /** The drop is being saved: keep it where it was dropped, a little faded. */
  moving: boolean;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("staff.calendar");
  const top = minutesToY(Math.max(startMin, openMin) - openMin, PX_PER_MIN);
  const height = Math.max(minutesToY(endMin - Math.max(startMin, openMin), PX_PER_MIN), 14);
  const name =
    entry.kind === "block" ? t(`reasons.${entry.blockReason ?? "other"}`) : (entry.patientName ?? "");
  const data: EntryDragData = { entryId: entry.id, name, treatmentId: entry.treatmentId, startMin, height };
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({
    id: entry.id,
    disabled: !draggable,
    data,
  });

  const style =
    entry.kind === "block"
      ? BLOCK_STYLE
      : entry.mine
        ? MINE_STYLE
        : (STATUS_STYLE[entry.status ?? "booked"] ?? STATUS_STYLE.booked);
  const short = endMin - startMin <= 30;
  const dragTo = isDragging && transform ? minToTime(startMin + Math.round(transform.y / PX_PER_MIN)) : null;

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid="entry"
      data-entry-id={entry.id}
      data-kind={entry.kind}
      data-status={entry.status}
      data-start={minToTime(startMin)}
      data-date={date}
      data-dentist={entry.dentistId}
      data-mine={entry.mine ? "true" : undefined}
      data-draggable={draggable ? "true" : undefined}
      aria-describedby={draggable ? "cal-drag-help" : undefined}
      onClick={() => onOpen(entry.id)}
      {...(draggable ? listeners : {})}
      style={{
        top: top + 1,
        height: height - 2,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      title={entry.kind === "block" ? `${name} · ${timeLabel}` : `${name} · ${entry.treatmentName} · ${timeLabel}`}
      className={`group absolute right-1 left-1 flex flex-col items-stretch justify-start overflow-hidden rounded-[8px] border-l-4 px-2 text-left text-[12px] leading-[1.2] text-ink shadow-[0_1px_0_rgba(16,48,46,0.06)] transition-shadow focus-visible:z-30 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${style} ${
        short ? "py-[3px]" : endMin - startMin <= 45 ? "py-1" : "py-1.5"
      } ${draggable ? "cursor-grab touch-none hover:shadow-md active:cursor-grabbing" : "cursor-pointer hover:shadow-md"} ${
        isDragging ? "z-40 cursor-grabbing border-dashed opacity-80 shadow-lg" : ""
      } ${moving ? "opacity-60" : ""}`}
    >
      {dragTo && (
        <span className="absolute top-0.5 right-1 rounded-full bg-ink px-1.5 py-0.5 text-[11px] font-bold text-white">
          {t("drag.moving", { time: dragTo })}
        </span>
      )}
      {entry.mine && (
        <span className={short ? "sr-only" : "block text-[11px] font-bold text-[#6b4d00]"}>{t("mine")}</span>
      )}
      <span className={`flex items-baseline gap-1.5 ${short ? "truncate" : ""}`}>
        {outside && (
          <span title={t("outside")} className="font-bold text-[#8a1c14]">
            <span aria-hidden="true">⚠</span>
            <span className="sr-only">{t("outside")}</span>
          </span>
        )}
        {entry.mine && short && (
          <span aria-hidden="true" className="font-bold text-[#6b4d00]">
            ★
          </span>
        )}
        <b className="truncate font-bold">{name}</b>
        {short && <span className="shrink-0 text-[11px] text-[#3f5553]">{timeLabel.slice(0, 5)}</span>}
      </span>
      <span className={short ? "sr-only" : "block truncate text-[11px] text-[#3f5553]"}>
        {entry.kind === "block" ? (
          timeLabel
        ) : (
          <>
            {entry.treatmentName} · {short ? "" : `${timeLabel} · `}
            <span className="font-semibold">{t(`status.${entry.status ?? "booked"}`)}</span>
          </>
        )}
      </span>
    </button>
  );
}
