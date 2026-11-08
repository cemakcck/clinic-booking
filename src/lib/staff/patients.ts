import { and, asc, eq, exists, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { dentists, entries, patients, treatments } from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/roles";
import { BookingError } from "@/lib/booking/errors";
import { istanbulDateOf, istanbulTimeOf } from "@/lib/time";

export const PATIENT_LIMIT = 50;

/** Turkish letters and their plain counterparts; İ, I and ı all fold to "i". */
const FROM = "İIıŞşĞğÜüÖöÇç";
const TO = "iiissgguuoocc";

/** ASCII-fold and lowercase, so "AYŞE", "Ayşe" and "ayse" are one thing. Mirrors `foldSql`. */
export function fold(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC").replace(/̇/g, "")) {
    const i = FROM.indexOf(ch);
    out += i >= 0 ? TO[i] : ch;
  }
  return out.toLowerCase();
}

const foldSql = (col: SQL | { name: string }) =>
  sql`lower(translate(${col}, ${FROM}, ${TO}))`;

export type PatientRow = { id: string; name: string; phone: string; email: string | null; upcoming: number; past: number };

const isOwn = (actor: Actor): actor is Actor & { dentistId: number } => actor.role === "dentist";

function guard(actor: Actor) {
  if (!can(actor, "patients.view")) throw new BookingError("forbidden");
  if (isOwn(actor) && actor.dentistId === null) throw new BookingError("forbidden");
}

/** Appointments of a patient the actor may see: all of them, or a dentist's own. */
const apptScope = (actor: Actor, patientId: string | typeof patients.id) =>
  and(
    eq(entries.kind, "appointment"),
    eq(entries.patientId, patientId),
    isOwn(actor) ? eq(entries.dentistId, actor.dentistId!) : undefined,
  );

/**
 * Patients by name (case- and Turkish-diacritic-insensitive substring) or phone (the query's digits
 * contained in the E.164 digits; a leading 0 is the national prefix and is dropped, 3+ digits).
 * Empty query lists everyone. Name order, at most PATIENT_LIMIT. Dentists get only patients who
 * have an appointment with them, with counts of their own appointments (cancelled ones excluded).
 */
export async function searchPatients(db: DbOrTx, actor: Actor, q: string, now: Date = new Date()): Promise<PatientRow[]> {
  guard(actor);
  const term = fold(q.trim()).replace(/[\\%_]/g, (c) => `\\${c}`);
  const digits = q.replace(/\D/g, "").replace(/^0+/, "");
  const match: SQL[] = [];
  if (term) match.push(sql`${foldSql(patients.name)} like ${`%${term}%`}`);
  if (digits.length >= 3) match.push(sql`regexp_replace(${patients.phoneE164}, '\\D', '', 'g') like ${`%${digits}%`}`);
  const text = q.trim() === "" ? undefined : match.length ? sql`(${sql.join(match, sql` or `)})` : sql`false`;

  const live = (cond: SQL) =>
    sql<number>`(select count(*)::int from ${entries} where ${apptScope(actor, patients.id)} and ${entries.status} <> 'cancelled' and ${cond})`;
  const start = sql`lower(${entries.during})`;
  const upcoming = live(sql`${start} >= ${now.toISOString()}::timestamptz and ${entries.status} in ('booked','arrived')`);
  const past = live(sql`not (${start} >= ${now.toISOString()}::timestamptz and ${entries.status} in ('booked','arrived'))`);

  const scope = isOwn(actor)
    ? exists(db.select({ one: sql`1` }).from(entries).where(apptScope(actor, patients.id)))
    : undefined;

  return db
    .select({
      id: patients.id,
      name: patients.name,
      phone: patients.phoneE164,
      email: patients.email,
      upcoming: upcoming.mapWith(Number),
      past: past.mapWith(Number),
    })
    .from(patients)
    .where(and(text, scope))
    .orderBy(asc(foldSql(patients.name)), asc(patients.id))
    .limit(PATIENT_LIMIT);
}

export type PatientAppointment = {
  id: string;
  date: string;
  time: string;
  endTime: string;
  status: string;
  dentistId: number;
  dentistName: string;
  treatmentEn: string | null;
  treatmentTr: string | null;
};

/** One patient's appointments split into upcoming (soonest first) and past (latest first). */
export async function getPatientAppointments(
  db: DbOrTx,
  actor: Actor,
  patientId: string,
  now: Date = new Date(),
): Promise<{ patient: { id: string; name: string; phone: string; email: string | null }; upcoming: PatientAppointment[]; past: PatientAppointment[] }> {
  guard(actor);
  const [patient] = await db
    .select({ id: patients.id, name: patients.name, phone: patients.phoneE164, email: patients.email })
    .from(patients)
    .where(eq(patients.id, patientId));
  const rows = patient
    ? await db
        .select({
          id: entries.id,
          during: entries.during,
          status: entries.status,
          dentistId: entries.dentistId,
          dentistName: dentists.name,
          treatmentEn: treatments.nameEn,
          treatmentTr: treatments.nameTr,
        })
        .from(entries)
        .innerJoin(dentists, eq(dentists.id, entries.dentistId))
        .leftJoin(treatments, eq(treatments.id, entries.treatmentId))
        .where(apptScope(actor, patientId))
        .orderBy(asc(sql`lower(${entries.during})`))
    : [];
  // A dentist asking for someone who is not their patient gets the same answer as for no one.
  if (!patient || (isOwn(actor) && rows.length === 0)) throw new BookingError("not_found");

  const all: (PatientAppointment & { start: Date })[] = rows.map((r) => ({
    id: r.id,
    start: r.during.start,
    date: istanbulDateOf(r.during.start),
    time: istanbulTimeOf(r.during.start),
    endTime: istanbulTimeOf(r.during.end),
    status: r.status ?? "booked",
    dentistId: r.dentistId,
    dentistName: r.dentistName,
    treatmentEn: r.treatmentEn,
    treatmentTr: r.treatmentTr,
  }));
  const isUpcoming = (a: { start: Date; status: string }) =>
    a.start.getTime() >= now.getTime() && (a.status === "booked" || a.status === "arrived");
  const strip = (a: PatientAppointment & { start: Date }): PatientAppointment => {
    const { start, ...rest } = a;
    void start;
    return rest;
  };
  return {
    patient,
    upcoming: all.filter(isUpcoming).map(strip),
    past: all.filter((a) => !isUpcoming(a)).reverse().map(strip),
  };
}
