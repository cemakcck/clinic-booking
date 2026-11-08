import { describe, expect, it } from "vitest";
import {
  PX_PER_MIN,
  dayBounds,
  minToTime,
  minutesToY,
  snapTopY,
  timeToMin,
  widenBounds,
  yToSnappedMinutes,
} from "@/lib/calendar/geometry";

const ppm = 52 / 60;

describe("calendar geometry", () => {
  it("uses 52px per hour", () => {
    expect(PX_PER_MIN).toBeCloseTo(ppm, 10);
  });

  it("minutesToY", () => {
    expect(minutesToY(60, ppm)).toBe(52);
    expect(minutesToY(0, ppm)).toBe(0);
    expect(minutesToY(30, ppm)).toBe(26);
  });

  it("yToSnappedMinutes floors to the 15-minute step", () => {
    expect(yToSnappedMinutes(52, ppm)).toBe(60);
    expect(yToSnappedMinutes(58, ppm)).toBe(60); // 66.9 min floors to 60
    expect(yToSnappedMinutes(65, ppm)).toBe(75); // 65px is exactly 75 min
    expect(yToSnappedMinutes(0, ppm)).toBe(0);
    expect(yToSnappedMinutes(12.9, ppm)).toBe(0);
    expect(yToSnappedMinutes(13, ppm)).toBe(15);
  });

  it("an exact grid line never floors one step down through float error", () => {
    for (let m = 0; m <= 9 * 60; m += 15) {
      expect(yToSnappedMinutes(minutesToY(m, ppm), ppm)).toBe(m);
      // A whole-pixel drag of exactly two hours from any grid line lands two hours later.
      expect(yToSnappedMinutes(minutesToY(m, ppm) + 104, ppm)).toBe(m + 120);
    }
  });

  it("honours a custom step", () => {
    expect(yToSnappedMinutes(65, ppm, 30)).toBe(60);
    expect(yToSnappedMinutes(65, ppm, 5)).toBe(75);
  });

  it("snapTopY puts a dragged top edge back on the grid", () => {
    expect(snapTopY(58, ppm)).toBe(52);
    expect(snapTopY(65, ppm)).toBe(65);
  });

  it("dayBounds is the union of the open days' hours", () => {
    expect(
      dayBounds([
        { open: "09:00", close: "18:00" },
        { open: "10:00", close: "14:00" },
        { open: null, close: null },
      ]),
    ).toEqual({ open: "09:00", close: "18:00" });
    expect(
      dayBounds([
        { open: "10:00", close: "14:00" },
        { open: "08:30", close: "12:00" },
      ]),
    ).toEqual({ open: "08:30", close: "14:00" });
    // No open day at all still gives a sensible grid.
    expect(dayBounds([{ open: null, close: null }])).toEqual({ open: "09:00", close: "18:00" });
  });

  it("time strings and minutes convert both ways", () => {
    expect(timeToMin("09:00")).toBe(540);
    expect(timeToMin("13:45")).toBe(825);
    expect(minToTime(540)).toBe("09:00");
    expect(minToTime(825)).toBe("13:45");
    expect(minToTime(1440)).toBe("24:00");
  });

  it("widenBounds stretches the grid to whole hours around outside appointments", () => {
    const b = { open: "09:00", close: "18:00" };
    expect(widenBounds(b, [])).toEqual(b);
    expect(widenBounds(b, [{ startMin: 600, endMin: 630 }])).toEqual(b);
    expect(widenBounds(b, [{ startMin: 8 * 60 + 15, endMin: 8 * 60 + 45 }])).toEqual({ open: "08:00", close: "18:00" });
    expect(widenBounds(b, [{ startMin: 18 * 60 + 30, endMin: 19 * 60 + 15 }])).toEqual({ open: "09:00", close: "20:00" });
    expect(widenBounds(b, [{ startMin: 0, endMin: 1440 }])).toEqual({ open: "00:00", close: "24:00" });
  });
});
