import { describe, expect, it } from "vitest";
import { deriveManageToken, hashToken, newToken } from "@/lib/security/tokens";

describe("tokens", () => {
  it("newToken is long and unique", () => {
    const a = newToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(newToken()).not.toBe(a);
  });
  it("hashToken is a stable sha256 hex", () => {
    expect(hashToken("a")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("a")).toBe(hashToken("a"));
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
  it("deriveManageToken is deterministic and distinct", () => {
    const t = newToken();
    expect(deriveManageToken(t)).toBe(deriveManageToken(t));
    expect(deriveManageToken(t)).not.toBe(t);
    expect(deriveManageToken(t).length).toBeGreaterThanOrEqual(43);
    expect(deriveManageToken("a")).not.toBe(deriveManageToken("b"));
  });
});
