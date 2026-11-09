import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/lib/db/client";
import { dentistTreatments, entries, treatments } from "@/lib/db/schema";
import type { Actor } from "@/lib/auth/roles";
import { can } from "@/lib/auth/permissions";
import { assertBookableOrTaken } from "@/lib/booking/availability";
import { insertEntry, lockDentists, updateEntryRange } from "@/lib/booking/entries";
import { BookingError } from "@/lib/booking/errors";
import { notifyPatient } from "@/lib/booking/notify";
import { normalizePhone, upsertPatient } from "@/lib/booking/patients";
import { guardCapacity } from "@/lib/demo/floor";
import { hashToken, newToken } from "@/lib/security/tokens";
import { routing, type Locale } from "@/i18n/routing";

const MIN = 60_000;

export type StaffStatus = "booked" | "arrived" | "completed" | "no_show";

/**
 * Allowed status changes (cancelling goes through cancelByStaff). booked → arrived → completed,
 * booked → no_show, and arrived/no_show back to booked to undo a mis-tap. Completed and
 * cancelled are final.
 */
const TRANSITIONS: Record<string, StaffStatus[]> = {
  booked: ["arrived", "no_show"],
  arrived: ["completed", "booked"],
  no_show: ["booked"],
  completed: [],
  cancelled: [],
};

type Row = typeof entries.$inferSelect;

/** The entry's current dentist, read without any lock (rule 1: dentist locks come first). */
async function peekDentist(tx: DbOrTx, id: string): Promise<number | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [r] = await tx.select({ dentistId: entries.dentistId }).from(entries).where(eq(entries.id, id));
  return r?.dentistId ?? null;
}

/**
 * Locks `dentistIds` (which must include the entry's dentist as peeked), then the row. If the
 * entry moved to another dentist in between, the lock we hold is the wrong one: report a conflict.
 */
async function lockAppointment(tx: DbOrTx, id: string, peeked: number, dentistIds: number[]): Promise<Row> {
  await lockDentists(tx, dentistIds);
  const [row] = await tx.select().from(entries).where(eq(entries.id, id)).for("update");
  if (!row || row.kind !== "appointment") throw new BookingError("not_found");
  if (row.dentistId !== peeked) throw new BookingError("slot_taken");
  return row;
}

/**
 * Moves an appointment to `newStart`, optionally to another dentist, under staff booking rules.
 * A dentist may only move their own appointments, and only within their own calendar.
 */
export async function moveAppointment(
  db: Db,
  actor: Actor,
  q: { appointmentId: string; newStart: Date; newDentistId?: number; now: Date },
): Promise<void> {
  await db.transaction((tx) =>
    guardCapacity(tx, q.now, async () => {
      const cur = await peekDentist(tx, q.appointmentId);
      if (cur === null) throw new BookingError("not_found");
      const target = q.newDentistId ?? cur;
      if (!can(actor, "appointment.manage", { dentistId: cur }) || !can(actor, "appointment.manage", { dentistId: target })) {
        throw new BookingError("forbidden");
      }
      const row = await lockAppointment(tx, q.appointmentId, cur, [cur, target]);
      if (!row.active || row.status !== "booked" || row.treatmentId === null) throw new BookingError("invalid");

      const [t] = await tx
        .select({ durationMin: treatments.durationMin })
        .from(treatments)
        .innerJoin(
          dentistTreatments,
          and(eq(dentistTreatments.treatmentId, treatments.id), eq(dentistTreatments.dentistId, target)),
        )
        .where(eq(treatments.id, row.treatmentId));
      if (!t) throw new BookingError("outside_rules");

      const range = { start: q.newStart, end: new Date(q.newStart.getTime() + t.durationMin * MIN) };
      await assertBookableOrTaken(tx, {
        treatmentId: row.treatmentId,
        dentistId: target,
        start: q.newStart,
        end: range.end,
        now: q.now,
        audience: "staff",
        ignoreEntryId: row.id,
      });
      await updateEntryRange(tx, row.id, target, range, q.now);
    }),
  );
  // After commit: no email while a dentist lock is held (rule 3).
  await notifyPatient(db, "booking_rescheduled", q.appointmentId, { trigger: "staff", now: q.now });
}

