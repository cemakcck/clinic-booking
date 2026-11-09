"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { entries } from "@/lib/db/schema";
import { requireActor } from "@/lib/auth/actor";
import { can, type Action } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/roles";
import { getDaySlots } from "@/lib/booking/availability";
import { BookingError, type BookingErrorCode } from "@/lib/booking/errors";
import { cancelByStaff, createStaffAppointment, moveAppointment, setStatus } from "@/lib/staff/appointments";
import { createBlock, deleteBlock, updateBlock, type BlockReason } from "@/lib/staff/blocks";
import { atIstanbul, istanbulTimeOf } from "@/lib/time";
import { blockReason } from "@/lib/db/schema";

export type ActionResult = { ok: true } | { ok: false; code: BookingErrorCode; details?: unknown };
export type SlotsResult = { ok: true; slots: string[] } | { ok: false; code: BookingErrorCode };

const fail = (code: BookingErrorCode, details?: unknown) => ({ ok: false as const, code, details });

/** Known booking errors become a result; anything else (including redirects) is rethrown. */
function toFail(e: unknown) {
  if (e instanceof BookingError) return fail(e.code, e.details);
  throw e;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ID = z.uuid();
const DENTIST = z.coerce.number().int().positive();

/**
 * Every action authenticates itself (layout auth can be skipped via RSC requests) and checks
 * `can` before touching the domain, which checks again inside its transaction.
 */
async function authorize(action: Action, dentistId?: number | null): Promise<Actor> {
  const actor = await requireActor();
  if (!can(actor, "calendar.viewAll")) throw new BookingError("forbidden");
  if (dentistId !== undefined && !can(actor, action, { dentistId: dentistId ?? undefined })) {
    throw new BookingError("forbidden");
  }
  return actor;
}

async function entryDentist(id: string): Promise<number | null> {
  const [r] = await (await db()).select({ d: entries.dentistId }).from(entries).where(eq(entries.id, id));
  return r?.d ?? null;
}

async function guarded(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    return toFail(e);
  }
}

const moveSchema = z.object({ appointmentId: ID, date: DATE, time: TIME, dentistId: DENTIST.optional() });

/** Drag-and-drop and the dialog's reschedule form: a new clinic date/time, maybe another dentist. */
export async function move(input: z.input<typeof moveSchema>): Promise<ActionResult> {
  const p = moveSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  return guarded(async () => {
    const actor = await authorize("appointment.manage", await entryDentist(p.data.appointmentId));
    if (p.data.dentistId !== undefined && !can(actor, "appointment.manage", { dentistId: p.data.dentistId })) {
      throw new BookingError("forbidden");
    }
    await moveAppointment(await db(), actor, {
      appointmentId: p.data.appointmentId,
      newStart: atIstanbul(p.data.date, p.data.time),
      newDentistId: p.data.dentistId,
      now: new Date(),
    });
  });
}

export async function cancel(input: { appointmentId: string }): Promise<ActionResult> {
  const p = z.object({ appointmentId: ID }).safeParse(input);
  if (!p.success) return fail("invalid");
  return guarded(async () => {
    const actor = await authorize("appointment.manage", await entryDentist(p.data.appointmentId));
    await cancelByStaff(await db(), actor, { appointmentId: p.data.appointmentId, now: new Date() });
  });
}

const statusSchema = z.object({ appointmentId: ID, status: z.enum(["booked", "arrived", "completed", "no_show"]) });

export async function setStatusAction(input: z.input<typeof statusSchema>): Promise<ActionResult> {
  const p = statusSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  return guarded(async () => {
    const actor = await authorize("appointment.status", await entryDentist(p.data.appointmentId));
    await setStatus(await db(), actor, p.data);
  });
}

const createSchema = z.object({
  treatmentId: z.coerce.number().int().positive(),
  dentistId: DENTIST,
  date: DATE,
  time: TIME,
  name: z.string().max(200),
  phone: z.string().max(60),
  email: z.string().max(300).optional(),
  locale: z.enum(["en", "tr"]),
});

