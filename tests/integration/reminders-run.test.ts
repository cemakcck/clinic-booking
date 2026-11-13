import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import { emailLog, entries, patients, reminders } from "@/lib/db/schema";
import type { Actor } from "@/lib/auth/roles";
import { moveAppointment } from "@/lib/staff/appointments";
import { runReminders } from "@/lib/reminders/run";
import { EMAIL_CAP_PER_IP_PER_DAY } from "@/config/booking";

const db = testDb();
const now = new Date(NOW_ISO); // Tue 2026-11-10 08:00 Istanbul
const H = 3_600_000;
const at = (hours: number) => new Date(now.getTime() + hours * H);
let fx: Fixture;
let phoneSeq = 0;

const reception: Actor = { userId: "u-rec", name: "Rec", role: "receptionist", dentistId: null };

const fakeResend = () => ({ send: vi.fn(async (...args: unknown[]) => ({ id: "re_1", n: args.length })) });

type ApptOpts = {
  start: Date;
  minutes?: number;
  scheduledAt?: Date;
  status?: "booked" | "arrived" | "completed" | "no_show" | "cancelled";
  dentistId?: number;
  /** Booking-level contact; `null` email means the visitor typed none. */
  contact?: { name: string; email: string | null; locale: "en" | "tr" } | null;
  patientEmail?: string | null;
  patientLocale?: "en" | "tr";
  source?: "online" | "staff";
};

async function appt(o: ApptOpts): Promise<string> {
  phoneSeq += 1;
  const phone = `+90532111${String(phoneSeq).padStart(4, "0")}`;
  const [p] = await db
    .insert(patients)
    .values({
      name: "Seed Patient",
      phoneE164: phone,
      email: o.patientEmail === undefined ? "seed@example.com" : o.patientEmail,
      locale: o.patientLocale ?? "en",
    })
    .returning({ id: patients.id });
  const contact =
    o.contact === undefined ? { name: "Ayşe Yılmaz", email: "ayse@mail.test", locale: "en" as const } : o.contact;
  const status = o.status ?? "booked";
  const [r] = await db
    .insert(entries)
    .values({
      dentistId: o.dentistId ?? fx.dentists.ayd,
      kind: "appointment",
      during: { start: o.start, end: new Date(o.start.getTime() + (o.minutes ?? 30) * 60_000) },
      treatmentId: fx.treatments.checkup,
      patientId: p.id,
      status,
      active: status !== "cancelled",
      source: o.source ?? "online",
      contactName: contact?.name ?? null,
      contactEmail: contact?.email ?? null,
      contactLocale: contact?.locale ?? null,
      scheduledAt: o.scheduledAt ?? at(-72),
    })
    .returning({ id: entries.id });
  return r.id;
}

const reminderRows = (entryId?: string) =>
  db
    .select()
    .from(reminders)
    .where(entryId ? eq(reminders.entryId, entryId) : undefined)
    .orderBy(asc(reminders.startsAt), asc(reminders.channel));
const reminderEmails = () => db.select().from(emailLog).where(eq(emailLog.kind, "appointment_reminder"));

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

