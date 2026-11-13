import { and, desc, eq, gte, lt, ne, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { dentists, entries, patients, reminders } from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/roles";
import { BookingError } from "@/lib/booking/errors";
import { isDemo } from "@/lib/demo/mode";
import { maskEmail, maskPhone } from "@/lib/demo/mask";
import { addDays, atIstanbul } from "@/lib/time";

export type ReminderRow = {
  id: string;
  createdAt: Date;
  channel: "email" | "sms";
  status: string;
  patientName: string;
  contact: string | null;
  body: string;
  appointment: { id: string; start: Date; dentistName: string };
};

export type ReminderChannelFilter = "all" | "email" | "sms";
export const REMINDER_LOG_LIMIT = 100;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: string) => DATE.test(d) && !Number.isNaN(atIstanbul(d, "00:00").getTime());

/**
 * The reminders log (spec §5): finished reminders created between two Istanbul dates (inclusive),
 * newest first, at most REMINDER_LOG_LIMIT. Receptionist and admin only. `pending` rows (an email
 * claimed but not yet, or never, sent) are left out. In the public demo another visitor's phone or
 * email is masked here, so the raw value never reaches the page; the visitor's own bookings
 * (`mine`, the signed demo_mine cookie) and staff-created ones are shown, as on the calendar.
 */
export async function listReminders(
  db: DbOrTx,
  actor: Actor,
  q: { from: string; to: string; channel: ReminderChannelFilter; mine: string[] },
): Promise<ReminderRow[]> {
  if (!can(actor, "reminders.view")) throw new BookingError("forbidden");
  if (!validDate(q.from) || !validDate(q.to)) throw new BookingError("invalid");

  const where: (SQL | undefined)[] = [
    ne(reminders.status, "pending"),
    gte(reminders.createdAt, atIstanbul(q.from, "00:00")),
    lt(reminders.createdAt, atIstanbul(addDays(q.to, 1), "00:00")),
    q.channel === "all" ? undefined : eq(reminders.channel, q.channel),
  ];
  const rows = await db
    .select({
      id: reminders.id,
      createdAt: reminders.createdAt,
      channel: reminders.channel,
      status: reminders.status,
      toAddress: reminders.toAddress,
      body: reminders.body,
      patientName: sql<string>`coalesce(${entries.contactName}, ${patients.name})`,
      entryId: entries.id,
      entrySource: entries.source,
      startsAt: reminders.startsAt,
      dentistName: dentists.name,
    })
    .from(reminders)
    .innerJoin(entries, eq(entries.id, reminders.entryId))
    .innerJoin(dentists, eq(dentists.id, entries.dentistId))
    .leftJoin(patients, eq(patients.id, entries.patientId))
    .where(and(...where))
    .orderBy(desc(reminders.createdAt), desc(reminders.id))
    .limit(REMINDER_LOG_LIMIT);

  const demo = isDemo();
  const mine = new Set(q.mine);
  return rows.map((r) => {
    const masked = demo && r.entrySource === "online" && !mine.has(r.entryId);
    const contact = r.toAddress && masked ? (r.channel === "sms" ? maskPhone(r.toAddress) : maskEmail(r.toAddress)) : r.toAddress;
    return {
      id: r.id,
      createdAt: r.createdAt,
      channel: r.channel,
      status: r.status,
      patientName: r.patientName,
      contact,
      body: r.body,
      // The start the reminder was for: the appointment may have moved since.
      appointment: { id: r.entryId, start: r.startsAt, dentistName: r.dentistName },
    };
  });
}
