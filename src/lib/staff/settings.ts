import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/lib/db/client";
import {
  clinicHours,
  clinicSettings,
  closedDates,
  dentists,
  dentistTreatments,
  entries,
  patients,
  treatments,
  workingHours,
} from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/roles";
import { BookingError } from "@/lib/booking/errors";
import { isDemo } from "@/lib/demo/mode";
import { lockDentists } from "@/lib/booking/entries";

/** Field errors travel as `BookingError("invalid", { fields })`; values are `staff.settings.errors` keys. */
export type FieldErrors = Record<string, string>;

const viewGuard = (actor: Actor) => {
  if (!can(actor, "settings.view")) throw new BookingError("forbidden");
};
/** Order matters: who you are first, then the demo guard, then the input. */
const editGuard = (actor: Actor) => {
  if (!can(actor, "settings.edit")) throw new BookingError("forbidden");
  if (isDemo()) throw new BookingError("demo_disabled");
};

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time");
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug").max(60, "slug");
const sortOrder = z.number().int("sortOrder").min(0, "sortOrder").max(999, "sortOrder");
const weekday = z.number().int("weekday").min(0, "weekday").max(6, "weekday");
const text = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max, msg);

const DentistInput = z.object({
  id: z.number().int().positive().optional(),
  slug,
  name: text(2, 80, "name"),
  titleEn: text(1, 80, "title"),
  titleTr: text(1, 80, "title"),
  bioEn: text(0, 1000, "bio"),
  bioTr: text(0, 1000, "bio"),
  sortOrder,
  active: z.boolean(),
  treatmentIds: z.array(z.number().int().positive()).max(200),
  hours: z
    .array(z.object({ weekday, start: time, end: time }))
    .max(7)
    .superRefine((hs, ctx) => {
      hs.forEach((h, i) => {
        if (h.start >= h.end) ctx.addIssue({ code: "custom", path: [i, "end"], message: "range" });
        if (hs.findIndex((x) => x.weekday === h.weekday) !== i)
          ctx.addIssue({ code: "custom", path: [i, "weekday"], message: "weekday" });
      });
    }),
});
export type DentistInput = z.input<typeof DentistInput>;

const TreatmentInput = z.object({
  id: z.number().int().positive().optional(),
  slug,
  nameEn: text(2, 80, "name"),
  nameTr: text(2, 80, "name"),
  descEn: text(0, 1000, "desc"),
  descTr: text(0, 1000, "desc"),
  durationMin: z
    .number("duration")
    .int("duration")
    .min(15, "duration")
    .max(240, "duration")
    .refine((n) => n % 15 === 0, "duration"),
  sortOrder,
  active: z.boolean(),
});
export type TreatmentInput = z.input<typeof TreatmentInput>;

// Lunch must sit in a sensible part of the day and be at most three hours.
const LUNCH_EARLIEST = "10:00";
const LUNCH_LATEST = "16:00";
const ClinicHoursInput = z
  .object({
    days: z
      .array(z.object({ weekday, open: time.nullable(), close: time.nullable() }))
      .length(7, "days"),
    lunchStart: time,
    lunchEnd: time,
  })
  .superRefine((v, ctx) => {
    v.days.forEach((d, i) => {
      if (v.days.findIndex((x) => x.weekday === d.weekday) !== i)
        ctx.addIssue({ code: "custom", path: ["days", i, "weekday"], message: "weekday" });
      if ((d.open === null) !== (d.close === null)) {
        ctx.addIssue({ code: "custom", path: ["days", i, d.open === null ? "open" : "close"], message: "bothOrNeither" });
      } else if (d.open !== null && d.close !== null && d.open >= d.close) {
        ctx.addIssue({ code: "custom", path: ["days", i, "close"], message: "range" });
      }
    });
    if (v.lunchStart >= v.lunchEnd) ctx.addIssue({ code: "custom", path: ["lunchEnd"], message: "range" });
    else if (v.lunchStart < LUNCH_EARLIEST || v.lunchEnd > LUNCH_LATEST)
      ctx.addIssue({ code: "custom", path: ["lunchStart"], message: "lunchRange" });
    else if (minutes(v.lunchEnd) - minutes(v.lunchStart) > 180)
      ctx.addIssue({ code: "custom", path: ["lunchEnd"], message: "lunchRange" });
  });
export type ClinicHoursInput = z.input<typeof ClinicHoursInput>;

