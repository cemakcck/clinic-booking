import { describe, expect, it } from "vitest";
import { addDays, atIstanbul, formatSlotTime, istanbulDateOf, istanbulTimeOf, weekdayOf } from "@/lib/time";

describe("istanbul time helpers", () => {
  it("atIstanbul builds the right instant regardless of process TZ", () => {
    expect(atIstanbul("2026-11-10", "14:00").toISOString()).toBe("2026-11-10T11:00:00.000Z");
  });
  it("reads Istanbul date and time of an instant", () => {
    const d = new Date("2026-11-10T22:30:00Z");
    expect(istanbulDateOf(d)).toBe("2026-11-11");
    expect(istanbulTimeOf(d)).toBe("01:30");
  });
  it("weekdayOf", () => expect(weekdayOf("2026-11-10")).toBe(2));
  it("addDays crosses year", () => expect(addDays("2026-12-31", 1)).toBe("2027-01-01"));
  it("formatSlotTime", () => expect(formatSlotTime(atIstanbul("2026-11-10", "09:05"), "en")).toBe("09:05"));
});
