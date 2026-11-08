import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { seedClinic } from "./seed";

/**
 * Wipes every app table and re-seeds, atomically.
 * HOOK (Task 12): add the better-auth tables (session, account, verification, user) to the
 * TRUNCATE list below and call `seedStaffUsers(tx)` after `seedClinic`.
 */
export async function resetDemo(db: Db, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      TRUNCATE entries, dentist_treatments, working_hours, patients, callback_requests,
        email_log, rate_events, dentists, treatments, clinic_hours, clinic_settings, closed_dates
      RESTART IDENTITY CASCADE`);
    await seedClinic(tx, { now });
  });
}
