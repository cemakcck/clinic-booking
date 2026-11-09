"use client";

import { initials } from "@/components/site/Avatar";
import TimeGrid, { type GridProps } from "./TimeGrid";

const TONES = ["bg-accent text-ink", "bg-brand text-white", "bg-[#cfeee7] text-brand", "bg-ink text-accent"];

/** Day view: one column per dentist (mockup screen 3). */
export default function DayGrid(props: GridProps) {
  return (
    <TimeGrid
      {...props}
      renderHead={(c, i) => (
        <>
          <span
            aria-hidden="true"
            className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${TONES[i % TONES.length]}`}
          >
            {initials(c.title)}
          </span>
          <span className="truncate">{c.title}</span>
        </>
      )}
    />
  );
}
