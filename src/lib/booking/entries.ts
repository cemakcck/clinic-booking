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

export async function insertEntry(tx: DbOrTx, row: NewEntry, now: Date): Promise<string> {
  await sweepExpiredHolds(tx, row.dentistId, row.during as Interval, now);
  return withSlotTaken(async () => {
    const [r] = await tx.insert(entries).values(row).returning({ id: entries.id });
    return r.id;
  });
}

export async function updateEntryRange(
  tx: DbOrTx,
  id: string,
  dentistId: number,
  range: Interval,
  now: Date,
): Promise<void> {
  await sweepExpiredHolds(tx, dentistId, range, now, id);
  await withSlotTaken(async () => {
    await tx.update(entries).set({ dentistId, during: range, updatedAt: now }).where(eq(entries.id, id));
  });
}
