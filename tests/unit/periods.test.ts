import { describe, expect, it } from "vitest";
import { periodBounds } from "@/lib/dashboard/periods";
import { atIstanbul } from "@/lib/time";

const DAY = 86_400_000;
const iso = (w: { start: Date; end: Date }) => [w.start.toISOString(), w.end.toISOString()];
const I = (date: string, time: string) => atIstanbul(date, time).toISOString();

describe("periodBounds", () => {
  const wed = atIstanbul("2026-11-18", "10:30");

  it("week: Monday 00:00 Istanbul to now, same elapsed part of last week, whole week for utilisation", () => {
    const b = periodBounds("week", wed);
    expect(iso(b.current)).toEqual([I("2026-11-16", "00:00"), I("2026-11-18", "10:30")]);
    expect(iso(b.previous)).toEqual([I("2026-11-09", "00:00"), I("2026-11-11", "10:30")]);
    expect(iso(b.utilisation)).toEqual([I("2026-11-16", "00:00"), I("2026-11-23", "00:00")]);
  });

  it("week on a Monday 08:00: the windows are 8 hours long", () => {
    const mon = atIstanbul("2026-11-16", "08:00");
    const b = periodBounds("week", mon);
    expect(b.current.end.getTime() - b.current.start.getTime()).toBe(8 * 3_600_000);
    expect(b.previous.end.getTime() - b.previous.start.getTime()).toBe(8 * 3_600_000);
    expect(iso(b.current)).toEqual([I("2026-11-16", "00:00"), I("2026-11-16", "08:00")]);
    expect(iso(b.previous)).toEqual([I("2026-11-09", "00:00"), I("2026-11-09", "08:00")]);
  });

  it("week on a Sunday late evening still starts on the Monday before (Istanbul calendar)", () => {
    // 23:30 Istanbul Sunday is 15:30 in New York, also Sunday; 01:00 Istanbul Monday is Sunday in New York.
    const monEarly = atIstanbul("2026-11-23", "01:00");
    expect(periodBounds("week", monEarly).current.start.toISOString()).toBe(I("2026-11-23", "00:00"));
    const sun = atIstanbul("2026-11-22", "23:30");
    expect(periodBounds("week", sun).current.start.toISOString()).toBe(I("2026-11-16", "00:00"));
  });

  it.each([
    ["4w", 28],
    ["3m", 91],
  ] as const)("%s: exact %i-day spans, previous is the equal window before, utilisation = current", (p, days) => {
    const b = periodBounds(p, wed);
    expect(b.current.end.getTime()).toBe(wed.getTime());
    expect(b.current.start.getTime()).toBe(wed.getTime() - days * DAY);
    expect(b.previous.end.getTime()).toBe(b.current.start.getTime());
    expect(b.previous.start.getTime()).toBe(wed.getTime() - 2 * days * DAY);
    expect(iso(b.utilisation)).toEqual(iso(b.current));
  });

  it("runs under TZ=America/New_York (results above are process-TZ independent)", () => {
    expect(process.env.TZ).toBe("America/New_York");
    expect(new Date("2026-11-18T12:00:00Z").getTimezoneOffset()).toBe(300);
  });
});
