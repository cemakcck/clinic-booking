import { describe, expect, it } from "vitest";
import { buildIcs } from "@/lib/email/ics";

const base = {
  uid: "abc@lindenya.example",
  start: new Date("2026-11-10T11:00:00Z"),
  end: new Date("2026-11-10T12:00:00Z"),
  summary: "Check-up, cleaning",
  location: "Moda Cd. 12; Kadıköy",
  description: "Line one\nLine two",
  now: new Date("2026-11-08T09:00:00Z"),
};

describe("buildIcs", () => {
  it("emits UTC times, CRLF and escaped text", () => {
    const ics = buildIcs(base);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261110T110000Z");
    expect(ics).toContain("DTEND:20261110T120000Z");
    expect(ics).toContain("DTSTAMP:20261108T090000Z");
    expect(ics).toContain("SUMMARY:Check-up\\, cleaning");
    expect(ics).toContain("LOCATION:Moda Cd. 12\\; Kadıköy");
    expect(ics).toContain("Line one\\nLine two");
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("UID:abc@lindenya.example");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("folds long lines to at most 75 octets without splitting characters", () => {
    const ics = buildIcs({ ...base, description: "ğüşiöç ".repeat(60) });
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("ğüşiöç ".repeat(60).trimEnd().replace(/\n/g, "\\n"));
    expect(unfolded).not.toContain("�");
  });
});
