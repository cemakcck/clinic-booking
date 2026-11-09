"use client";

import TimeGrid, { type GridProps } from "./TimeGrid";

/** Week view: seven day columns for one dentist. */
export default function WeekGrid(props: GridProps) {
  return (
    <TimeGrid
      {...props}
      renderHead={(c) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate">{c.title}</span>
          {c.sub && <span className={`text-[11px] font-medium ${c.isToday ? "text-brand" : "text-mute"}`}>{c.sub}</span>}
        </span>
      )}
    />
  );
}
