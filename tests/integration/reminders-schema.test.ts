import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { emailLog, entries, patients, reminders } from "@/lib/db/schema";
import { closeTestDb, pgCode, resetTables, seedFixture, T, testDb } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";

const db = testDb();
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

async function entry(): Promise<string> {
  const [p] = await db
    .insert(patients)
    .values({ name: "Ayşe", phoneE164: "+905321112233", locale: "en" })
    .returning({ id: patients.id });
  const [e] = await db
    .insert(entries)
    .values({
      dentistId: fx.dentists.ayd,
      kind: "appointment",
      during: { start: T("2026-11-12", "11:00"), end: T("2026-11-12", "11:30") },
      treatmentId: fx.treatments.checkup,
      patientId: p.id,
      status: "booked",
      source: "online",
    })
    .returning({ id: entries.id });
  return e.id;
}

const row = (entryId: string, startsAt: Date) => ({
  entryId,
  channel: "email" as const,
  startsAt,
  status: "pending",
  toAddress: "ayse@mail.test",
  locale: "en",
  body: "Reminder",
  source: "schedule",
});

describe("reminders", () => {
  it("a second reminder for the same entry, channel and start is rejected", async () => {
    const id = await entry();
    const at = T("2026-11-12", "11:00");
    await db.insert(reminders).values(row(id, at));
    const err = await db.insert(reminders).values(row(id, at)).then(() => null, (e) => e);
    expect(pgCode(err)).toBe("23505");
  });

  it("the same entry and channel at a new start is allowed", async () => {
    const id = await entry();
    await db.insert(reminders).values(row(id, T("2026-11-12", "11:00")));
    await db.insert(reminders).values(row(id, T("2026-11-12", "15:00")));
    expect(await db.select().from(reminders)).toHaveLength(2);
  });

  it("email_log has an index on lower(to_address)", async () => {
    const rows = await db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'email_log' AND indexname = 'email_log_to_address_lower_idx'`,
    );
    expect([...rows]).toHaveLength(1);
    expect([...rows][0].indexdef).toContain("lower(to_address)");
  });

  it("email_trigger accepts system", async () => {
    await db.insert(emailLog).values({
      kind: "reminder", toAddress: "a@mail.test", locale: "en", subject: "s", status: "logged", trigger: "system",
    });
  });
});
