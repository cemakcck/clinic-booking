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
  it("contact map text names the same street and district as the clinic address", () => {
    const [street, district] = clinic.mapText.split(",").map((s) => s.trim());
    const [addrStreet, addrDistrict] = clinic.address.split(",").map((s) => s.trim());
    expect(addrStreet.startsWith(street)).toBe(true);
    expect(addrDistrict).toBe(district);
  });
});
