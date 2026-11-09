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
 * Per-dentist write locks (transaction-scoped advisory locks), held until the transaction ends.
 *
 * Why: concurrent inserts into the GiST exclusion constraint can each wait on the other's
 * uncommitted row, a deadlock (40P01) that Postgres only breaks after deadlock_timeout, one victim
 * per second. Holding the dentist's lock, a writer sees the previous writer's committed row and
 * gets 23P01 (slot_taken) at once.
 *
 * Rules for every transaction that writes entries:
 *  1. Lock all involved dentists (current and target of a move) in ascending id order, in one
 *     call, before taking any row lock (FOR UPDATE, UPDATE, DELETE) on entries. Taking a dentist
 *     lock after a row lock, or in another order, can deadlock against another writer.
 *  2. Rate-limit checks (checkAndRecordRate) run in their own committed transaction, never inside
 *     a dentist-locked transaction.
 *  3. No external I/O (email, HTTP) while a dentist lock is held; send after commit.
 *
 * Exemption: releaseHold (holds.ts) deletes one hold row in a single autocommit statement with no
 * dentist lock. It holds no lock before that row lock and takes none after it, so it can wait on
 * a writer but never be part of a wait cycle; and freeing a slot cannot break the constraint.
 *
 * Must run inside a transaction: on a bare connection the lock is released at once.
 * Re-taking a lock the transaction already holds is a no-op.
 */
export async function lockDentists(tx: DbOrTx, dentistIds: number[]): Promise<void> {
  const ids = [...new Set(dentistIds)].sort((a, b) => a - b);
  for (const id of ids) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('entries:dentist'), ${id})`);
  }
}

/** One dentist's lock; see lockDentists for the rules. */
export async function lockDentistEntries(tx: DbOrTx, dentistId: number): Promise<void> {
  await lockDentists(tx, [dentistId]);
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

/**
 * Inside a transaction: moves an entry to `dentistId` and `range`. Locks the entry's current and
 * target dentists (ascending) before touching any row. A caller that already holds a row lock on
 * the entry must have locked both dentists with lockDentists before it (rule 1).
 */
export async function updateEntryRange(
  tx: DbOrTx,
  id: string,
  dentistId: number,
  range: Interval,
  now: Date,
): Promise<void> {
  // Plain read, no row lock: rule 1 forbids row locks before the dentist locks.
  const [cur] = await tx.select({ dentistId: entries.dentistId }).from(entries).where(eq(entries.id, id));
  await lockDentists(tx, cur ? [cur.dentistId, dentistId] : [dentistId]);
  if (cur) {
    // Moved to another dentist between the read and the lock: we would hold the wrong lock, and
    // taking one more now could break the ascending order. Report it as a conflict.
    const [again] = await tx.select({ dentistId: entries.dentistId }).from(entries).where(eq(entries.id, id));
    if (again && again.dentistId !== cur.dentistId) throw new BookingError("slot_taken");
  }
  await sweepExpiredHolds(tx, dentistId, range, now, id);
  await withSlotTaken(async () => {
    await tx.update(entries).set({ dentistId, during: range, updatedAt: now }).where(eq(entries.id, id));
  });
}
