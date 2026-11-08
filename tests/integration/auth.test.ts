import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import { seedClinic } from "@/lib/demo/seed";
import { resetDemo } from "@/lib/demo/reset";
import { seedStaffUsers, STAFF_USERS } from "@/lib/demo/staff-users";
import { account, dentists, user } from "@/lib/db/schema";
import { closeTestDb, resetTables, testDb, TEST_DATABASE_URL } from "./helpers/db";

const NOW = new Date("2026-11-10T08:00:00+03:00");
const db = testDb();
// getAuth() builds its client lazily from DATABASE_URL, so pointing it at the test DB here works.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "integration-auth-secret-0123456789abcdef";

beforeEach(async () => {
  await db.execute(sql`TRUNCATE "session", "account", "verification", "user" CASCADE`);
  await resetTables(db);
});
afterAll(async () => {
  await closeTestDb();
  const { sharedDb } = await import("@/lib/db/client");
  await sharedDb().$client.end();
});

describe("seedStaffUsers", () => {
  it("creates 3 users with the right roles; the dentist is linked to Dr. Elif Aydın", async () => {
    await seedClinic(db, { now: NOW });
    const ids = await seedStaffUsers(db);
    const rows = await db.select().from(user);
    expect(rows).toHaveLength(3);
    const byEmail = new Map(rows.map((r) => [r.email, r]));
    expect(byEmail.get("zeynep@staff.example")).toMatchObject({ id: ids.receptionist, role: "receptionist", dentistId: null });
    expect(byEmail.get("admin@staff.example")).toMatchObject({ id: ids.admin, role: "admin", dentistId: null });
    const [elif] = await db.select().from(dentists).where(eq(dentists.slug, "elif-aydin"));
    expect(byEmail.get("elif@staff.example")).toMatchObject({ id: ids.dentist, role: "dentist", dentistId: elif.id });
  });

  it("stores a credential account whose hash verifies against DEMO_PASSWORD", async () => {
    await seedClinic(db, { now: NOW });
    await seedStaffUsers(db);
    const accts = await db.select().from(account);
    expect(accts).toHaveLength(3);
    for (const a of accts) {
      expect(a.providerId).toBe("credential");
      expect(a.accountId).toBe(a.userId);
      expect(await verifyPassword({ hash: a.password!, password: process.env.DEMO_PASSWORD! })).toBe(true);
      expect(await verifyPassword({ hash: a.password!, password: "wrong" })).toBe(false);
    }
  });

  it("fails loudly when the dentist profile is missing", async () => {
    await expect(seedStaffUsers(db)).rejects.toThrow(/elif-aydin/);
  });

  it("resetDemo wipes and re-seeds the staff accounts", async () => {
    await resetDemo(db, NOW);
    const first = await db.select({ id: user.id }).from(user);
    await resetDemo(db, NOW);
    const second = await db.select({ email: user.email, id: user.id }).from(user);
    expect(second.map((r) => r.email).sort()).toEqual(STAFF_USERS.map((u) => u.email).sort());
    expect(second.some((r) => first.some((f) => f.id === r.id))).toBe(false);
  });
});

describe("Better Auth against the seeded accounts", () => {
  it("signs in with DEMO_PASSWORD, exposes role and dentistId, refuses a wrong password", async () => {
    const { getAuth } = await import("@/lib/auth/auth");
    await resetDemo(db, NOW);
    const res = await getAuth().api.signInEmail({
      body: { email: "elif@staff.example", password: process.env.DEMO_PASSWORD! },
    });
    expect(res.token).toBeTruthy();
    const [elif] = await db.select().from(dentists).where(eq(dentists.slug, "elif-aydin"));
    expect(res.user).toMatchObject({ email: "elif@staff.example", role: "dentist", dentistId: elif.id });
    await expect(
      getAuth().api.signInEmail({ body: { email: "elif@staff.example", password: "nope-nope" } }),
    ).rejects.toThrow();
  });

  it("sign-up is disabled", async () => {
    const { getAuth } = await import("@/lib/auth/auth");
    await expect(
      getAuth().api.signUpEmail({ body: { email: "x@staff.example", password: "long-enough-pw", name: "X" } }),
    ).rejects.toThrow();
  });
});

