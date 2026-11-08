import { describe, expect, it } from "vitest";
import { renderEmail, type EmailKind } from "@/lib/email/templates";
import { atIstanbul } from "@/lib/time";

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
});
