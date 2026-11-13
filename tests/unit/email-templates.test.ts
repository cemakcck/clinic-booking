import { describe, expect, it } from "vitest";
import { renderEmail, type EmailKind } from "@/lib/email/templates";
import { atIstanbul, formatLongDate } from "@/lib/time";
import { clinic } from "@/config/clinic";

const d = {
  patientName: "Ayşe Yılmaz",
  treatmentName: "Check-up",
  dentistName: "Dr. Elif Kaya",
  start: atIstanbul("2026-11-10", "14:00"),
  manageUrl: "https://example.test/en/manage/tok",
};
const kinds: EmailKind[] = ["booking_confirmation", "booking_rescheduled", "booking_cancelled"];

describe("renderEmail", () => {
  it("en confirmation names treatment, dentist and Istanbul time", () => {
    const m = renderEmail("booking_confirmation", "en", d);
    expect(m.text).toContain("14:00");
    expect(m.text).toContain("Check-up");
    expect(m.text).toContain("Dr. Elif Kaya");
    expect(m.html).toContain("14:00");
  });

  it("tr confirmation is Turkish", () => {
    expect(renderEmail("booking_confirmation", "tr", d).subject).toContain("Randevu");
  });

  it("subject strips CR/LF", () => {
    for (const kind of kinds) {
      const m = renderEmail(kind, "en", { ...d, patientName: "Ali\r\nBcc: x@y.z" });
      expect(m.subject).not.toMatch(/[\r\n]/);
    }
  });

  it("html escapes names", () => {
    const m = renderEmail("booking_confirmation", "tr", { ...d, patientName: "<b>Ayşe</b>" });
    expect(m.html).toContain("&lt;b&gt;Ayşe&lt;/b&gt;");
    expect(m.html).not.toContain("<b>Ayşe</b>");
  });

  it("never mentions a price", () => {
    for (const locale of ["en", "tr"] as const)
      for (const kind of kinds) {
        const m = renderEmail(kind, locale, d);
        expect(`${m.subject}${m.html}${m.text}`).not.toMatch(/₺|TL|price|fiyat/i);
      }
  });

  describe("appointment_reminder", () => {
    const now = atIstanbul("2026-11-09", "10:00");
    const r = { ...d, now };

    it("subject says tomorrow when start is the next Istanbul day", () => {
      expect(renderEmail("appointment_reminder", "en", r).subject).toBe("Reminder: your appointment tomorrow at 14:00");
      expect(renderEmail("appointment_reminder", "tr", r).subject).toBe("Hatırlatma: yarın 14:00 randevunuz");
    });

    it("spells the date when not tomorrow", () => {
      const far = { ...r, now: atIstanbul("2026-11-05", "10:00") };
      expect(renderEmail("appointment_reminder", "en", far).subject).toBe(
        `Reminder: your appointment on ${formatLongDate(d.start, "en")} at 14:00`,
      );
    });

    it("body has dentist, treatment, address, phone and no booking link", () => {
      for (const locale of ["en", "tr"] as const) {
        const m = renderEmail("appointment_reminder", locale, r);
        for (const part of [m.text, m.html]) {
          expect(part).toContain("Dr. Elif Kaya");
          expect(part).toContain("Check-up");
          expect(part).toContain(clinic.address);
          expect(part).toContain(clinic.phoneDisplay);
          expect(part).not.toContain("/booking/");
          expect(part).not.toContain("/manage/");
        }
        expect(m.subject).not.toMatch(/[\r\n]/);
      }
    });
  });
});
