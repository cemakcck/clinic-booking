/** Pure calendar geometry, shared by the server (layout) and the client (drag). No time zones here. */

export const PX_PER_HOUR = 52;
export const PX_PER_MIN = PX_PER_HOUR / 60;
export const GRID_STEP_MIN = 15;

/** Pixels from the grid's top edge for `minFromOpen` minutes after opening. */
export function minutesToY(minFromOpen: number, pxPerMin: number): number {
  return minFromOpen * pxPerMin;
}

/**
 * Minutes after opening for a y offset, floored to the grid step. The tiny epsilon keeps an
 * exact grid line (which float division can land a hair below) on its own step.
 */
export function yToSnappedMinutes(y: number, pxPerMin: number, step = GRID_STEP_MIN): number {
  return Math.floor(y / pxPerMin / step + 1e-9) * step;
}

/** The y of the grid line a dragged top edge at `y` snaps to. */
export function snapTopY(y: number, pxPerMin: number, step = GRID_STEP_MIN): number {
  return minutesToY(yToSnappedMinutes(y, pxPerMin, step), pxPerMin);
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** The grid's hours: the union of every open day's clinic hours (09:00–18:00 for Lindenya). */
export function dayBounds(clinicHours: { open: string | null; close: string | null }[]): { open: string; close: string } {
  const open = clinicHours.filter((h): h is { open: string; close: string } => Boolean(h.open && h.close));
  if (open.length === 0) return { open: "09:00", close: "18:00" };
  const start = Math.min(...open.map((h) => timeToMin(h.open)));
  const end = Math.max(...open.map((h) => timeToMin(h.close)));
  return { open: minToTime(start), close: minToTime(end) };
}
