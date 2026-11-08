import { eq } from "drizzle-orm";
import type { Db, DbOrTx } from "@/lib/db/client";
import { dentists, entries, treatments } from "@/lib/db/schema";
import { hashToken } from "@/lib/security/tokens";
import { MANAGE_CUTOFF_HOURS } from "@/config/booking";
import { assertBookableOrTaken } from "./availability";
import { lockDentists, updateEntryRange } from "./entries";
import { BookingError } from "./errors";

export type ManageView = {
  appointmentId: string;
  start: Date;
  end: Date;
  treatmentId: number;
  treatmentName: string;
  dentistId: number;
  dentistName: string;
  status: string;
  canChange: boolean;
};

const CUTOFF_MS = MANAGE_CUTOFF_HOURS * 3_600_000;

const canChangeAt = (status: string | null, start: Date, now: Date) =>
  status === "booked" && start.getTime() - now.getTime() >= CUTOFF_MS;

type Row = {
  id: string;
  start: Date;
  end: Date;
  status: string | null;
  treatmentId: number;
  treatmentNameEn: string;
  dentistId: number;
  dentistName: string;
  durationMin: number;
};

async function findByToken(db: DbOrTx, token: string): Promise<Row | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const [r] = await db
    .select({
      id: entries.id,
      during: entries.during,
      status: entries.status,
      kind: entries.kind,
      treatmentId: entries.treatmentId,
      treatmentNameEn: treatments.nameEn,
      durationMin: treatments.durationMin,
      dentistId: entries.dentistId,
      dentistName: dentists.name,
    })
    .from(entries)
    .innerJoin(treatments, eq(treatments.id, entries.treatmentId))
    .innerJoin(dentists, eq(dentists.id, entries.dentistId))
    .where(eq(entries.manageTokenHash, hashToken(token)))
    .limit(1);
  if (!r || r.kind !== "appointment" || r.treatmentId === null) return null;
  return {
    id: r.id,
    start: r.during.start,
    end: r.during.end,
    status: r.status,
    treatmentId: r.treatmentId,
    treatmentNameEn: r.treatmentNameEn,
    dentistId: r.dentistId,
    dentistName: r.dentistName,
    durationMin: r.durationMin,
  };
}

/**
 * The appointment behind a manage link, or null when the token is unknown or the appointment is
 * over (the link has expired). `treatmentName` is English here; pages localise by treatment id.
 */
export async function getByManageToken(db: Db, token: string, now: Date): Promise<ManageView | null> {
  const r = await findByToken(db, token);
  if (!r || r.end <= now) return null;
  return {
    appointmentId: r.id,
    start: r.start,
    end: r.end,
    treatmentId: r.treatmentId,
    treatmentName: r.treatmentNameEn,
    dentistId: r.dentistId,
    dentistName: r.dentistName,
    status: r.status ?? "booked",
    canChange: canChangeAt(r.status, r.start, now),
  };
}

/** Throws the error a patient hits when the appointment can't be changed any more. */
function assertChangeable(r: Row | null, now: Date): asserts r is Row {
  if (!r) throw new BookingError("not_found");
  if (r.end <= now) throw new BookingError("link_expired");
  if (!canChangeAt(r.status, r.start, now)) throw new BookingError("too_late");
}

/**
 * Runs `fn` in a transaction that holds the appointment's dentist lock and a row lock, after
 * re-checking the rules against the locked row (a staff change may have landed meanwhile).
 */
async function withLockedAppointment<T>(
  db: Db,
  token: string,
  now: Date,
  fn: (tx: DbOrTx, row: Row) => Promise<T>,
): Promise<T> {
  const hash = hashToken(token);
  return db.transaction(async (tx) => {
    const [peek] = await tx.select({ dentistId: entries.dentistId }).from(entries).where(eq(entries.manageTokenHash, hash));
    if (!peek) throw new BookingError("not_found");
    await lockDentists(tx, [peek.dentistId]);
    await tx.select({ id: entries.id }).from(entries).where(eq(entries.manageTokenHash, hash)).for("update");
    const row = await findByToken(tx, token);
    assertChangeable(row, now);
    return fn(tx, row);
  });
}

/** Cancels the appointment. Idempotent for an already cancelled one. */
export async function cancelByPatient(db: Db, token: string, now: Date): Promise<void> {
  const r = await findByToken(db, token);
  if (r?.status === "cancelled" && r.end > now) return;
  assertChangeable(r, now);
  await withLockedAppointment(db, token, now, async (tx, row) => {
    await tx
      .update(entries)
      .set({ status: "cancelled", active: false, cancelledBy: "patient", updatedAt: now })
      .where(eq(entries.id, row.id));
  });
}

/** Moves the appointment to `newStart`: same row, dentist and treatment, public booking rules. */
export async function rescheduleByPatient(db: Db, token: string, newStart: Date, now: Date): Promise<void> {
  assertChangeable(await findByToken(db, token), now);
  await withLockedAppointment(db, token, now, async (tx, row) => {
    const range = { start: newStart, end: new Date(newStart.getTime() + row.durationMin * 60_000) };
    // A time someone else holds, blocked or has booked is "taken", not a rule problem.
    await assertBookableOrTaken(tx, {
      treatmentId: row.treatmentId,
      dentistId: row.dentistId,
      start: newStart,
      end: range.end,
      now,
      audience: "public",
      ignoreEntryId: row.id,
    });
    await updateEntryRange(tx, row.id, row.dentistId, range, now);
  });
}