/** Cancels a booked appointment as staff. Repeating it on a cancelled one is a no-op. */
export async function cancelByStaff(db: Db, actor: Actor, q: { appointmentId: string; now: Date }): Promise<void> {
  const changed = await db.transaction(async (tx) => {
    const cur = await peekDentist(tx, q.appointmentId);
    if (cur === null) throw new BookingError("not_found");
    if (!can(actor, "appointment.manage", { dentistId: cur })) throw new BookingError("forbidden");
    const row = await lockAppointment(tx, q.appointmentId, cur, [cur]);
    if (row.status === "cancelled") return false;
    if (row.status !== "booked") throw new BookingError("invalid");
    await tx
      .update(entries)
      .set({ status: "cancelled", active: false, cancelledBy: "staff", updatedAt: q.now })
      .where(eq(entries.id, row.id));
    return true;
  });
  if (changed) await notifyPatient(db, "booking_cancelled", q.appointmentId, { trigger: "staff", now: q.now });
}

/** Arrived / completed / no-show (and undo back to booked); see TRANSITIONS. */
export async function setStatus(
  db: Db,
  actor: Actor,
  q: { appointmentId: string; status: StaffStatus },
): Promise<void> {
  await db.transaction(async (tx) => {
    const cur = await peekDentist(tx, q.appointmentId);
    if (cur === null) throw new BookingError("not_found");
    if (!can(actor, "appointment.status", { dentistId: cur })) throw new BookingError("forbidden");
    const row = await lockAppointment(tx, q.appointmentId, cur, [cur]);
    const from = row.status ?? "booked";
    if (from === q.status) return;
    if (!row.active || !TRANSITIONS[from]?.includes(q.status)) throw new BookingError("invalid");
    await tx.update(entries).set({ status: q.status, updatedAt: new Date() }).where(eq(entries.id, row.id));
  });
}

const staffPatientSchema = z.object({
  // CR/LF and runs of whitespace collapse to one space; Turkish letters are kept as typed.
  name: z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(2, "name").max(80, "name")),
  phone: z
    .string()
    .trim()
    .max(40, "phone")
    .refine((v) => normalizePhone(v) !== null, "phone"),
  email: z
    .string()
    .trim()
    .max(254, "email")
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.email("email").nullable()),
  locale: z.enum(routing.locales),
});

/**
 * A staff-created appointment or walk-in (staff rules: from an hour ago, up to a year ahead).
 * With an email, the patient gets a confirmation and manage link (logged instead in demo mode).
 */
export async function createStaffAppointment(
  db: Db,
  actor: Actor,
  q: {
    treatmentId: number;
    dentistId: number;
    start: Date;
    patient: { name: string; phone: string; email?: string | null; locale: Locale };
    now: Date;
  },
): Promise<{ appointmentId: string }> {
  if (!can(actor, "appointment.manage", { dentistId: q.dentistId })) throw new BookingError("forbidden");
  const parsed = staffPatientSchema.safeParse(q.patient);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    throw new BookingError("invalid", { fieldErrors });
  }
  const patient = parsed.data;
  const manageToken = patient.email ? newToken() : undefined;

  const appointmentId = await db.transaction((tx) =>
    guardCapacity(tx, q.now, async () => {
      await lockDentists(tx, [q.dentistId]);
      const [t] = await tx
        .select({ durationMin: treatments.durationMin })
        .from(treatments)
        .where(and(eq(treatments.id, q.treatmentId), eq(treatments.active, true)));
      if (!t) throw new BookingError("not_found");
      const range = { start: q.start, end: new Date(q.start.getTime() + t.durationMin * MIN) };
      await assertBookableOrTaken(tx, {
        treatmentId: q.treatmentId,
        dentistId: q.dentistId,
        start: q.start,
        end: range.end,
        now: q.now,
        audience: "staff",
      });
      const patientId = await upsertPatient(tx, patient);
      return insertEntry(
        tx,
        {
          dentistId: q.dentistId,
          kind: "appointment",
          during: range,
          treatmentId: q.treatmentId,
          patientId,
          contactName: patient.name,
          contactEmail: patient.email,
          contactLocale: patient.locale,
          status: "booked",
          source: "staff",
          manageTokenHash: manageToken ? hashToken(manageToken) : null,
          createdBy: actor.userId,
          updatedAt: q.now,
        },
        q.now,
      );
    }),
  );
  if (manageToken) {
    await notifyPatient(db, "booking_confirmation", appointmentId, { trigger: "staff", manageToken, now: q.now });
  }
  return { appointmentId };
}
