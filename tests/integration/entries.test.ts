import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { entries } from "@/lib/db/schema";
import { closeTestDb, pgCode, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import { BookingError } from "@/lib/booking/errors";
import { insertEntry } from "@/lib/booking/entries";

const db = testDb();
const now = new Date(NOW_ISO);
const D = "2026-11-10";
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

/** A promise that resolves once `n` callers have arrived, so they all proceed at the same moment. */
function barrier(n: number) {
  let arrived = 0;
  let release!: () => void;
  const all = new Promise<void>((r) => (release = r));
  return () => {
    if (++arrived === n) release();
    return all;
  };
}

describe("insertEntry", () => {
  // Concurrent inserts into a GiST exclusion constraint can each see the other's uncommitted row
  // and wait on it. Two such waiters deadlock (40P01); Postgres breaks one cycle per
  // deadlock_timeout (1s), so a burst of n inserts can stall for n-1 seconds and every loser gets
  // a raw 40P01 instead of slot_taken. It is timing dependent, so try several rounds.
  it("simultaneous overlapping inserts for one dentist: one wins, the rest are slot_taken", async () => {
    const n = 8; // below the pool size of 10, so every transaction is open at once
    for (let round = 0; round < 15; round++) {
      await db.delete(entries);
      const arrive = barrier(n);
      const results = await Promise.allSettled(
        Array.from({ length: n }, (_, i) =>
          db.transaction(async (tx) => {
            await tx.execute(sql`SELECT count(*) FROM entries`); // open the transaction before the barrier
            await arrive();
            return insertEntry(
              tx,
              {
                dentistId: fx.dentists.ayd,
                kind: "hold",
                during: { start: T(D, "11:00"), end: T(D, "11:30") },
                expiresAt: new Date(now.getTime() + 5 * 60_000),
                holdTokenHash: `h-${round}-${i}`,
                treatmentId: fx.treatments.checkup,
              },
              now,
            );
          }),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled");
      const codes = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => (r.reason instanceof BookingError ? r.reason.code : (pgCode(r.reason) ?? String(r.reason))));
      expect({ round, ok: ok.length, codes }).toEqual({ round, ok: 1, codes: Array(n - 1).fill("slot_taken") });
      expect(await db.select().from(entries)).toHaveLength(1);
    }
  }, 60_000);
});
