import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import { entries, patients, reminders } from "@/lib/db/schema";
import type { Actor } from "@/lib/auth/roles";
import { moveAppointment } from "@/lib/staff/appointments";
import { runReminders } from "@/lib/reminders/run";
import { listReminders } from "@/lib/reminders/log";
import { sendRemindersNow } from "@/lib/reminders/send-now";
import { BookingError } from "@/lib/booking/errors";
import { istanbulDateOf } from "@/lib/time";

const db = testDb();
const now = new Date(NOW_ISO); // Tue 2026-11-10 08:00 Istanbul
const H = 3_600_000;
const at = (hours: number) => new Date(now.getTime() + hours * H);
let fx: Fixture;
let phoneSeq = 0;

const reception: Actor = { userId: "u-rec", name: "Rec", role: "receptionist", dentistId: null };
const dentist: Actor = { userId: "u-den", name: "Den", role: "dentist", dentistId: 1 };
const ALL = { from: "2026-11-01", to: "2026-11-30", channel: "all" as const, mine: [] as string[] };

type ApptOpts = {
  start: Date;
  status?: "booked" | "cancelled";
  dentistId?: number;
  locale?: "en" | "tr";
  email?: string | null;
  source?: "online" | "staff";
};

async function appt(o: ApptOpts): Promise<string> {
  phoneSeq += 1;
  const [p] = await db
    .insert(patients)
    .values({ name: "Seed Patient", phoneE164: `+90532111${String(phoneSeq).padStart(4, "0")}`, email: null, locale: "en" })
    .returning({ id: patients.id });
  const status = o.status ?? "booked";
  const [r] = await db
    .insert(entries)
    .values({
      dentistId: o.dentistId ?? fx.dentists.ayd,
      kind: "appointment",
      during: { start: o.start, end: new Date(o.start.getTime() + 30 * 60_000) },
      treatmentId: fx.treatments.checkup,
      patientId: p.id,
      status,
      active: status !== "cancelled",
      source: o.source ?? "online",
      contactName: "Ayşe Yılmaz",
      contactEmail: o.email === undefined ? "ayse@mail.test" : o.email,
      contactLocale: o.locale ?? "en",
      scheduledAt: at(-72),
    })
    .returning({ id: entries.id });
  return r.id;
}

