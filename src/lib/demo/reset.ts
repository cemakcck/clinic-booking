import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { seedClinic } from "./seed";
import { seedStaffUsers } from "./staff-users";

/**
 * Wipes every app table (including Better Auth's, which signs everyone out) and re-seeds the
 * clinic and the demo staff accounts, atomically.
 */
export async function resetDemo(db: Db, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      TRUNCATE entries, dentist_treatments, working_hours, patients, callback_requests,
        email_log, reminders, rate_events, dentists, treatments, clinic_hours, clinic_settings, closed_dates,
        "session", "account", "verification", "user"
      RESTART IDENTITY CASCADE`);
    await seedClinic(tx, { now });
    await seedStaffUsers(tx);
  });
}
