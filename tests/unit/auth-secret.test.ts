import { afterEach, describe, expect, it, vi } from "vitest";
import { authSecret, EXAMPLE_AUTH_SECRET } from "@/lib/security/auth-secret";

afterEach(() => vi.unstubAllEnvs());

describe("authSecret()", () => {
  it("returns the configured secret", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "a-real-secret-0123456789abcdef0123456789");
    expect(authSecret()).toBe("a-real-secret-0123456789abcdef0123456789");
  });

  it("refuses a missing secret", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(() => authSecret()).toThrow(/BETTER_AUTH_SECRET is not set/);
  });

  it("allows the .env.example placeholder locally", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", EXAMPLE_AUTH_SECRET);
    vi.stubEnv("VERCEL_ENV", "");
    expect(authSecret()).toBe(EXAMPLE_AUTH_SECRET);
  });

  it("refuses the .env.example placeholder in a Vercel production deploy", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", EXAMPLE_AUTH_SECRET);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => authSecret()).toThrow(/placeholder/);
  });

  it("keeps the placeholder in sync with .env.example", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(".env.example", "utf8")).toContain(`BETTER_AUTH_SECRET=${EXAMPLE_AUTH_SECRET}\n`);
  });
});
