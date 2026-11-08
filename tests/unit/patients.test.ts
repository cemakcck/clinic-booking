import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/booking/patients";

describe("normalizePhone", () => {
  it.each(["+90 532 111 22 33", "0532 111 2233", "5321112233", "(0532) 111-22-33"])(
    "normalizes Turkish number %s",
    (raw) => expect(normalizePhone(raw)).toBe("+905321112233"),
  );
  it("keeps other international numbers", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it.each(["abc", "123", ""])("rejects %j", (raw) => expect(normalizePhone(raw)).toBeNull());
});
