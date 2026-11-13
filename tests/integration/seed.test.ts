import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { resetDemo } from "@/lib/demo/reset";
import { seedClinic } from "@/lib/demo/seed";
import { countPublicSlots } from "@/lib/booking/availability";
import { clinicData } from "@/content/clinic-data";
import { effectiveHours } from "@/lib/slots/engine";
import { addDays, atIstanbul, weekdayOf } from "@/lib/time";
import { dashboardData, type Period } from "@/lib/dashboard/metrics";
import type { Actor } from "@/lib/auth/roles";
import { dentists, emailLog, entries, patients, reminders, treatments } from "@/lib/db/schema";
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
    expect(rows.length).toBeGreaterThanOrEqual(60);
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

describe("seeded history", () => {
  const DAY = 86_400_000;
  const MONDAY = atIstanbul("2026-11-09", "00:00").getTime();
  const weekOf = (t: number) => Math.floor((t - MONDAY) / (7 * DAY));

  async function appointments() {
    const r = await db.execute<{ d: number; s: Date; st: string; src: string; sched: Date }>(
      sql`SELECT dentist_id AS d, lower(during) AS s, status AS st, source AS src, scheduled_at AS sched
          FROM entries WHERE kind = 'appointment' ORDER BY dentist_id, lower(during)`,
    );
    return [...r].map((x) => ({ ...x, s: new Date(x.s), sched: new Date(x.sched) }));
  }

  it("history spans 26 weeks before this week", async () => {
    await seedClinic(db, { now: NOW });
    const rows = await appointments();
    const weeks = new Set(rows.map((r) => weekOf(r.s.getTime())));
    for (let w = -26; w <= -1; w++) expect(weeks.has(w), `week ${w}`).toBe(true);
    expect(Math.min(...weeks)).toBe(-26);
  });

  it("no-show rate over history is between 5% and 11%", async () => {
    await seedClinic(db, { now: NOW });
    const past = (await appointments()).filter((r) => r.s.getTime() < MONDAY && r.st !== "cancelled");
    const rate = past.filter((r) => r.st === "no_show").length / past.length;
    expect(past.length).toBeGreaterThan(1000);
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.11);
  });

  it("both sources appear in every week", async () => {
    await seedClinic(db, { now: NOW });
    const rows = await appointments();
    for (let w = -26; w <= 1; w++) {
      const srcs = new Set(rows.filter((r) => weekOf(r.s.getTime()) === w).map((r) => r.src));
      expect([...srcs].sort(), `week ${w}`).toEqual(["online", "staff"]);
    }
  });

  it("seeded appointments are scheduled at least 2 days ahead", async () => {
    await seedClinic(db, { now: NOW });
    for (const r of await appointments()) {
      const lead = r.s.getTime() - r.sched.getTime();
      expect(lead).toBeGreaterThanOrEqual(2 * DAY);
      expect(lead).toBeLessThanOrEqual(20 * DAY);
      expect(r.sched.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("past SMS reminder rows exist for the last 14 days and none for older", async () => {
    await seedClinic(db, { now: NOW });
    const rows = await db.select().from(reminders);
    expect(rows.length).toBeGreaterThan(50);
    const from = NOW.getTime() - 14 * DAY;
    for (const r of rows) {
      expect(r.channel).toBe("sms");
      expect(r.status).toBe("simulated");
      expect(r.source).toBe("schedule");
      expect(r.startsAt.getTime()).toBeGreaterThanOrEqual(from);
      expect(r.startsAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(r.createdAt.getTime()).toBe(r.startsAt.getTime() - DAY);
      expect(r.toAddress).toMatch(/^\+90532555\d{4}$/);
      expect(r.body).toMatch(r.locale === "tr" ? /yarın/i : /tomorrow/i);
    }
    // Every non-cancelled appointment that started in the window has exactly one.
    const due = (await appointments()).filter(
      (a) => a.st !== "cancelled" && a.s.getTime() >= from && a.s.getTime() <= NOW.getTime(),
    );
    expect(rows).toHaveLength(due.length);
    // Both patient locales appear.
    expect(new Set(rows.map((r) => r.locale))).toEqual(new Set(["en", "tr"]));
  });

  it("no email_log rows after seeding", async () => {
    await seedClinic(db, { now: NOW });
    expect((await db.select({ n: count() }).from(emailLog))[0].n).toBe(0);
    expect((await db.select({ n: count() }).from(reminders).where(eq(reminders.channel, "email")))[0].n).toBe(0);
  });

  it("seeding twice with the same now is identical", async () => {
    const snapshot = async () => {
      const rows = await appointments();
      const hash = createHash("sha256")
        .update(rows.map((r) => `${r.d}|${r.s.toISOString()}|${r.st}`).join("\n"))
        .digest("hex");
      const n = async (t: typeof entries | typeof reminders | typeof patients) =>
        (await db.select({ n: count() }).from(t))[0].n;
      return { hash, entries: await n(entries), reminders: await n(reminders), patients: await n(patients) };
    };
    await resetDemo(db, NOW);
    const a = await snapshot();
    await resetDemo(db, NOW);
    expect(await snapshot()).toEqual(a);
  });

  it("dashboardData has a previous period for week, 4w and 3m", async () => {
    await seedClinic(db, { now: NOW });
    const reception: Actor = { userId: "u-rec", name: "Rec", role: "receptionist", dentistId: null };
    for (const p of ["week", "4w", "3m"] as Period[]) {
      const d = await dashboardData(db, reception, p, NOW);
      expect(d.previous, p).not.toBeNull();
      expect(d.previous!.appointments, p).toBeGreaterThan(0);
      expect(d.current.appointments, p).toBeGreaterThan(0);
    }
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
