import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetTables, seedFixture, testDb, TEST_DATABASE_URL } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import { entries, patients, reminders } from "@/lib/db/schema";

const db = testDb();
const H = 3_600_000;
const prev = { url: process.env.DATABASE_URL, secret: process.env.CRON_SECRET };
let fx: Fixture;

beforeAll(() => {
  // The route reads the shared db(); point it at the test database, as the reset route test does.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.CRON_SECRET = "s3cret";
});
afterAll(async () => {
  const { db: appDb } = await import("@/lib/db/client");
  await (await appDb()).$client.end();
  (globalThis as { __clinicDb?: unknown }).__clinicDb = undefined;
  (globalThis as { __clinicMigrate?: unknown }).__clinicMigrate = undefined;
  for (const [k, v] of [["DATABASE_URL", prev.url], ["CRON_SECRET", prev.secret]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await closeTestDb();
});
beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const req = (auth?: string) =>
  new Request("http://localhost/api/cron/reminders", { headers: auth ? { authorization: auth } : {} });

describe("cron reminders route", () => {
  it("401 without or with a wrong bearer", async () => {
    const { GET } = await import("@/app/api/cron/reminders/route");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
  });

  it("200 runs the pass and returns counts", async () => {
    const { GET } = await import("@/app/api/cron/reminders/route");
    const now = Date.now();
    const [p] = await db
      .insert(patients)
      .values({ name: "Seed Patient", phoneE164: "+905321110001", email: null, locale: "en" })
      .returning({ id: patients.id });
    const start = new Date(now + 5 * H);
    const [e] = await db
      .insert(entries)
      .values({
        dentistId: fx.dentists.ayd,
        kind: "appointment",
        during: { start, end: new Date(start.getTime() + 30 * 60_000) },
        treatmentId: fx.treatments.checkup,
        patientId: p.id,
        status: "booked",
        active: true,
        source: "online",
        scheduledAt: new Date(now - 72 * H),
      })
      .returning({ id: entries.id });

    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, considered: 1, sms: 1 });
    const rows = await db.select().from(reminders).where(eq(reminders.entryId, e.id));
    expect(rows.filter((r) => r.channel === "sms")).toHaveLength(1);
  });
});
