import { describe, expect, it } from "vitest";
import { clinic } from "@/config/clinic";

describe("clinic contact details are obviously fictional", () => {
  it("uses an all-zero placeholder phone number", () => {
    expect(clinic.phoneE164).toBe("+902160000000");
    expect(clinic.phoneDisplay).toBe("+90 216 000 00 00");
  });
  it("uses an invented street, marked fictional", () => {
    expect(clinic.address).toBe("Lindenya Sokağı No: 1, Kadıköy, İstanbul (fictional)");
    expect(clinic.email.endsWith(".example")).toBe(true);
  });
});
