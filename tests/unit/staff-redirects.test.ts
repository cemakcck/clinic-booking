import { describe, expect, it } from "vitest";
import { roleHome, safeStaffNext } from "@/lib/auth/redirects";

describe("roleHome", () => {
  it("receptionist and admin go to the calendar, dentist to today", () => {
    expect(roleHome("receptionist", "en")).toBe("/en/staff/calendar");
    expect(roleHome("admin", "tr")).toBe("/tr/staff/calendar");
    expect(roleHome("dentist", "en")).toBe("/en/staff/today");
  });
});

describe("safeStaffNext", () => {
  it("accepts same-site staff paths in the current locale", () => {
    expect(safeStaffNext("/en/staff/calendar?date=2026-11-10", "en")).toBe("/en/staff/calendar?date=2026-11-10");
    expect(safeStaffNext("/en/staff", "en")).toBe("/en/staff");
    expect(safeStaffNext("/tr/staff/today", "tr")).toBe("/tr/staff/today");
  });

  it("rejects anything that could leave the staff area or the site", () => {
    for (const bad of [
      undefined,
      "",
      "https://evil.example/en/staff",
      "//evil.example/en/staff",
      "/\\evil.example/en/staff",
      "/en/staffing",
      "/en/staff/../../evil",
      "/en/staff/%2e%2e/x",
      "/en/book",
      "/tr/staff/calendar",
      "/en/staff\nLocation: x",
      "javascript:alert(1)",
      "/en/staff/calendar#x\\",
    ]) {
      expect(safeStaffNext(bad, "en"), String(bad)).toBeNull();
    }
  });
});
