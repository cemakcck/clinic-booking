import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import { resetDemo } from "@/lib/demo/reset";
import { seedClinic } from "@/lib/demo/seed";
import { countPublicSlots } from "@/lib/booking/availability";
import { clinicData } from "@/content/clinic-data";
import { effectiveHours } from "@/lib/slots/engine";
import { addDays, atIstanbul, weekdayOf } from "@/lib/time";
import { dentists, entries, patients, treatments } from "@/lib/db/schema";
import { closeTestDb, resetTables, testDb, TEST_DATABASE_URL } from "./helpers/db";

const NOW = new Date("2026-11-10T08:00:00+03:00");
const db = testDb();

async function startsList() {
  const r = await db.execute<{ d: number; s: string }>(
    sql`SELECT dentist_id AS d, lower(during)::text AS s FROM entries ORDER BY dentist_id, lower(during), kind`,
  );
  return [...r].map((x) => `${x.d}|${x.s}`);
}

beforeEach(async () => {
  await resetTables(db);
});
afterAll(closeTestDb);

describe("seed", () => {
  it("seeds 4 dentists and 7 treatments", async () => {
    await seedClinic(db, { now: NOW });
    expect((await db.select({ n: count() }).from(dentists))[0].n).toBe(4);
    expect((await db.select({ n: count() }).from(treatments))[0].n).toBe(7);
  });

  it("calendar is busy but bookable", async () => {
    await seedClinic(db, { now: NOW });
    for (const d of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]) {
      expect(await countPublicSlots(db, d, NOW)).toBeGreaterThanOrEqual(8);
      const [{ n }] = await db
        .select({ n: count() })
        .from(entries)
        .where(
          and(
            eq(entries.kind, "appointment"),
            eq(entries.active, true),
            sql`${entries.during} && tstzrange(${d + "T00:00:00+03:00"}::timestamptz, ${d + "T23:59:59+03:00"}::timestamptz)`,
          ),
        );
      expect(n).toBeGreaterThanOrEqual(20);
    }
  });

  it("fills about 70% of open minutes on non-guarded days", async () => {
    await seedClinic(db, { now: NOW });
    const rows = await db.select().from(entries).where(and(eq(entries.kind, "appointment"), eq(entries.active, true)));
    const idBySlug = new Map((await db.select().from(dentists)).map((d) => [d.slug, d.id]));
    let booked = 0;
    let capacity = 0;
    for (let i = 0; i < 6; i++) {
      const date = addDays("2026-11-16", i); // next Mon-Sat, past the guarded days
      if (date === "2026-11-19") continue; // leave day
      const wd = weekdayOf(date);
      const ch = clinicData.clinicHours.find((h) => h.weekday === wd)!;
      for (const d of clinicData.dentists) {
        const wh = d.hours.find((h) => h.weekday === wd);
        const eh = effectiveHours(
          ch.open ? { start: ch.open, end: ch.close! } : null,
          wh ? { start: wh.start, end: wh.end } : null,
          clinicData.lunch,
        );
        if (!eh) continue;
        const from = atIstanbul(date, eh.open.start).getTime();
        const to = atIstanbul(date, eh.open.end).getTime();
        const lunchMin = eh.breaks.reduce(
          (n, b) => n + (atIstanbul(date, b.end).getTime() - atIstanbul(date, b.start).getTime()) / 60000,
          0,
        );
        capacity += (to - from) / 60000 - lunchMin;
        for (const r of rows) {
          if (r.dentistId !== idBySlug.get(d.slug)) continue;
          if (r.during.start.getTime() >= from && r.during.start.getTime() < to) {
            booked += (r.during.end.getTime() - r.during.start.getTime()) / 60000;
          }
        }
      }
    }
    const fraction = booked / capacity;
    console.log("fill fraction", fraction.toFixed(3));
    expect(fraction).toBeGreaterThan(0.6);
    expect(fraction).toBeLessThan(0.8);
  });

  it("includes a surgery block, a leave day and 2 callbacks", async () => {
    await seedClinic(db, { now: NOW });
    const blocks = await db.select().from(entries).where(eq(entries.kind, "block"));
    expect(blocks.map((b) => b.blockReason).sort()).toEqual(["leave", "surgery"]);
    const r = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM callback_requests`);
    expect([...r][0].n).toBe(2);
  });

  it("seed is deterministic", async () => {
    await resetDemo(db, NOW);
    const a = await startsList();
    await resetDemo(db, NOW);
    const b = await startsList();
    expect(a.length).toBeGreaterThan(100);
    expect(b).toEqual(a);
  });

  it("all seeded emails are example.com", async () => {
    await seedClinic(db, { now: NOW });
    const rows = await db.select({ email: patients.email }).from(patients);
    expect(rows).toHaveLength(30);
    for (const r of rows) expect(r.email).toMatch(/@example\.com$/);
  });

  it("no seeded prices", () => {
    expect(JSON.stringify(clinicData)).not.toMatch(/price|fiyat|₺/i);
  });

  it("reset wipes visitor data", async () => {
    await resetDemo(db, NOW);
    await db.insert(patients).values({ name: "Visitor", phoneE164: "+905559998877", locale: "en" });
    await resetDemo(db, NOW);
    const rows = await db.select().from(patients).where(eq(patients.phoneE164, "+905559998877"));
    expect(rows).toHaveLength(0);
  });
});

describe("cron route", () => {
  const prev = { url: process.env.DATABASE_URL, secret: process.env.CRON_SECRET, demo: process.env.DEMO_MODE };
  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.CRON_SECRET = "s3cret";
  });
  afterAll(async () => {
    const { db: appDb } = await import("@/lib/db/client");
    await (await appDb()).$client.end();
    (globalThis as { __clinicDb?: unknown }).__clinicDb = undefined;
    (globalThis as { __clinicMigrate?: unknown }).__clinicMigrate = undefined;
    for (const [k, v] of [["DATABASE_URL", prev.url], ["CRON_SECRET", prev.secret], ["DEMO_MODE", prev.demo]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const req = (auth?: string) =>
    new Request("http://localhost/api/cron/reset", { headers: auth ? { authorization: auth } : {} });

  it("auth: 401 without bearer, 403 outside demo, 200 and reseeds", async () => {
    const { GET } = await import("@/app/api/cron/reset/route");
    process.env.DEMO_MODE = "1";
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    process.env.DEMO_MODE = "";
    expect((await GET(req("Bearer s3cret"))).status).toBe(403);
    process.env.DEMO_MODE = "1";
    await db.insert(patients).values({ name: "Visitor", phoneE164: "+905559998877", locale: "en" });
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await db.select({ n: count() }).from(dentists))[0].n).toBe(4);
    expect((await db.select().from(patients).where(eq(patients.phoneE164, "+905559998877")))).toHaveLength(0);
  });
});
