import { describe, expect, it } from "vitest";
import { MINE_COOKIE, mineCookieOptions, parseMine, withMine } from "@/lib/demo/mine";

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("demo_mine cookie", () => {
  it("garbage gives []", () => {
    for (const raw of [undefined, "", "nope", "{", "{}", "null", "42", '"x"', '[1,2]', '[null]', "%E0%A4%A"]) {
      expect(parseMine(raw)).toEqual([]);
    }
  });

  it("keeps only uuid strings from a valid array, capped at 5", () => {
    const raw = JSON.stringify([U(1), "<script>", U(2), 7, U(3), U(4), U(5), U(6)]);
    expect(parseMine(raw)).toEqual([U(1), U(2), U(3), U(4), U(5)]);
    expect(parseMine(encodeURIComponent(JSON.stringify([U(1)])))).toEqual([U(1)]);
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