const ClosedDateInput = z.object({
  date: z.string().refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "date"),
  labelEn: text(1, 80, "label"),
  labelTr: text(1, 80, "label"),
});

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Throws `invalid` with field errors keyed by Zod path (e.g. `days.3.close`). */
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fields: FieldErrors = {};
  for (const issue of r.error.issues) {
    const name = issue.path.join(".") || "form";
    fields[name] ??= issue.message in MESSAGE_KEYS ? issue.message : "invalid";
  }
  throw new BookingError("invalid", { fields });
}
// Zod's built-in messages ("Invalid input: ...") fall back to the generic "invalid" key.
const MESSAGE_KEYS: Record<string, true> = {
  time: true, slug: true, sortOrder: true, weekday: true, name: true, title: true, bio: true, desc: true,
  duration: true, range: true, bothOrNeither: true, lunchRange: true, days: true, date: true, label: true,
};

function pgError(e: unknown): { code?: string; constraint?: string } {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const o = cur as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof o.code === "string") return { code: o.code, constraint: typeof o.constraint_name === "string" ? o.constraint_name : undefined };
    cur = o.cause;
  }
  return {};
}

/** Maps unique (23505) and foreign-key (23503) violations to field errors; anything else rethrows. */
function mapConflict(e: unknown, field: string, taken: string): never {
  const { code } = pgError(e);
  if (code === "23505") throw new BookingError("invalid", { fields: { [field]: taken } satisfies FieldErrors });
  if (code === "23503") throw new BookingError("invalid", { fields: { form: "invalid" } satisfies FieldErrors });
  throw e;
}

// ---- reads (settings.view) ----

export type DentistRow = typeof dentists.$inferSelect;
export type TreatmentRow = typeof treatments.$inferSelect;
export type DentistDetail = DentistRow & {
  treatmentIds: number[];
  hours: { weekday: number; start: string; end: string }[];
};

export async function listDentists(db: DbOrTx, actor: Actor): Promise<DentistRow[]> {
  viewGuard(actor);
  return db.select().from(dentists).orderBy(asc(dentists.sortOrder), asc(dentists.id));
}

export async function getDentist(db: DbOrTx, actor: Actor, id: number): Promise<DentistDetail | null> {
  viewGuard(actor);
  const [d] = await db.select().from(dentists).where(eq(dentists.id, id));
  if (!d) return null;
  const [links, hours] = await Promise.all([
    db.select({ id: dentistTreatments.treatmentId }).from(dentistTreatments).where(eq(dentistTreatments.dentistId, id)),
    db.select().from(workingHours).where(eq(workingHours.dentistId, id)).orderBy(asc(workingHours.weekday)),
  ]);
  return {
    ...d,
    treatmentIds: links.map((l) => l.id).sort((a, b) => a - b),
    hours: hours.map(({ weekday, start, end }) => ({ weekday, start, end })),
  };
}

export async function listAllTreatments(db: DbOrTx, actor: Actor): Promise<TreatmentRow[]> {
  viewGuard(actor);
  return db.select().from(treatments).orderBy(asc(treatments.sortOrder), asc(treatments.id));
}

export async function getTreatment(db: DbOrTx, actor: Actor, id: number): Promise<TreatmentRow | null> {
  viewGuard(actor);
  const [t] = await db.select().from(treatments).where(eq(treatments.id, id));
  return t ?? null;
}

export async function getClinicHours(db: DbOrTx, actor: Actor) {
  viewGuard(actor);
  const [rows, [s]] = await Promise.all([
    db.select().from(clinicHours).orderBy(asc(clinicHours.weekday)),
    db.select().from(clinicSettings).where(eq(clinicSettings.id, 1)),
  ]);
  const by = new Map(rows.map((r) => [r.weekday, r]));
  return {
    days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      open: by.get(weekday)?.open ?? null,
      close: by.get(weekday)?.close ?? null,
    })),
    lunchStart: s?.lunchStart ?? "12:30",
    lunchEnd: s?.lunchEnd ?? "13:30",
  };
}

export async function listClosedDates(db: DbOrTx, actor: Actor) {
  viewGuard(actor);
  return db.select().from(closedDates).orderBy(asc(closedDates.date));
}

// ---- writes (settings.edit; refused in demo) ----

export async function saveTreatment(db: DbOrTx, actor: Actor, input: TreatmentInput): Promise<number> {
  editGuard(actor);
  const v = parse(TreatmentInput, input);
  const { id, ...values } = v;
  try {
    if (id === undefined) {
      const [r] = await db.insert(treatments).values(values).returning({ id: treatments.id });
      return r.id;
    }
    const [r] = await db.update(treatments).set(values).where(eq(treatments.id, id)).returning({ id: treatments.id });
    if (!r) throw new BookingError("not_found");
    return r.id;
  } catch (e) {
    if (e instanceof BookingError) throw e;
    return mapConflict(e, "slug", "slugTaken");
  }
}

