import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { entries } from "@/lib/db/schema";
import { istanbulDateOf } from "@/lib/time";

/**
 * The magic moment: the Istanbul date of the newest appointment this browser booked (ids come
 * from the demo_mine cookie, newest first). Ids that no longer exist, e.g. after the nightly
 * reset, are skipped. Null when none is left.
 */
export async function newestMineDate(db: DbOrTx, ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const rows = await db
    .select({ id: entries.id, during: entries.during })
    .from(entries)
    .where(and(inArray(entries.id, ids), eq(entries.kind, "appointment")));
  const byId = new Map(rows.map((r) => [r.id, r.during.start]));
  for (const id of ids) {
    const start = byId.get(id);
    if (start) return istanbulDateOf(start);
  }
  return null;
}
