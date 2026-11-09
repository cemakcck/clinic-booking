"use client";

import { useEffect, useState } from "react";
import { PX_PER_MIN, minutesToY, timeToMin } from "@/lib/calendar/geometry";
import { istanbulTimeOf } from "@/lib/time";

/**
 * The red current-time line, in clinic (Istanbul) time whatever the browser's zone. Starts from
 * the server's clock so the first render matches, then follows the wall clock every 30 seconds.
 */
export default function NowLine({ nowIso, openMin, closeMin }: { nowIso: string; openMin: number; closeMin: number }) {
  const [min, setMin] = useState(() => timeToMin(istanbulTimeOf(new Date(nowIso))));
  useEffect(() => {
    const id = setInterval(() => setMin(timeToMin(istanbulTimeOf(new Date()))), 30_000);
    return () => clearInterval(id);
  }, []);
  if (min < openMin || min > closeMin) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="now-line"
      className="pointer-events-none absolute right-0 left-0 z-20 h-0.5 bg-noshow"
      style={{ top: minutesToY(min - openMin, PX_PER_MIN) }}
    >
      <span className="absolute -top-[4px] -left-[5px] size-2.5 rounded-full bg-noshow" />
    </div>
  );
}