describe("newestMineDate (magic moment)", () => {
  it("gives the Istanbul date of the newest existing appointment in the cookie list", async () => {
    const { newestMineDate } = await import("@/lib/demo/magic");
    const { entries } = await import("@/lib/db/schema");
    await resetDemo(db, NOW);
    const appts = await db.select({ id: entries.id, during: entries.during }).from(entries).where(eq(entries.kind, "appointment")).limit(2);
    const missing = "00000000-0000-4000-8000-000000000000";
    const { istanbulDateOf } = await import("@/lib/time");
    // Newest first; an id that no longer exists (e.g. after a reset) is skipped.
    expect(await newestMineDate(db, [missing, appts[1].id, appts[0].id])).toBe(istanbulDateOf(appts[1].during.start));
    expect(await newestMineDate(db, [missing])).toBeNull();
    expect(await newestMineDate(db, [])).toBeNull();
  });

  it("uses the Istanbul date, not UTC, for a late-evening appointment", async () => {
    const { newestMineDate } = await import("@/lib/demo/magic");
    const { entries } = await import("@/lib/db/schema");
    await resetDemo(db, NOW);
    const [row] = await db.select({ id: entries.id }).from(entries).where(eq(entries.kind, "appointment")).limit(1);
    const [block] = await db.select({ id: entries.id }).from(entries).where(eq(entries.kind, "block")).limit(1);
    expect(await newestMineDate(db, [block.id])).toBeNull(); // blocks don't count
    // 01:30 Istanbul on the 12th is 22:30 UTC on the 11th (nothing else is booked at night).
    await db
      .update(entries)
      .set({ during: { start: new Date("2026-11-12T01:30:00+03:00"), end: new Date("2026-11-12T02:00:00+03:00") } })
      .where(eq(entries.id, row.id));
    expect(await newestMineDate(db, [row.id])).toBe("2026-11-12");
  });
});

describe("Better Auth hardening (fix round 1)", () => {
  it("stores no raw IP on the session", async () => {
    const { getAuth } = await import("@/lib/auth/auth");
    const { session } = await import("@/lib/db/schema");
    await resetDemo(db, NOW);
    await getAuth().api.signInEmail({
      body: { email: "zeynep@staff.example", password: process.env.DEMO_PASSWORD! },
      headers: new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "vitest" }),
    });
    const rows = await db.select().from(session);
    expect(rows).toHaveLength(1);
    expect(rows[0].ipAddress ?? "").toBe("");
  });

  it("the HTTP router refuses account-changing and sign-in/up endpoints, keeps get-session", async () => {
    const { getAuth, DISABLED_AUTH_PATHS } = await import("@/lib/auth/auth");
    for (const path of [
      "/update-user",
      "/change-password",
      "/change-email",
      "/delete-user",
      "/revoke-sessions",
      "/revoke-other-sessions",
      "/revoke-session",
      "/request-password-reset",
      "/reset-password",
      "/sign-up/email",
      "/sign-in/email",
    ]) {
      expect(DISABLED_AUTH_PATHS).toContain(path);
      const res = await getAuth().handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: "{}",
        }),
      );
      expect(res.status, path).toBe(404);
    }
    // GET endpoints too: listing sessions would expose other sessions' metadata.
    expect(DISABLED_AUTH_PATHS).toContain("/list-sessions");
    const list = await getAuth().handler(new Request("http://localhost:3000/api/auth/list-sessions"));
    expect(list.status).toBe(404);
    const ok = await getAuth().handler(new Request("http://localhost:3000/api/auth/get-session"));
    expect(ok.status).toBe(200);
  });
});
