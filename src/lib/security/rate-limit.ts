import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { rateEvents } from "@/lib/db/schema";
import { RATE } from "@/config/booking";
import { BookingError } from "@/lib/booking/errors";

/**
 * Sliding-window limiter backed by rate_events. A per-(kind, ip) advisory lock serialises the
 * count-then-insert so concurrent requests can't both slip under the limit.
 */
export async function checkAndRecordRate(
  db: Db,
  kind: keyof typeof RATE,
  ipHash: string,
  now: Date,
): Promise<void> {
  const [limit, windowMs] = RATE[kind];
  const since = new Date(now.getTime() - windowMs);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`rate:${kind}:${ipHash}`}))`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(rateEvents)
      .where(and(eq(rateEvents.kind, kind), eq(rateEvents.ipHash, ipHash), gt(rateEvents.createdAt, since)));
    if (n >= limit) throw new BookingError("rate_limited");
    await tx.insert(rateEvents).values({ kind, ipHash, createdAt: now });
  });
}
