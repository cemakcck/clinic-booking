import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dentists, entries, patients, rateEvents } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import { getDaySlots } from "@/lib/booking/availability";
import { BookingError } from "@/lib/booking/errors";
import { confirmBooking, placeHold, releaseHold } from "@/lib/booking/holds";
import { hashToken } from "@/lib/security/tokens";

const db = testDb();
const now = new Date(NOW_ISO);
const D = "2026-11-10";
const min = (n: number) => new Date(now.getTime() + n * 60_000);
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

const hold = (over: Partial<Parameters<typeof placeHold>[1]> = {}) =>
  placeHold(db, {
    treatmentId: fx.treatments.checkup,
    dentistId: fx.dentists.ayd,
    // 11:00, not 10:00: tests that advance `now` by 6-7 minutes must stay outside the 2h public lead.
    start: T(D, "11:00"),
    now,
    ipHash: "ip-1",
    ...over,
  });

const patient = { name: "Çağlar Öztürk", phone: "0532 111 2233", email: "c@example.com", locale: "tr" as const };
const confirm = (h: { holdId: string; holdToken: string }, over: Partial<Parameters<typeof confirmBooking>[1]> = {}) =>
  confirmBooking(db, { holdId: h.holdId, holdToken: h.holdToken, patient, now, ipHash: "ip-c", ...over });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof BookingError ? e.code : e;
  }
  return "no error";
};

describe("holds", () => {
  it("placeHold reserves the slot", async () => {
    const h = await hold();
    expect(h.expiresAt).toEqual(min(5));
    const s = await getDaySlots(db, {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.ayd,
      date: D,
      now,
      audience: "public",
    });
    expect(s.map((x) => x.start.getTime())).not.toContain(T(D, "11:00").getTime());
  });

  it("placeHold succeeds over an expired hold", async () => {
    await hold();
    await hold({ now: min(6), ipHash: "ip-2" });
    const rows = await db.select().from(entries).where(eq(entries.kind, "hold"));
    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt).toEqual(min(11));
  });

  it("concurrent holds on one slot: exactly one wins", async () => {
    // Distinct ipHash per call so the rate limit is irrelevant here.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => hold({ ipHash: `ip-par-${i}` })),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(19);
    for (const r of bad) expect((r.reason as BookingError).code).toBe("slot_taken");
  });

  it("any assigns the least busy dentist", async () => {
    const [p] = await db.insert(patients).values({ name: "X", phoneE164: "+905550000000", locale: "en" }).returning();
    await db.insert(entries).values({
      patientId: p.id,
      dentistId: fx.dentists.ayd,
      kind: "appointment",
      during: { start: T(D, "15:00"), end: T(D, "15:30") },
      status: "booked",
      source: "staff",
      treatmentId: fx.treatments.checkup,
    });
    const h = await hold({ dentistId: "any", start: T(D, "10:00") });
    expect(h.dentistId).toBe(fx.dentists.kay);
  });

  it("rate limit: the 21st hold from one ip is rate_limited", async () => {
    // The limit is exactly 20/hour: attempts on one taken slot still count, so 20 pass the limiter
    // (1 hold, 19 slot_taken) and the 21st is rejected by it.
    for (let i = 0; i < 20; i++) await hold({ ipHash: "ip-rate" }).catch(() => {});
    expect(await code(hold({ ipHash: "ip-rate" }))).toBe("rate_limited");
    expect(await db.select().from(rateEvents)).toHaveLength(20);
  });
});