describe("runReminders (schedule)", () => {
  it("sends one SMS and one email for an appointment 23h ahead booked 3 days ago", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    const resend = fakeResend();
    const id = await appt({ start: at(23), scheduledAt: at(-72) });

    const res = await runReminders(db, now, { deps: { resend } });

    expect(res.considered).toBe(1);
    expect(res.sms).toBe(1);
    expect(res.emails.sent).toBe(1);
    expect(resend.send).toHaveBeenCalledTimes(1);
    const sent = resend.send.mock.calls[0][0] as {
      to: string;
      subject: string;
      attachments: { filename: string; content: string }[];
    };
    expect(sent.to).toBe("ayse@mail.test");
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].filename).toBe("appointment.ics");
    expect(Buffer.from(sent.attachments[0].content, "base64").toString("utf8")).toContain("BEGIN:VCALENDAR");

    const rows = await reminderRows(id);
    expect(rows).toHaveLength(2);
    const email = rows.find((r) => r.channel === "email")!;
    const sms = rows.find((r) => r.channel === "sms")!;
    expect(email).toMatchObject({ status: "sent", toAddress: "ayse@mail.test", locale: "en", source: "schedule" });
    expect(email.body).toBe(sent.subject);
    expect(email.startsAt).toEqual(at(23));
    expect(sms).toMatchObject({ status: "simulated", locale: "en", source: "schedule" });
    expect(sms.toAddress).toMatch(/^\+90532111\d{4}$/);
    expect(sms.body).toContain("Dr. Ayd");
    expect(sms.body.length).toBeLessThan(160);

    const logs = await reminderEmails();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: "sent", trigger: "system", appointmentId: id, ipHash: null });
  });

  it("skips an appointment 25h ahead", async () => {
    const id = await appt({ start: at(25) });
    const res = await runReminders(db, now);
    expect(res.considered).toBe(0);
    expect(await reminderRows(id)).toHaveLength(0);
  });

  it("skips one starting now or in the past", async () => {
    await appt({ start: now });
    await appt({ start: at(-2), dentistId: fx.dentists.kay });
    const res = await runReminders(db, now);
    expect(res.considered).toBe(0);
    expect(await reminderRows()).toHaveLength(0);
  });

  it("skips one booked 20h before its start (booked late)", async () => {
    const start = at(10);
    await appt({ start, scheduledAt: new Date(start.getTime() - 20 * H) });
    const res = await runReminders(db, now);
    expect(res.considered).toBe(0);
    expect(await reminderRows()).toHaveLength(0);
  });

  it("skips cancelled, arrived, no-show and holds/blocks", async () => {
    await appt({ start: at(2), status: "cancelled" });
    await appt({ start: at(3), status: "arrived" });
    await appt({ start: at(4), status: "no_show" });
    await db.insert(entries).values({
      dentistId: fx.dentists.kay,
      kind: "hold",
      during: { start: at(5), end: at(5.5) },
      expiresAt: at(1),
      holdTokenHash: "h",
      treatmentId: fx.treatments.checkup,
      scheduledAt: at(-72),
    });
    await db.insert(entries).values({
      dentistId: fx.dentists.kay,
      kind: "block",
      during: { start: at(6), end: at(7) },
      blockReason: "meeting",
      scheduledAt: at(-72),
    });
    const res = await runReminders(db, now);
    expect(res.considered).toBe(0);
    expect(await reminderRows()).toHaveLength(0);
  });

  it("a second pass sends nothing more", async () => {
    const id = await appt({ start: at(23) });
    await runReminders(db, now);
    const second = await runReminders(db, at(0.25));
    expect(second.sms).toBe(0);
    expect(Object.values(second.emails).reduce((a, b) => a + b, 0)).toBe(0);
    expect(second.skipped).toBe(1);
    expect(await reminderRows(id)).toHaveLength(2);
    expect(await reminderEmails()).toHaveLength(1);
  });

  it("parallel passes claim once", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    const resend = fakeResend();
    const id = await appt({ start: at(23) });
    const results = await Promise.all(Array.from({ length: 5 }, () => runReminders(db, now, { deps: { resend } })));

    expect(results.reduce((n, r) => n + r.sms, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.emails.sent, 0)).toBe(1);
    const rows = await reminderRows(id);
    expect(rows.filter((r) => r.channel === "sms")).toHaveLength(1);
    expect(rows.filter((r) => r.channel === "email")).toHaveLength(1);
    expect(await reminderEmails()).toHaveLength(1);
    expect(resend.send).toHaveBeenCalledTimes(1);
  });

  it("moved after its reminder: the new start gets a new reminder", async () => {
    const D = "2026-11-11"; // Wed
    const id = await appt({ start: T(D, "11:00"), scheduledAt: at(-72) });
    // Tue 12:00: 23h before Wed 11:00.
    await runReminders(db, T("2026-11-10", "12:00"));
    expect(await reminderRows(id)).toHaveLength(2);

    // Tue 13:00: moved to Thu 10:00 (45h ahead, so not booked late).
    await moveAppointment(db, reception, { appointmentId: id, newStart: T("2026-11-12", "10:00"), now: T("2026-11-10", "13:00") });
    // Wed 11:00: 23h before Thu 10:00.
    const res = await runReminders(db, T(D, "11:00"));
    expect(res.sms).toBe(1);

    const rows = await reminderRows(id);
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.startsAt.getTime() === T(D, "11:00").getTime())).toHaveLength(2);
    expect(rows.filter((r) => r.startsAt.getTime() === T("2026-11-12", "10:00").getTime())).toHaveLength(2);
  });

  it("moved to within 24h of its start: no reminder (scheduledAt reset)", async () => {
    const id = await appt({ start: T("2026-11-12", "10:00"), scheduledAt: at(-72) });
    // Tue 11:00: moved to Wed 10:00, 23h ahead.
    await moveAppointment(db, reception, { appointmentId: id, newStart: T("2026-11-11", "10:00"), now: T("2026-11-10", "11:00") });
    const res = await runReminders(db, T("2026-11-10", "11:30"));
    expect(res.considered).toBe(0);
    expect(await reminderRows(id)).toHaveLength(0);
  });

  it("a pass that runs hours late still sends", async () => {
    const id = await appt({ start: at(2), scheduledAt: at(-24 * 7) });
    const res = await runReminders(db, now);
    expect(res.sms).toBe(1);
    expect(await reminderRows(id)).toHaveLength(2);
  });

  it("seeded @example.com patient: SMS simulated, email suppressed, nothing sent", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    const resend = fakeResend();
    const id = await appt({ start: at(23), contact: null, patientEmail: "zeynep@example.com", patientLocale: "tr" });
    const res = await runReminders(db, now, { deps: { resend } });
    expect(res.sms).toBe(1);
    expect(res.emails.suppressed).toBe(1);
    expect(resend.send).not.toHaveBeenCalled();
    const rows = await reminderRows(id);
    expect(rows.find((r) => r.channel === "sms")).toMatchObject({ status: "simulated", locale: "tr" });
    expect(rows.find((r) => r.channel === "email")).toMatchObject({ status: "suppressed", locale: "tr" });
  });

  it("no email on the booking: SMS only, email row suppressed", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    const resend = fakeResend();
    // The shared patient row has an address typed for another booking; it must not be used.
    const id = await appt({
      start: at(23),
      contact: { name: "Walk In", email: null, locale: "en" },
      patientEmail: "someone-else@mail.test",
    });
    const res = await runReminders(db, now, { deps: { resend } });
    expect(res.sms).toBe(1);
    expect(res.emails.suppressed).toBe(1);
    expect(resend.send).not.toHaveBeenCalled();
    const rows = await reminderRows(id);
    expect(rows.find((r) => r.channel === "email")).toMatchObject({ status: "suppressed", toAddress: null });
    expect(await reminderEmails()).toHaveLength(0);
  });

  it("in demo mode a scheduled reminder to a visitor-typed address is sent, not logged", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("RESEND_API_KEY", "k");
    const resend = fakeResend();
    const id = await appt({ start: at(23) });
    const res = await runReminders(db, now, { deps: { resend } });
    expect(res.emails.sent).toBe(1);
    expect(resend.send).toHaveBeenCalledTimes(1);
    const rows = await reminderRows(id);
    expect(rows.find((r) => r.channel === "email")!.status).toBe("sent");
    const [log] = await reminderEmails();
    expect(log).toMatchObject({ status: "sent", trigger: "system" });
  });

  it("in demo mode a reminder for a staff-created booking is logged, not sent", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("RESEND_API_KEY", "k");
    const resend = fakeResend();
    const id = await appt({ start: at(23), source: "staff" });
    const res = await runReminders(db, now, { deps: { resend } });
    expect(res.emails.logged).toBe(1);
    expect(resend.send).not.toHaveBeenCalled();
    const rows = await reminderRows(id);
    expect(rows.find((r) => r.channel === "email")!.status).toBe("logged");
    const [log] = await reminderEmails();
    expect(log).toMatchObject({ status: "logged", trigger: "staff" });
  });
});

