import { and, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { clinicHours, closedDates } from "@/lib/db/schema";
import { countPublicSlots } from "@/lib/booking/availability";
import { BookingError } from "@/lib/booking/errors";
import { DEMO_FLOOR } from "@/config/booking";
import { addDays, istanbulDateOf, weekdayOf } from "@/lib/time";
import { isDemo } from "./mode";

/**
 * Throws `capacity_floor` when any date ends below `min` free public slots. A date that was
 * already below the floor may stay where it is, but must not get worse.
 */
export function assertFloor(
  before: Record<string, number>,
  after: Record<string, number>,
  min: number = DEMO_FLOOR.minSlots,
): void {
  for (const [date, b] of Object.entries(before)) {
    if ((after[date] ?? 0) < Math.min(min, b)) throw new BookingError("capacity_floor");
  }
}

/** The floor's dates: today, then the next open days (clinic open, not a closed date). */
async function floorDates(tx: DbOrTx, now: Date): Promise<string[]> {
  const today = istanbulDateOf(now);
  const last = addDays(today, 31);
  const [open, closed] = await Promise.all([
    tx.select({ weekday: clinicHours.weekday }).from(clinicHours).where(isNotNull(clinicHours.open)),
    tx
      .select({ date: closedDates.date })
      .from(closedDates)
      .where(and(gte(closedDates.date, today), lte(closedDates.date, last))),
  ]);
  const openDays = new Set(open.map((r) => r.weekday));
  const closedSet = new Set(closed.map((r) => r.date));
  const out = [today];
  for (let d = addDays(today, 1); out.length < DEMO_FLOOR.days && d <= last; d = addDays(d, 1)) {
    if (openDays.has(weekdayOf(d)) && !closedSet.has(d)) out.push(d);
  }
  return out;
}

/** Free public slots (DEMO_FLOOR probe) for today plus the next DEMO_FLOOR.days − 1 open days. */
export async function snapshotCapacity(tx: DbOrTx, now: Date): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const date of await floorDates(tx, now)) out[date] = await countPublicSlots(tx, date, now);
  return out;
}

/**
 * Runs `fn` (inside the caller's transaction) and refuses its effect with `capacity_floor` when
 * it drains a floor day. Takes a clinic-wide floor lock first so two staff changes on different
 * dentists can't both pass against the same "before" and together break the floor. Call it
 * before any dentist lock: the floor lock always comes first, so the order stays acyclic.
 */
export async function withCapacityFloor<T>(tx: DbOrTx, now: Date, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('demo:capacity-floor'))`);
  const before = await snapshotCapacity(tx, now);
  const result = await fn();
  assertFloor(before, await snapshotCapacity(tx, now));
  return result;
}

/** withCapacityFloor in demo mode; otherwise just `fn`. */
export function guardCapacity<T>(tx: DbOrTx, now: Date, fn: () => Promise<T>): Promise<T> {
  return isDemo() ? withCapacityFloor(tx, now, fn) : fn();
}
