import { describe, expect, it } from "vitest";
import { smsText } from "@/lib/reminders/sms";
import { clinic } from "@/config/clinic";
import { clinicData } from "@/content/clinic-data";
import { atIstanbul } from "@/lib/time";

const now = atIstanbul("2026-11-17", "09:00");
const tomorrow = atIstanbul("2026-11-18", "14:00");
const later = atIstanbul("2026-11-20", "09:30");
const dentist = "Dr. Elif Aydın";
const p = clinic.phoneDisplay;

describe("smsText", () => {
  it("EN tomorrow", () => {
    expect(smsText("en", { dentistName: dentist, start: tomorrow }, now)).toBe(
      `${clinic.shortName}: reminder, your appointment with ${dentist} is tomorrow at 14:00. To change it call ${p}.`,
    );
  });
  it("TR tomorrow", () => {
    expect(smsText("tr", { dentistName: dentist, start: tomorrow }, now)).toBe(
      `${clinic.shortName}: yarın saat 14:00, ${dentist} ile randevunuz var. Değişiklik için: ${p}`,
    );
  });
  it("non-tomorrow uses the short date", () => {
    expect(smsText("en", { dentistName: dentist, start: later }, now)).toContain("on 20 Nov at 09:30");
    expect(smsText("tr", { dentistName: dentist, start: later }, now)).toBe(
      `${clinic.shortName}: 20 Kasım saat 09:30, ${dentist} ile randevunuz var. Değişiklik için: ${p}`,
    );
  });
  it("tomorrow is an Istanbul calendar day (late evening UTC still tomorrow)", () => {
    const lateNow = atIstanbul("2026-11-17", "23:30");
    expect(smsText("en", { dentistName: dentist, start: tomorrow }, lateNow)).toContain("tomorrow");
    expect(smsText("en", { dentistName: dentist, start: tomorrow }, atIstanbul("2026-11-16", "23:30"))).toContain("on 18 Nov");
  });
  it("is at most 160 characters for the longest dentist name", () => {
    const longest = clinicData.dentists.map((x) => x.name).sort((a, b) => b.length - a.length)[0];
    for (const locale of ["en", "tr"] as const)
      for (const start of [tomorrow, atIstanbul("2026-11-28", "09:30")])
        expect(smsText(locale, { dentistName: longest, start }, now).length).toBeLessThanOrEqual(160);
  });
});