/** One appointment that stops a dentist being deactivated (start is an ISO instant). */
export type BlockingAppointment = { id: string; start: string; patientName: string };

/**
 * Replaces the dentist's treatments and weekly hours. Existing appointments are never touched.
 * Deactivating an active dentist who still has booked appointments ending after `now` is refused with
 * `dentist_has_appointments` and the list, so none are stranded off the calendar.
 */
export async function saveDentist(db: DbOrTx, actor: Actor, input: DentistInput, now: Date = new Date()): Promise<number> {
  editGuard(actor);
  const v = parse(DentistInput, input);
  const { id, treatmentIds, hours, ...values } = v;
  const ids = [...new Set(treatmentIds)];
  try {
    return await db.transaction(async (tx) => {
      if (id !== undefined && !values.active) {
        // The dentist lock serialises this check with bookings for them: one that commits first
        // shows up here, one that waits sees the dentist inactive afterwards.
        await lockDentists(tx, [id]);
      }
      // Only the active -> inactive switch strands appointments; editing or reactivating a dentist
      // who is already inactive must stay possible however many future appointments they have.
      const [current] = id === undefined ? [] : await tx.select({ active: dentists.active }).from(dentists).where(eq(dentists.id, id));
      if (id !== undefined && !values.active && current?.active) {
        const rows = await tx
          .select({
            id: entries.id,
            during: entries.during,
            patientName: sql<string | null>`coalesce(${entries.contactName}, ${patients.name})`,
          })
          .from(entries)
          .leftJoin(patients, eq(patients.id, entries.patientId))
          .where(
            and(
              eq(entries.dentistId, id),
              eq(entries.kind, "appointment"),
              eq(entries.active, true),
              eq(entries.status, "booked"),
              sql`upper(${entries.during}) > ${now.toISOString()}::timestamptz`,
            ),
          )
          .orderBy(asc(entries.during));
        if (rows.length) {
          const appointments: BlockingAppointment[] = rows.map((r) => ({
            id: r.id,
            start: r.during.start.toISOString(),
            patientName: r.patientName ?? "",
          }));
          throw new BookingError("dentist_has_appointments", { appointments });
        }
      }
      if (ids.length) {
        const found = await tx.select({ id: treatments.id }).from(treatments).where(inArray(treatments.id, ids));
        if (found.length !== ids.length) throw new BookingError("invalid", { fields: { treatmentIds: "invalid" } satisfies FieldErrors });
      }
      let dentistId: number;
      if (id === undefined) {
        const [r] = await tx.insert(dentists).values(values).returning({ id: dentists.id });
        dentistId = r.id;
      } else {
        const [r] = await tx.update(dentists).set(values).where(eq(dentists.id, id)).returning({ id: dentists.id });
        if (!r) throw new BookingError("not_found");
        dentistId = r.id;
      }
      await tx.delete(dentistTreatments).where(eq(dentistTreatments.dentistId, dentistId));
      if (ids.length) await tx.insert(dentistTreatments).values(ids.map((treatmentId) => ({ dentistId, treatmentId })));
      await tx.delete(workingHours).where(eq(workingHours.dentistId, dentistId));
      if (hours.length) await tx.insert(workingHours).values(hours.map((h) => ({ dentistId, ...h })));
      return dentistId;
    });
  } catch (e) {
    if (e instanceof BookingError) throw e;
    return mapConflict(e, "slug", "slugTaken");
  }
}

export async function saveClinicHours(db: DbOrTx, actor: Actor, input: ClinicHoursInput): Promise<void> {
  editGuard(actor);
  const v = parse(ClinicHoursInput, input);
  await db.transaction(async (tx) => {
    for (const d of v.days) {
      await tx
        .insert(clinicHours)
        .values(d)
        .onConflictDoUpdate({ target: clinicHours.weekday, set: { open: d.open, close: d.close } });
    }
    await tx
      .insert(clinicSettings)
      .values({ id: 1, lunchStart: v.lunchStart, lunchEnd: v.lunchEnd })
      .onConflictDoUpdate({ target: clinicSettings.id, set: { lunchStart: v.lunchStart, lunchEnd: v.lunchEnd } });
  });
}

export async function addClosedDate(
  db: DbOrTx,
  actor: Actor,
  input: { date: string; labelEn: string; labelTr: string },
): Promise<void> {
  editGuard(actor);
  const v = parse(ClosedDateInput, input);
  try {
    await db.insert(closedDates).values(v);
  } catch (e) {
    mapConflict(e, "date", "dateTaken");
  }
}

export async function removeClosedDate(db: DbOrTx, actor: Actor, date: string): Promise<void> {
  editGuard(actor);
  await db.delete(closedDates).where(eq(closedDates.date, date));
}
