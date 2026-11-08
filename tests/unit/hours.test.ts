import { describe, expect, it } from "vitest";
import { summarizeHours, weekdayName } from "@/lib/public/hours";

const days = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, open: "09:00", close: "18:00" })),
  { weekday: 6, open: "10:00", close: "14:00" },
  { weekday: 0, open: null, close: null },
];

describe("opening hours", () => {
  it("names weekdays independent of process TZ", () => {
    expect(weekdayName(1, "en")).toBe("Monday");
    expect(weekdayName(0, "tr")).toBe("Pazar");
  });

  it("groups consecutive days with equal hours", () => {
    expect(summarizeHours(days, "en")).toEqual([
      { label: "Mon–Fri", hours: "09:00–18:00" },
      { label: "Sat", hours: "10:00–14:00" },
      { label: "Sun", hours: null },
    ]);
  });
});
