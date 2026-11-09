"use client";

import { useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PX_PER_HOUR, PX_PER_MIN, minToTime, minutesToY, timeToMin } from "@/lib/calendar/geometry";
import EntryBlock from "./EntryBlock";
import NowLine from "./NowLine";
import type { CalEntry, Column, GridItem, Override } from "./types";

export type GridProps = {
  columns: Column[];
  bounds: { open: string; close: string };
  items: GridItem[];
  entries: Map<string, CalEntry>;
  overrides: Record<string, Override>;
  outside: Set<string>;
  nowIso: string;
  /** Treatment of the appointment being dragged: columns whose dentist doesn't perform it refuse the drop. */
  dragging: { treatmentId?: number } | null;
  treatmentDentists: Map<number, number[]>;
  savingId: string | null;
  label: string;
  onOpen: (id: string) => void;
};

const HATCH =
  "[background-image:repeating-linear-gradient(135deg,rgba(93,116,114,0.10)_0_5px,transparent_5px_10px)] bg-[#f6f8f7]";

/** Shared body of the day and week grids: time rail plus one droppable column per `Column`. */
export default function TimeGrid({ renderHead, ...p }: GridProps & { renderHead: (c: Column, i: number) => ReactNode }) {
  const t = useTranslations("staff.calendar");
  const openMin = timeToMin(p.bounds.open);
  const closeMin = timeToMin(p.bounds.close);
  const height = minutesToY(closeMin - openMin, PX_PER_MIN);
  const hours: number[] = [];
  for (let m = openMin; m < closeMin; m += 60) hours.push(m);

  return (
    <div
      role="region"
      aria-label={p.label}
      tabIndex={0}
      className="overflow-x-auto rounded-card border border-line bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <div
        className="grid min-w-max"
        style={{ gridTemplateColumns: `56px repeat(${p.columns.length}, minmax(9.5rem, 1fr))` }}
      >
        <div className="sticky left-0 z-30 flex items-end border-b border-line bg-soft px-2 py-2.5 text-[11px] font-semibold text-mute">
          {t("time")}
        </div>
        {p.columns.map((c, i) => (
          <div
            key={c.key}
            data-testid="column-head"
            className={`flex min-w-0 items-center gap-2 border-b border-l border-line px-2.5 py-2 text-[13px] font-semibold text-ink ${
              c.isToday ? "bg-[#e2f1ed]" : "bg-soft"
            }`}
          >
            {renderHead(c, i)}
          </div>
        ))}

        <div className="sticky left-0 z-30 bg-white" style={{ height }} aria-hidden="true">
          {hours.map((m) => (
            <div
              key={m}
              className="absolute right-0 left-0 border-t border-line px-1.5 pt-0.5 text-[11px] text-mute tabular-nums"
              style={{ top: minutesToY(m - openMin, PX_PER_MIN), height: PX_PER_HOUR }}
            >
              {minToTime(m)}
            </div>
          ))}
        </div>
        {p.columns.map((c) => (
          <GridColumn key={c.key} column={c} openMin={openMin} closeMin={closeMin} height={height} {...p} />
        ))}
      </div>
    </div>
  );
}

function GridColumn({
  column: c,
  openMin,
  closeMin,
  height,
  ...p
}: GridProps & { column: Column; openMin: number; closeMin: number; height: number }) {
  const t = useTranslations("staff.calendar");
  const performs =
    !p.dragging ||
    p.dragging.treatmentId === undefined ||
    (p.treatmentDentists.get(p.dragging.treatmentId) ?? []).includes(c.dentistId);
  const canDrop = c.canManage && performs;
  const { setNodeRef, isOver } = useDroppable({ id: c.key, disabled: !canDrop, data: { column: c } });

  // Shaded time the dentist doesn't work: before/after their hours, lunch, or the whole day.
  const shade: { from: number; to: number; label?: string }[] = [];
  if (!c.hours.open) {
    shade.push({ from: openMin, to: closeMin, label: c.hours.closed ? t("closed") : t("notWorking") });
  } else {
    const s = timeToMin(c.hours.open.start);
    const e = timeToMin(c.hours.open.end);
    if (s > openMin) shade.push({ from: openMin, to: s });
    if (e < closeMin) shade.push({ from: e, to: closeMin });
    for (const b of c.hours.breaks) shade.push({ from: timeToMin(b.start), to: timeToMin(b.end), label: t("lunch") });
  }

  const mine = p.items.filter((it) => {
    const o = p.overrides[it.entryId];
    const e = p.entries.get(it.entryId);
    if (o && e && o.base === `${e.dentistId}|${e.start}`) return false;
    return it.dentistId === c.dentistId && it.date === c.date;
  });
  const moved = Object.entries(p.overrides).filter(([id, o]) => {
    const e = p.entries.get(id);
    return e && o.base === `${e.dentistId}|${e.start}` && o.dentistId === c.dentistId && o.date === c.date;
  });

  return (
    <div
      ref={setNodeRef}
      data-testid="column"
      data-dentist={c.dentistId}
      data-date={c.date}
      className={`relative border-l border-line ${p.dragging && !canDrop ? "opacity-55" : ""} ${
        isOver ? "bg-[#f3faf8] outline-2 -outline-offset-2 outline-accent" : ""
      }`}
      style={{
        height,
        backgroundImage: `repeating-linear-gradient(to bottom, var(--color-line) 0 1px, transparent 1px ${PX_PER_HOUR / 2}px, rgba(217,230,227,0.5) ${PX_PER_HOUR / 2}px ${PX_PER_HOUR / 2 + 1}px, transparent ${PX_PER_HOUR / 2 + 1}px ${PX_PER_HOUR}px)`,
      }}
    >
      {shade.map((s, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={`absolute right-0 left-0 ${HATCH}`}
          style={{ top: minutesToY(s.from - openMin, PX_PER_MIN), height: minutesToY(s.to - s.from, PX_PER_MIN) }}
        >
          {s.label && <span className="block px-2 pt-1 text-[11px] font-semibold text-mute">{s.label}</span>}
        </div>
      ))}
      {mine.map((it) => {
        const e = p.entries.get(it.entryId);
        if (!e || it.endMin <= openMin || it.startMin >= closeMin) return null;
        return (
          <EntryBlock
            key={`${it.entryId}|${it.date}`}
            entry={e}
            date={it.date}
            startMin={it.startMin}
            endMin={Math.min(it.endMin, closeMin)}
            timeLabel={it.timeLabel}
            openMin={openMin}
            draggable={isDraggable(e)}
            outside={p.outside.has(e.id)}
            moving={false}
            onOpen={p.onOpen}
          />
        );
      })}
      {moved.map(([id, o]) => {
        const e = p.entries.get(id)!;
        const dur = Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000);
        return (
          <EntryBlock
            key={`${id}|moved`}
            entry={e}
            date={o.date}
            startMin={o.startMin}
            endMin={o.startMin + dur}
            timeLabel={`${minToTime(o.startMin)}–${minToTime(o.startMin + dur)}`}
            openMin={openMin}
            draggable={false}
            outside={false}
            moving={p.savingId === id}
            onOpen={p.onOpen}
          />
        );
      })}
      {c.isToday && <NowLine nowIso={p.nowIso} openMin={openMin} closeMin={closeMin} />}
    </div>
  );
}

export function isDraggable(e: CalEntry): boolean {
  return e.kind === "appointment" && e.editable && e.status === "booked";
}