describe("runReminders (send_now)", () => {
  it("send_now ignores window and booked-late but not status or past starts", async () => {
    const far = await appt({ start: at(50), scheduledAt: at(-1) }); // outside window
    const late = await appt({ start: at(3), scheduledAt: at(-1), dentistId: fx.dentists.kay }); // booked late
    const cancelled = await appt({ start: at(5), status: "cancelled" });
    const arrived = await appt({ start: at(6), status: "arrived" });
    const past = await appt({ start: at(-1), dentistId: fx.dentists.kay });
    const due = await appt({ start: at(10), scheduledAt: at(-72) }); // would be due on schedule too
    const notMine = await appt({ start: at(20), dentistId: fx.dentists.kay });

    const res = await runReminders(db, now, {
      onlyEntryIds: [far, late, cancelled, arrived, past, due],
      ipHash: "ip-v",
    });
    expect(res.considered).toBe(3);
    expect(res.sms).toBe(3);

    const rows = await reminderRows();
    expect(new Set(rows.map((r) => r.entryId))).toEqual(new Set([far, late, due]));
    expect(rows.every((r) => r.source === "send_now")).toBe(true);
    expect(await reminderRows(notMine)).toHaveLength(0);

    // A reminder sent this way counts: the scheduled pass reminds only `notMine`.
    const sched = await runReminders(db, at(0.5));
    expect(sched.sms).toBe(1);
    expect(sched.skipped).toBe(1);
    expect(await reminderRows(due)).toHaveLength(2);
    expect(await reminderRows(notMine)).toHaveLength(2);

    // An empty list reminds nobody (not everyone).
    const none = await runReminders(db, now, { onlyEntryIds: [] });
    expect(none.considered).toBe(0);
  });

  it("send_now passes the visitor ipHash so the per-IP cap applies", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    const resend = fakeResend();
    await db.insert(emailLog).values(
      Array.from({ length: EMAIL_CAP_PER_IP_PER_DAY }, (_, i) => ({
        kind: "booking_confirmation",
        toAddress: `v${i}@mail.test`,
        locale: "en",
        subject: "s",
        status: "sent" as const,
        trigger: "patient" as const,
        ipHash: "ip-v",
        createdAt: at(-1),
      })),
    );
    const id = await appt({ start: at(30), scheduledAt: at(-1) });
    const res = await runReminders(db, now, { onlyEntryIds: [id], ipHash: "ip-v", deps: { resend } });
    expect(res.emails.capped).toBe(1);
    expect(resend.send).not.toHaveBeenCalled();
    const rows = await reminderRows(id);
    expect(rows.find((r) => r.channel === "email")!.status).toBe("capped");
    const [log] = await db
      .select()
      .from(emailLog)
      .where(and(eq(emailLog.kind, "appointment_reminder"), eq(emailLog.appointmentId, id)));
    expect(log).toMatchObject({ status: "capped", trigger: "patient", ipHash: "ip-v" });
  });
});
