import { sql } from "drizzle-orm";
import { atIstanbul } from "@/lib/time";
import { createDb, type Db } from "@/lib/db/client";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://clinic:clinic@localhost:5433/clinic_test";

export { seedFixture, NOW_ISO } from "./fixture";

let shared: Db | undefined;

/** Shared connection to the (already migrated) test database. */
export function testDb(): Db {
  shared ??= createDb(TEST_DATABASE_URL);
  return shared;
}

export async function closeTestDb(): Promise<void> {
  const s = shared;
  shared = undefined;
  await s?.$client.end();
}

export async function resetTables(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE entries, dentist_treatments, working_hours, patients, callback_requests,
      email_log, reminders, rate_events, dentists, treatments, clinic_hours, clinic_settings, closed_dates
    RESTART IDENTITY CASCADE`);
}

/** Clinic wall time (Europe/Istanbul, UTC+3, no DST) to a Date. */
export function T(date: string, time: string): Date {
  return atIstanbul(date, time);
}

/** SQLSTATE of a Postgres error, whether raw or wrapped by Drizzle in `cause`. */
export function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
