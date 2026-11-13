import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { entries, patients, reminders } from "@/lib/db/schema";
import { appointmentIcs, loadAppointment, type AppointmentView } from "@/lib/booking/notify";
import { sendEmail, type EmailDeps, type EmailStatus } from "@/lib/email/send";
import { renderEmail } from "@/lib/email/templates";
import { smsText } from "./sms";
import { REMINDER_LEAD_HOURS } from "@/config/booking";

export type ReminderSource = "schedule" | "send_now";
export type ReminderRunResult = { considered: number; sms: number; emails: Record<EmailStatus, number>; skipped: number };
type RunOpts = { onlyEntryIds?: string[]; ipHash?: string; deps?: EmailDeps };
type Due = { id: string; phone: string; entrySource: "online" | "staff" | null };

const HOUR_MS = 3_600_000;

/**
 * Appointments due a reminder. Scheduled: booked, starting within the lead window, and set (booked
 * or last moved) at least the lead time before the start. Send-now (spec §4.5): only the given
 * ids, still booked and in the future; the window and the booked-late rule don't apply.
 */
async function findDue(db: Db, now: Date, onlyEntryIds?: string[]): Promise<Due[]> {
  if (onlyEntryIds && onlyEntryIds.length === 0) return [];
  const start = sql`lower(${entries.during})`;
  const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
  const rules = onlyEntryIds
    ? [inArray(entries.id, onlyEntryIds)]
    : [
        lte(start, ts(new Date(now.getTime() + REMINDER_LEAD_HOURS * HOUR_MS))),
        lte(entries.scheduledAt, sql`${start} - make_interval(hours => ${REMINDER_LEAD_HOURS})`),
      ];
  return db
    .select({ id: entries.id, phone: patients.phoneE164, entrySource: entries.source })
    .from(entries)
    .innerJoin(patients, eq(patients.id, entries.patientId))
    .where(
      and(
        eq(entries.kind, "appointment"),
        eq(entries.active, true),
        eq(entries.status, "booked"),
        sql`${start} > ${ts(now)}`,
        ...rules,
      ),
    )
    .orderBy(start);
}

/**
 * The exactly-once gate: inserts the reminder row unless one exists for this appointment, start
 * and channel. Only the pass that gets a row back may send. It runs on its own, outside any
 * transaction, so parallel passes race on the unique key itself.
 */
async function claim(db: Db, row: Omit<typeof reminders.$inferInsert, "id" | "createdAt">): Promise<string | null> {
  const [r] = await db
    .insert(reminders)
    .values(row)
    .onConflictDoNothing({ target: [reminders.entryId, reminders.channel, reminders.startsAt] })
    .returning({ id: reminders.id });
  return r?.id ?? null;
}

/** Claims and sends both channels for one appointment; true if this pass claimed anything. */
async function remindOne(
  db: Db,
  a: AppointmentView,
  d: Due,
  now: Date,
  source: ReminderSource,
  opts: RunOpts,
  out: ReminderRunResult,
): Promise<boolean> {
  const key = { entryId: a.id, startsAt: a.start, locale: a.locale, source };
  let claimed = false;

  // SMS is simulated: the claimed row is the final record of the text that would have gone out.
  const sms = smsText(a.locale, { dentistName: a.dentist.name, start: a.start }, now);
  if (await claim(db, { ...key, channel: "sms", status: "simulated", toAddress: d.phone, body: sms })) {
    claimed = true;
    out.sms += 1;
  }

  const { subject, html, text } = renderEmail("appointment_reminder", a.locale, {
    patientName: a.patient.name,
    treatmentName: a.treatment.name,
    dentistName: a.dentist.name,
    start: a.start,
    now,
  });
  // Only the address on this booking (loadAppointment never borrows another booking's address).
  const to = a.patient.email?.trim().toLowerCase() || null;
  const emailId = await claim(db, {
    ...key,
    channel: "email",
    status: to ? "pending" : "suppressed",
    toAddress: to,
    body: subject,
  });
  if (!emailId) return claimed;
  if (!to) {
    out.emails.suppressed += 1;
    return true;
  }
  // sendEmail never throws and writes the email_log row; a failure is recorded, not retried.
  const status = await sendEmail(
    db,
    {
      kind: "appointment_reminder",
      to,
      locale: a.locale,
      subject,
      html,
      text,
      // An address staff typed (a staff-created booking) keeps the staff trigger, so in demo mode it
      // is only logged: a visitor signed in as staff must not reach an inbox through a reminder.
      trigger: d.entrySource === "staff" ? "staff" : source === "send_now" ? "patient" : "system",
      ipHash: source === "send_now" ? opts.ipHash : undefined,
      appointmentId: a.id,
      attachments: [
        {
          filename: "appointment.ics",
          // Resend reads string content as base64.
          content: Buffer.from(appointmentIcs(a, a.locale, now), "utf8").toString("base64"),
        },
      ],
      now,
    },
    opts.deps,
  );
  await db.update(reminders).set({ status }).where(eq(reminders.id, emailId));
  out.emails[status] += 1;
  return true;
}

/**
 * One reminder pass at `now`: a simulated SMS and an email per due appointment and start time,
 * each at most once however many passes run. Never throws for one bad appointment.
 * `skipped` counts due appointments this pass claimed nothing for (already reminded, or errored).
 */
export async function runReminders(db: Db, now: Date, opts: RunOpts = {}): Promise<ReminderRunResult> {
  const source: ReminderSource = opts.onlyEntryIds ? "send_now" : "schedule";
  const out: ReminderRunResult = {
    considered: 0,
    sms: 0,
    emails: { sent: 0, logged: 0, suppressed: 0, capped: 0, failed: 0 },
    skipped: 0,
  };
  for (const d of await findDue(db, now, opts.onlyEntryIds)) {
    out.considered += 1;
    try {
      const a = await loadAppointment(db, { id: d.id });
      // Re-checked: it may have been cancelled or moved since the query.
      const ok = a && a.status === "booked" && a.start.getTime() > now.getTime();
      if (!ok || !(await remindOne(db, a, d, now, source, opts, out))) out.skipped += 1;
    } catch (e) {
      out.skipped += 1;
      console.error(`[reminders] ${d.id} failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }
  return out;
}
