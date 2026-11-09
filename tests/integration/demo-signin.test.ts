import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetDemo } from "@/lib/demo/reset";
import { entries } from "@/lib/db/schema";
import { istanbulDateOf } from "@/lib/time";
import { encodeMine } from "@/lib/demo/mine";
import { closeTestDb, testDb, TEST_DATABASE_URL } from "./helpers/db";

process.env.BETTER_AUTH_SECRET ??= "integration-mine-secret-0123456789abcdef";

// The server action's own logic: the demo gate, which account it signs into and where it
// redirects. Better Auth itself is mocked here (real sign-ins: auth.test.ts and the e2e suite).
const h = vi.hoisted(() => ({
  signInEmail: vi.fn<(arg: unknown) => Promise<{ user: object }>>(async () => ({ user: {} })),
  cookie: undefined as string | undefined,
  ip: "198.51.100.1",
}));

vi.mock("@/lib/auth/auth", () => ({ getAuth: () => ({ api: { signInEmail: h.signInEmail } }) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": h.ip }),
  cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  forbidden: () => {
    throw new Error("FORBIDDEN");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

process.env.DATABASE_URL = TEST_DATABASE_URL;
const NOW = new Date("2026-11-10T08:00:00+03:00");
const db = testDb();
const { demoSignIn, signIn } = await import("@/app/[locale]/staff/login/actions");
const { APIError } = await import("better-auth/api");

let mineId: string;
let mineDate: string;

beforeAll(async () => {
  await resetDemo(db, NOW);
  const [a] = await db.select({ id: entries.id, during: entries.during }).from(entries).where(eq(entries.kind, "appointment")).limit(1);
  mineId = a.id;
  mineDate = istanbulDateOf(a.during.start);
});
beforeEach(() => {
  h.signInEmail.mockClear();
  h.cookie = undefined;
  process.env.DEMO_MODE = "1";
});
afterAll(async () => {
  delete process.env.DEMO_MODE;
  await closeTestDb();
  const { sharedDb } = await import("@/lib/db/client");
  await sharedDb().$client.end();
});

describe("demoSignIn", () => {
  it("is forbidden outside demo mode and never signs in", async () => {
    process.env.DEMO_MODE = "";
    await expect(demoSignIn("admin")).rejects.toThrow("FORBIDDEN");
    expect(h.signInEmail).not.toHaveBeenCalled();
  });

  it("refuses a role that isn't a demo staff role", async () => {
    await expect(demoSignIn("owner" as never)).rejects.toThrow("FORBIDDEN");
    expect(h.signInEmail).not.toHaveBeenCalled();
  });

  it("signs in as the seeded account with DEMO_PASSWORD and goes to the role's home", async () => {
    await expect(demoSignIn("dentist")).rejects.toThrow("REDIRECT /en/staff/today");
    expect(h.signInEmail.mock.calls[0][0]).toMatchObject({
      body: { email: "elif@staff.example", password: process.env.DEMO_PASSWORD },
    });
    await expect(demoSignIn("admin")).rejects.toThrow("REDIRECT /en/staff/calendar");
    await expect(demoSignIn("receptionist")).rejects.toThrow(/^REDIRECT \/en\/staff\/calendar$/);
  });

  it("magic moment: the receptionist lands on the day of this browser's newest booking", async () => {
    h.cookie = encodeMine(["00000000-0000-4000-8000-000000000000", mineId]);
    await expect(demoSignIn("receptionist")).rejects.toThrow(`REDIRECT /en/staff/calendar?date=${mineDate}`);
    // Only the receptionist gets it; the dentist still goes to today.
    await expect(demoSignIn("dentist")).rejects.toThrow(/^REDIRECT \/en\/staff\/today$/);
  });

  it("follows a safe next, ignores an off-site or out-of-area one", async () => {
    await expect(demoSignIn("receptionist", "/en/staff/calendar?date=2026-11-12")).rejects.toThrow(
      "REDIRECT /en/staff/calendar?date=2026-11-12",
    );
    for (const evil of ["//evil.example/en/staff", "https://evil.example", "/en/book", "/en/staff/../x"]) {
      await expect(demoSignIn("admin", evil)).rejects.toThrow(/^REDIRECT \/en\/staff\/calendar$/);
    }
  });
});

describe("signIn rate limit", () => {
  const form = (email: string, password: string) => {
    const f = new FormData();
    f.set("email", email);
    f.set("password", password);
    return f;
  };
  const initial = { error: null, email: "" };

  it("refuses the 11th attempt from one IP within 15 minutes, keeping the email; other IPs are unaffected", async () => {
    await resetDemo(db, NOW); // clears rate_events
    h.signInEmail.mockImplementation(async () => {
      throw new APIError("UNAUTHORIZED", { message: "Invalid email or password" });
    });
    h.ip = "198.51.100.23";
    for (let i = 0; i < 10; i++) {
      expect(await signIn(initial, form("zeynep@staff.example", `guess-${i}`))).toEqual({
        error: "invalid",
        email: "zeynep@staff.example",
      });
    }
    expect(h.signInEmail).toHaveBeenCalledTimes(10);
    expect(await signIn(initial, form("zeynep@staff.example", "guess-10"))).toEqual({
      error: "rateLimited",
      email: "zeynep@staff.example",
    });
    expect(h.signInEmail).toHaveBeenCalledTimes(10); // never reached Better Auth

    h.ip = "198.51.100.24";
    expect((await signIn(initial, form("zeynep@staff.example", "x-other-ip"))).error).toBe("invalid");
    h.signInEmail.mockReset();
    h.signInEmail.mockImplementation(async () => ({ user: {} }));
  });
});
