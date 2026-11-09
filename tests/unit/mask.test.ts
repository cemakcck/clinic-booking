import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone } from "@/lib/demo/mask";

describe("demo masking", () => {
  it("keeps only the last two digits of a Turkish mobile", () => {
    expect(maskPhone("+905321112233")).toBe("+90 5•• ••• •• 33");
  });
  it("masks other numbers too, keeping the last two digits", () => {
    const m = maskPhone("+4915112345678");
    expect(m.endsWith("78")).toBe(true);
    expect(m).not.toMatch(/1234/);
  });
  it("keeps the email's first letter and domain", () => {
    expect(maskEmail("ayla@example.com")).toBe("a•••@example.com");
    expect(maskEmail("x")).toBe("•••");
  });
});
