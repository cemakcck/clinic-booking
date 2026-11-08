import { describe, expect, it } from "vitest";
import { assertFloor } from "@/lib/demo/floor";
import { BookingError } from "@/lib/booking/errors";

const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof BookingError ? e.code : e;
  }
  return "no error";
};

describe("assertFloor", () => {
  it("passes when the day stays at or above the floor", () => {
    expect(code(() => assertFloor({ a: 10 }, { a: 4 }))).toBe("no error");
  });

  it("throws when the day drops below the floor", () => {
    expect(code(() => assertFloor({ a: 10 }, { a: 3 }))).toBe("capacity_floor");
  });

  it("passes when a day already below the floor doesn't get worse", () => {
    expect(code(() => assertFloor({ a: 2 }, { a: 2 }))).toBe("no error");
  });

  it("throws when a day already below the floor gets worse", () => {
    expect(code(() => assertFloor({ a: 2 }, { a: 1 }))).toBe("capacity_floor");
  });

  it("checks every date, and a custom minimum", () => {
    expect(code(() => assertFloor({ a: 10, b: 10 }, { a: 10, b: 3 }))).toBe("capacity_floor");
    expect(code(() => assertFloor({ a: 10 }, { a: 2 }, 2))).toBe("no error");
    expect(code(() => assertFloor({ a: 10 }, {}))).toBe("capacity_floor");
  });
});