export async function createAppointment(input: z.input<typeof createSchema>): Promise<ActionResult> {
  const p = createSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const q = p.data;
  return guarded(async () => {
    const actor = await authorize("appointment.manage", q.dentistId);
    await createStaffAppointment(await db(), actor, {
      treatmentId: q.treatmentId,
      dentistId: q.dentistId,
      start: atIstanbul(q.date, q.time),
      patient: { name: q.name, phone: q.phone, email: q.email || null, locale: q.locale },
      now: new Date(),
    });
  });
}

const blockFields = {
  startDate: DATE,
  startTime: TIME,
  endDate: DATE,
  // "24:00" is not a valid TIME; an all-day block ends at 00:00 of the next day instead.
  endTime: TIME,
  reason: z.enum(blockReason.enumValues as [BlockReason, ...BlockReason[]]),
  note: z.string().max(500).optional(),
};

const createBlockSchema = z.object({
  dentistId: DENTIST,
  ...blockFields,
  repeat: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({ mode: z.literal("count"), count: z.coerce.number().int().min(1).max(52) }),
      z.object({ mode: z.literal("until"), until: DATE }),
    ])
    .default({ mode: "none" }),
});

export async function createBlockAction(input: z.input<typeof createBlockSchema>): Promise<ActionResult> {
  const p = createBlockSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const q = p.data;
  return guarded(async () => {
    const actor = await authorize("block.manage", q.dentistId);
    await createBlock(await db(), actor, {
      dentistId: q.dentistId,
      start: atIstanbul(q.startDate, q.startTime),
      end: atIstanbul(q.endDate, q.endTime),
      reason: q.reason,
      note: q.note,
      repeatWeekly:
        q.repeat.mode === "count" ? { count: q.repeat.count } : q.repeat.mode === "until" ? { until: q.repeat.until } : undefined,
      now: new Date(),
    });
  });
}

const updateBlockSchema = z.object({ entryId: ID, ...blockFields });

export async function updateBlockAction(input: z.input<typeof updateBlockSchema>): Promise<ActionResult> {
  const p = updateBlockSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const q = p.data;
  return guarded(async () => {
    const actor = await authorize("block.manage", await entryDentist(q.entryId));
    await updateBlock(await db(), actor, {
      entryId: q.entryId,
      start: atIstanbul(q.startDate, q.startTime),
      end: atIstanbul(q.endDate, q.endTime),
      reason: q.reason,
      note: q.note,
      now: new Date(),
    });
  });
}

export async function deleteBlockAction(input: { entryId: string; wholeSeries?: boolean }): Promise<ActionResult> {
  const p = z.object({ entryId: ID, wholeSeries: z.boolean().optional() }).safeParse(input);
  if (!p.success) return fail("invalid");
  return guarded(async () => {
    const actor = await authorize("block.manage", await entryDentist(p.data.entryId));
    await deleteBlock(await db(), actor, p.data);
  });
}

const slotsSchema = z.object({ treatmentId: z.coerce.number().int().positive(), dentistId: DENTIST, date: DATE, appointmentId: ID.optional() });

/** Free start times ("HH:MM", clinic time) under staff rules; the appointment's own time counts as free. */
export async function loadStaffSlots(input: z.input<typeof slotsSchema>): Promise<SlotsResult> {
  const p = slotsSchema.safeParse(input);
  if (!p.success) return { ok: false, code: "invalid" };
  try {
    await authorize("calendar.viewAll");
    const slots = await getDaySlots(await db(), {
      treatmentId: p.data.treatmentId,
      dentistId: p.data.dentistId,
      date: p.data.date,
      now: new Date(),
      audience: "staff",
      ignoreEntryId: p.data.appointmentId,
    });
    return { ok: true, slots: slots.map((s) => istanbulTimeOf(s.start)) };
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, code: e.code };
    throw e;
  }
}
