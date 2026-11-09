import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { entries } from "@/lib/db/schema";
import { closeTestDb, pgCode, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import { BookingError } from "@/lib/booking/errors";
import { insertEntry, updateEntryRange } from "@/lib/booking/entries";
import type { DbOrTx } from "@/lib/db/client";

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

/** Dentist ids whose entries lock this transaction holds, ascending. */
async function heldDentistLocks(tx: DbOrTx): Promise<number[]> {
  const rows = await tx.execute<{ id: number }>(sql`
    SELECT objid::int AS id FROM pg_locks
    WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND objsubid = 2
      AND classid = hashtext('entries:dentist')::oid
    ORDER BY 1`);
  return [...rows].map((r) => r.id);
}

const block = (dentistId: number, from: string, to: string) =>
  insertEntry(
    db,
    { dentistId, kind: "block", during: { start: T(D, from), end: T(D, to) }, blockReason: "meeting" },
    now,
  );

const range = (from: string, to: string) => ({ start: T(D, from), end: T(D, to) });

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

describe("updateEntryRange", () => {
  it("a cross-dentist move locks both the current and the target dentist", async () => {
    const id = await block(fx.dentists.kay, "10:00", "10:30");
    const held = await db.transaction(async (tx) => {
      await updateEntryRange(tx, id, fx.dentists.ayd, range("14:00", "14:30"), now);
      return heldDentistLocks(tx);
    });
    expect(held).toEqual([fx.dentists.ayd, fx.dentists.kay].sort((a, b) => a - b));
  });

  // Each move locks both dentists. In opposite directions that is A,B against B,A unless both
  // take them in one global (ascending) order; otherwise the two transactions deadlock.
  it("concurrent cross-dentist moves in opposite directions both finish without deadlock", async () => {
    const { ayd, kay } = fx.dentists;
    for (let round = 0; round < 10; round++) {
      await db.delete(entries);
      const a = await block(ayd, "10:00", "10:30");
      const b = await block(kay, "11:00", "11:30");
      const arrive = barrier(2);
      const move = (id: string, to: number, r: { start: Date; end: Date }) =>
        db.transaction(async (tx) => {
          await tx.execute(sql`SELECT 1`);
          await arrive();
          await updateEntryRange(tx, id, to, r, now);
        });
      const results = await Promise.allSettled([
        move(a, kay, range("14:00", "14:30")),
        move(b, ayd, range("15:00", "15:30")),
      ]);
      const codes = results.map((r) =>
        r.status === "fulfilled" ? "ok" : r.reason instanceof BookingError ? r.reason.code : (pgCode(r.reason) ?? String(r.reason)),
      );
      expect({ round, codes }).toEqual({ round, codes: ["ok", "ok"] });
      const rows = await db.select().from(entries);
      expect(
        rows.map((e) => [e.id, e.dentistId, e.during.start.getTime()]).sort((x, y) => Number(x[2]) - Number(y[2])),
      ).toEqual([
        [a, kay, T(D, "14:00").getTime()],
        [b, ayd, T(D, "15:00").getTime()],
      ]);
    }
  }, 30_000);
});
