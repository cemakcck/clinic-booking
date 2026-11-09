import { beforeAll, describe, expect, it } from "vitest";
import { encodeMine, MINE_COOKIE, mineCookieOptions, parseMine, withMine } from "@/lib/demo/mine";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= "unit-mine-secret-0123456789abcdef0123";
});

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("demo_mine cookie", () => {
  it("garbage gives []", () => {
    for (const raw of [undefined, "", "nope", "{", "{}", "null", "42", '"x"', '[1,2]', '[null]', "%E0%A4%A"]) {
      expect(parseMine(raw)).toEqual([]);
    }
  });

  it("round-trips a signed list, capped at 5", () => {
    expect(parseMine(encodeMine([U(1), U(2)]))).toEqual([U(1), U(2)]);
    expect(parseMine(encodeURIComponent(encodeMine([U(1)])))).toEqual([U(1)]);
    expect(parseMine(encodeMine([U(1), U(2), U(3), U(4), U(5), U(6)]))).toEqual([U(1), U(2), U(3), U(4), U(5)]);
  });

  it("rejects forged cookies: unsigned JSON, a tampered list, a wrong signature", () => {
    // Entry ids are visible to staff; a visitor must not be able to claim someone else's booking.
    expect(parseMine(JSON.stringify([U(1)]))).toEqual([]);
    const good = encodeMine([U(1)]);
    const [, sig] = good.split(".");
    expect(parseMine(`${U(2)}.${sig}`)).toEqual([]);
    expect(parseMine(`${U(1)},${U(2)}.${sig}`)).toEqual([]);
    expect(parseMine(`${U(1)}.${"A".repeat(sig.length)}`)).toEqual([]);
    expect(parseMine(`${U(1)}.`)).toEqual([]);
  });

  it("drops non-uuid values even under a valid signature", () => {
    expect(parseMine(encodeMine([U(1), "<script>", U(2)]))).toEqual([U(1), U(2)]);
  });

  it("withMine puts the newest first, dedupes and caps at 5", () => {
    expect(withMine([], U(1))).toEqual([U(1)]);
    expect(withMine([U(1), U(2)], U(2))).toEqual([U(2), U(1)]);
    expect(withMine([U(1), U(2), U(3), U(4), U(5)], U(6))).toEqual([U(6), U(1), U(2), U(3), U(4)]);
  });

  it("cookie options: httpOnly, path /, 7 days, lax", () => {
    expect(MINE_COOKIE).toBe("demo_mine");
    expect(mineCookieOptions).toMatchObject({ httpOnly: true, path: "/", maxAge: 7 * 24 * 3600, sameSite: "lax" });
  });
});