/** A finished reminder row written directly, so `createdAt` is under the test's control. */
async function logRow(entryId: string, o: { channel: "email" | "sms"; createdAt: Date; status?: string; to?: string; body?: string }) {
  const [e] = await db.select({ during: entries.during }).from(entries).where(eq(entries.id, entryId));
  await db.insert(reminders).values({
    entryId,
    channel: o.channel,
    startsAt: e.during.start,
    status: o.status ?? (o.channel === "sms" ? "simulated" : "logged"),
    toAddress: o.to ?? (o.channel === "sms" ? "+905321112233" : "ayse@mail.test"),
    locale: "en",
    body: o.body ?? `${o.channel} body`,
    source: "schedule",
    createdAt: o.createdAt,
  });
}

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("DEMO_MODE", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(closeTestDb);

describe("listReminders", () => {
  it("lists newest first within the date range and channel filter", async () => {
    const a = await appt({ start: T("2026-11-20", "10:00") });
    const b = await appt({ start: T("2026-11-20", "11:00"), dentistId: fx.dentists.kay });
    const c = await appt({ start: T("2026-11-20", "12:00") });
    await logRow(a, { channel: "sms", createdAt: T("2026-11-09", "23:59") }); // before the range (Istanbul)
    await logRow(a, { channel: "email", createdAt: T("2026-11-10", "00:00") }); // first instant of the range
    await logRow(b, { channel: "sms", createdAt: T("2026-11-11", "12:00") });
    await logRow(b, { channel: "email", createdAt: T("2026-11-12", "23:59") }); // last minute of the range
    await logRow(c, { channel: "email", createdAt: T("2026-11-13", "00:00") }); // after the range

    const q = { from: "2026-11-10", to: "2026-11-12", channel: "all" as const, mine: [] };
    const all = await listReminders(db, reception, q);
    expect(all.map((r) => r.createdAt)).toEqual([T("2026-11-12", "23:59"), T("2026-11-11", "12:00"), T("2026-11-10", "00:00")]);
    expect(all[0]).toMatchObject({
      channel: "email",
      status: "logged",
      patientName: "Ayşe Yılmaz",
      contact: "ayse@mail.test",
      appointment: { id: b, start: T("2026-11-20", "11:00"), dentistName: "Dr. Kay" },
    });

    const sms = await listReminders(db, reception, { ...q, channel: "sms" });
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ channel: "sms", body: "sms body", appointment: { id: b } });
    expect((await listReminders(db, reception, { ...q, channel: "email" })).map((r) => r.channel)).toEqual(["email", "email"]);
    // Admin sees it too.
    expect(await listReminders(db, { ...reception, role: "admin" }, q)).toHaveLength(3);
  });

  it("dentist is denied", async () => {
    await expect(listReminders(db, dentist, ALL)).rejects.toBeInstanceOf(BookingError);
    await expect(listReminders(db, dentist, ALL)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("masks other visitors' contacts in demo mode but not mine", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    const theirs = await appt({ start: T("2026-11-20", "10:00") });
    const mine = await appt({ start: T("2026-11-20", "11:00"), dentistId: fx.dentists.kay });
    for (const id of [theirs, mine]) {
      await logRow(id, { channel: "sms", createdAt: T("2026-11-10", "09:00") });
      await logRow(id, { channel: "email", createdAt: T("2026-11-10", "09:01") });
    }
    const rows = await listReminders(db, reception, { ...ALL, mine: [mine] });
    const of = (id: string, ch: string) => rows.find((r) => r.appointment.id === id && r.channel === ch)!.contact;
    expect(of(theirs, "sms")).toBe("+90 5•• ••• •• 33");
    expect(of(theirs, "email")).toBe("a•••@mail.test");
    expect(of(mine, "sms")).toBe("+905321112233");
    expect(of(mine, "email")).toBe("ayse@mail.test");
    // The raw values never reach the result for someone else's booking.
    const theirsOnly = await listReminders(db, reception, ALL);
    expect(JSON.stringify(theirsOnly)).not.toMatch(/905321112233|ayse@mail\.test/);

    vi.stubEnv("DEMO_MODE", "");
    const live = await listReminders(db, reception, ALL);
    expect(live.every((r) => r.contact === "+905321112233" || r.contact === "ayse@mail.test")).toBe(true);
  });

  it("log keeps the patient's SMS language", async () => {
    const id = await appt({ start: at(20), locale: "tr" });
    await runReminders(db, now);
    const today = istanbulDateOf(new Date());
    const rows = await listReminders(db, reception, { from: today, to: today, channel: "sms", mine: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0].appointment.id).toBe(id);
    expect(rows[0].body).toContain("randevunuz var");
  });

  it("pending rows are hidden", async () => {
    const id = await appt({ start: T("2026-11-20", "10:00") });
    await logRow(id, { channel: "sms", createdAt: T("2026-11-10", "09:00") });
    await logRow(id, { channel: "email", createdAt: T("2026-11-10", "09:00"), status: "pending" });
    const rows = await listReminders(db, reception, ALL);
    expect(rows.map((r) => r.channel)).toEqual(["sms"]);
  });
});

describe("sendRemindersNow", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_MODE", "1");
  });

  it("send-now skips cancelled and uses the moved time", async () => {
    const cancelled = await appt({ start: at(30), status: "cancelled" });
    const moved = await appt({ start: T("2026-11-12", "10:00"), dentistId: fx.dentists.kay });
    await moveAppointment(db, reception, { appointmentId: moved, newStart: T("2026-11-12", "11:00"), now });

    const r = await sendRemindersNow(db, reception, { mine: [cancelled, moved], ipHash: "ip-a", now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.sms).toBe(1);

    const rows = await db.select().from(reminders);
    expect(rows.every((x) => x.entryId === moved)).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.startsAt.getTime() === T("2026-11-12", "11:00").getTime())).toBe(true);
    expect(rows.find((x) => x.channel === "sms")!.body).toContain("11:00");
    expect(rows.every((x) => x.source === "send_now")).toBe(true);
  });

  it("send-now racing the scheduled pass sends once", async () => {
    const id = await appt({ start: at(20) });
    await Promise.all([runReminders(db, now), runReminders(db, now, { onlyEntryIds: [id] })]);
    const rows = await db.select().from(reminders).where(eq(reminders.entryId, id));
    expect(rows.filter((x) => x.channel === "sms")).toHaveLength(1);
    expect(rows.filter((x) => x.channel === "email")).toHaveLength(1);
  });

  it("send-now outside demo mode is refused", async () => {
    vi.stubEnv("DEMO_MODE", "");
    const id = await appt({ start: at(20) });
    const r = await sendRemindersNow(db, reception, { mine: [id], ipHash: "ip-b", now });
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(await db.select().from(reminders)).toHaveLength(0);
    // A dentist can't use it either.
    vi.stubEnv("DEMO_MODE", "1");
    expect(await sendRemindersNow(db, dentist, { mine: [id], ipHash: "ip-b", now })).toEqual({ ok: false, reason: "forbidden" });
  });

  it("send-now with no bookings returns no_bookings", async () => {
    const r = await sendRemindersNow(db, reception, { mine: [], ipHash: "ip-c", now });
    expect(r).toEqual({ ok: false, reason: "no_bookings" });
  });

  it("send-now is rate limited after 5 per hour", async () => {
    const id = await appt({ start: at(20) });
    for (let i = 0; i < 5; i++) {
      const r = await sendRemindersNow(db, reception, { mine: [id], ipHash: "ip-d", now: new Date(now.getTime() + i * 60_000) });
      expect(r.ok).toBe(true);
    }
    expect(await sendRemindersNow(db, reception, { mine: [id], ipHash: "ip-d", now: at(0.1) })).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    // Another visitor is not affected, and the window slides.
    expect((await sendRemindersNow(db, reception, { mine: [id], ipHash: "ip-e", now: at(0.1) })).ok).toBe(true);
    expect((await sendRemindersNow(db, reception, { mine: [id], ipHash: "ip-d", now: at(1.1) })).ok).toBe(true);
  });
});
