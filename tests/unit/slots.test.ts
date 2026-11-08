import { describe, expect, it } from "vitest";
import { atIstanbul, istanbulTimeOf, addDays } from "@/lib/time";
import { computeSlots, effectiveHours, pickAnyDentist } from "@/lib/slots/engine";
import { PUBLIC_HORIZON_DAYS, PUBLIC_MIN_LEAD_MIN } from "@/config/booking";

const H = effectiveHours({ start: "09:00", end: "18:00" }, { start: "09:00", end: "18:00" }, { start: "12:30", end: "13:30" });
const now = atIstanbul("2026-11-09", "08:00");
const base = { date: "2026-11-10", durationMin: 30, hours: H, closed: false, busy: [], now, minLeadMin: PUBLIC_MIN_LEAD_MIN, horizonDays: PUBLIC_HORIZON_DAYS };
const times = (q: Parameters<typeof computeSlots>[0]) => computeSlots(q).map(istanbulTimeOf);

describe("computeSlots", () => {
  it("steps every 15 minutes from opening", () => {
    expect(times(base).slice(0, 3)).toEqual(["09:00", "09:15", "09:30"]);
  });
  it("whole treatment must fit before lunch", () => {
    const t = times({ ...base, durationMin: 60 });
    expect(t).toContain("11:30");
    expect(t).not.toContain("11:45");
    expect(t).toContain("13:30");
  });
  it("whole treatment must fit before closing", () => {
    expect(times({ ...base, durationMin: 90 }).at(-1)).toBe("16:30");
  });
  it("busy intervals remove overlapping starts but touching is fine", () => {
    const t = times({ ...base, busy: [{ start: atIstanbul("2026-11-10", "10:00"), end: atIstanbul("2026-11-10", "10:30") }] });
    expect(t).toContain("09:30");
    expect(t).toContain("10:30");
    for (const x of ["09:45", "10:00", "10:15"]) expect(t).not.toContain(x);
  });
  it("closed day returns nothing", () => {
    expect(computeSlots({ ...base, closed: true })).toEqual([]);
    expect(computeSlots({ ...base, hours: null })).toEqual([]);
  });
  it("respects minimum lead", () => {
    expect(times({ ...base, now: atIstanbul("2026-11-10", "09:10") })[0]).toBe("11:15");
  });
  it("respects horizon", () => {
    expect(computeSlots({ ...base, date: addDays("2026-11-09", 61) })).toEqual([]);
    expect(computeSlots({ ...base, date: addDays("2026-11-09", 60) }).length).toBeGreaterThan(0);
  });
  it("staff lead allows the past hour", () => {
    const t = times({ ...base, minLeadMin: -60, now: atIstanbul("2026-11-10", "10:20") });
    expect(t).toContain("09:30");
    expect(t).not.toContain("09:15");
  });
});

describe("effectiveHours", () => {
  it("intersects clinic and dentist", () => {
    expect(effectiveHours({ start: "09:00", end: "18:00" }, { start: "10:00", end: "14:00" }, { start: "12:30", end: "13:30" })).toEqual({
      open: { start: "10:00", end: "14:00" },
      breaks: [{ start: "12:30", end: "13:30" }],
    });
    expect(effectiveHours({ start: "09:00", end: "18:00" }, null, null)).toBeNull();
    expect(effectiveHours({ start: "09:00", end: "18:00" }, { start: "08:00", end: "09:00" }, null)).toBeNull();
  });
});

describe("pickAnyDentist", () => {
  it("prefers fewest bookings, then sort order", () => {
    expect(pickAnyDentist([{ dentistId: 1, sortOrder: 1, dayCount: 3 }, { dentistId: 2, sortOrder: 2, dayCount: 1 }])).toBe(2);
    expect(pickAnyDentist([{ dentistId: 1, sortOrder: 1, dayCount: 2 }, { dentistId: 2, sortOrder: 2, dayCount: 2 }])).toBe(1);
    expect(pickAnyDentist([])).toBeNull();
  });
});