describe("confirm", () => {
  it("turns the hold into an appointment", async () => {
    const h = await hold();
    const r = await confirm(h);
    expect(r.created).toBe(true);
    const [row] = await db.select().from(entries).where(eq(entries.id, r.appointmentId));
    expect(row.kind).toBe("appointment");
    expect(row.status).toBe("booked");
    expect(row.source).toBe("online");
    expect(row.expiresAt).toBeNull();
    expect(row.manageTokenHash).toBe(hashToken(r.manageToken));
    const [p] = await db.select().from(patients);
    expect(p.phoneE164).toBe("+905321112233");
    expect(p.name).toBe("Çağlar Öztürk");
    expect(row.patientId).toBe(p.id);
    expect(r.start).toEqual(T(D, "11:00"));
    expect(r.end).toEqual(T(D, "11:30"));
  });

  it("is idempotent per hold", async () => {
    const h = await hold();
    const a = await confirm(h);
    const b = await confirm(h);
    expect(b.appointmentId).toBe(a.appointmentId);
    expect([a.created, b.created]).toEqual([true, false]);
    expect(b.manageToken).toBe(a.manageToken);
    const rows = await db.select().from(entries).where(eq(entries.kind, "appointment"));
    expect(rows).toHaveLength(1);
    expect(rows[0].manageTokenHash).toBe(hashToken(a.manageToken));
  });

  it("concurrent double submit yields one appointment", async () => {
    const h = await hold();
    const [a, b] = await Promise.all([confirm(h), confirm(h)]);
    expect(a.appointmentId).toBe(b.appointmentId);
    expect([a.created, b.created].sort()).toEqual([false, true]);
  });

  it("confirm refuses a hold whose dentist was deactivated after the hold was placed", async () => {
    const h = await hold();
    await db.update(dentists).set({ active: false }).where(eq(dentists.id, fx.dentists.ayd));
    expect(await code(confirm(h))).toBe("hold_expired");
    const [row] = await db.select().from(entries).where(eq(entries.id, h.holdId));
    expect(row.kind).toBe("hold");
  });

  it("re-acquires an expired but still-free hold", async () => {
    const h = await hold();
    const r = await confirm(h, { now: min(7) });
    expect(r.created).toBe(true);
    const [row] = await db.select().from(entries).where(eq(entries.id, r.appointmentId));
    expect(row.kind).toBe("appointment");
  });

  it("fails with hold_expired when an expired hold's slot was taken", async () => {
    const a = await hold();
    await hold({ now: min(6), ipHash: "ip-2" });
    expect(await code(confirm(a, { now: min(7) }))).toBe("hold_expired");
  });

  it("re-acquiring an expired hold races a new hold for the slot: exactly one gets it", async () => {
    for (let round = 0; round < 10; round++) {
      await db.delete(entries);
      const a = await hold({ ipHash: `ip-r${round}` });
      const [c, p] = await Promise.allSettled([
        confirm(a, { now: min(7), ipHash: `ip-rc${round}` }),
        hold({ now: min(7), ipHash: `ip-rp${round}` }),
      ]);
      const outcome = [
        c.status === "fulfilled" ? "confirmed" : await code(Promise.reject(c.reason)),
        p.status === "fulfilled" ? "held" : await code(Promise.reject(p.reason)),
      ];
      expect([
        ["confirmed", "slot_taken"],
        ["hold_expired", "held"],
      ]).toContainEqual(outcome);
      expect(await db.select().from(entries)).toHaveLength(1);
    }
  }, 30_000);

  it("fails with hold_expired when the expired hold is no longer bookable", async () => {
    const a = await hold();
    // 09:00: the hold has expired and 10:00 is now inside the 2h public lead time.
    expect(await code(confirm(a, { now: T(D, "09:30") }))).toBe("hold_expired");
  });

  it("rejects a wrong hold token", async () => {
    const h = await hold();
    expect(await code(confirm({ ...h, holdToken: "nope" }))).toBe("not_found");
  });

  it("reports hold_expired when the hold row is gone", async () => {
    expect(await code(confirm({ holdId: "00000000-0000-4000-8000-000000000000", holdToken: "x" }))).toBe(
      "hold_expired",
    );
  });

  it("rate limits confirm", async () => {
    const h = await hold();
    for (let i = 0; i < 10; i++) await confirm(h);
    expect(await code(confirm(h))).toBe("rate_limited");
  });

  it("same phone reuses the patient", async () => {
    const h1 = await hold();
    await confirm(h1);
    const h2 = await hold({ start: T(D, "14:00") });
    const r2 = await confirm(h2, { patient: { ...patient, phone: "+905321112233", name: "Çağlar O." } });
    const ps = await db.select().from(patients);
    expect(ps).toHaveLength(1);
    // The shared patient row is fill-only; the name typed this time lives on the appointment.
    expect(ps[0].name).toBe("Çağlar Öztürk");
    const [row] = await db.select().from(entries).where(eq(entries.id, r2.appointmentId));
    expect(row.patientId).toBe(ps[0].id);
    expect(row.contactName).toBe("Çağlar O.");
  });
});

describe("releaseHold", () => {
  const slots11 = async () =>
    (
      await getDaySlots(db, { treatmentId: fx.treatments.checkup, dentistId: fx.dentists.ayd, date: D, now, audience: "public" })
    ).map((x) => x.start.getTime());

  it("releaseHold frees the slot", async () => {
    const h = await hold();
    expect(await slots11()).not.toContain(T(D, "11:00").getTime());
    await releaseHold(db, { holdId: h.holdId, holdToken: h.holdToken });
    expect(await slots11()).toContain(T(D, "11:00").getTime());
    // The same patient can hold it again straight away.
    await expect(hold()).resolves.toMatchObject({ dentistId: fx.dentists.ayd });
  });

  it("releaseHold with a wrong token does nothing", async () => {
    const h = await hold();
    await releaseHold(db, { holdId: h.holdId, holdToken: "wrong-token-wrong-token-wrong" });
    expect(await db.select().from(entries).where(eq(entries.id, h.holdId))).toHaveLength(1);
    expect(await slots11()).not.toContain(T(D, "11:00").getTime());
    // Malformed ids are a no-op, not a database error.
    await expect(releaseHold(db, { holdId: "not-a-uuid", holdToken: h.holdToken })).resolves.toBeUndefined();
  });

  it("releaseHold never deletes an appointment", async () => {
    const h = await hold();
    await confirm(h);
    await releaseHold(db, { holdId: h.holdId, holdToken: h.holdToken });
    const [row] = await db.select().from(entries).where(eq(entries.id, h.holdId));
    expect(row).toMatchObject({ kind: "appointment", status: "booked", active: true });
  });
});
