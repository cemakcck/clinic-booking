import { and, eq, lte, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { entries } from "@/lib/db/schema";
import { overlaps } from "@/lib/db/range";
import type { Interval } from "@/lib/slots/engine";
import { BookingError } from "./errors";

export type NewEntry = typeof entries.$inferInsert;

/** SQLSTATE of a Postgres error, raw (postgres-js) or wrapped by Drizzle in `cause`. */
function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Maps the exclusion-constraint violation (23P01) to `slot_taken`; rethrows anything else. */
export async function withSlotTaken<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (pgCode(e) === "23P01") throw new BookingError("slot_taken");
    throw e;
  }
}

/** Expired holds are still `active`, so they would trip the constraint; remove them first. */
async function sweepExpiredHolds(tx: DbOrTx, dentistId: number, range: Interval, now: Date, exceptId?: string) {
  await tx
    .delete(entries)
    .where(
      and(
        eq(entries.dentistId, dentistId),
        eq(entries.kind, "hold"),
        lte(entries.expiresAt, now),
        overlaps(entries.during, range),
        exceptId ? ne(entries.id, exceptId) : sql`true`,
      ),
    );
}

/**
 * Serialises writes to one dentist's entries until the transaction ends. Concurrent inserts into
 * the GiST exclusion constraint can otherwise each wait on the other's uncommitted row: a deadlock
 * (40P01) that Postgres only breaks after deadlock_timeout, one victim per second. Holding this
 * lock, an inserter sees the previous writer's committed row and gets 23P01 at once.
 *
 * Must run inside a transaction, before taking any row lock on this dentist's entries (lock order:
 * dentist, then rows), or two writers can deadlock on this lock and a row lock instead.
 */
export async function lockDentistEntries(tx: DbOrTx, dentistId: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('entries:dentist'), ${dentistId})`);
}

/** Inside a transaction: takes the dentist lock, sweeps expired holds, inserts. */
export async function insertEntry(tx: DbOrTx, row: NewEntry, now: Date): Promise<string> {
  await lockDentistEntries(tx, row.dentistId);
  await sweepExpiredHolds(tx, row.dentistId, row.during as Interval, now);
  return withSlotTaken(async () => {
    const [r] = await tx.insert(entries).values(row).returning({ id: entries.id });
    return r.id;
  });
}

/** Inside a transaction; take the entry's dentist lock before locking its row (see confirmBooking). */
export async function updateEntryRange(
  tx: DbOrTx,
  id: string,
  dentistId: number,
  range: Interval,
  now: Date,
): Promise<void> {
  await lockDentistEntries(tx, dentistId);
  await sweepExpiredHolds(tx, dentistId, range, now, id);
  await withSlotTaken(async () => {
    await tx.update(entries).set({ dentistId, during: range, updatedAt: now }).where(eq(entries.id, id));
  });
}
