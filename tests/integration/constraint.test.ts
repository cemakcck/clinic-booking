import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { entries } from "@/lib/db/schema";
import { pgCode, resetTables, seedFixture, T, testDb, closeTestDb } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";

const db = testDb();
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

const during = (from: string, to: string) => ({
  start: T("2026-11-10", from),
  end: T("2026-11-10", to),
});

const block = (dentistId: number, from: string, to: string, active = true) =>
  db.insert(entries).values({
    dentistId,
    kind: "block",
    during: during(from, to),
    blockReason: "meeting",
    active,
  });

async function codeOf(p: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return pgCode(e);
  }
  return undefined;
}

describe("entries no-overlap constraint", () => {
  it("rejects overlapping active entries for the same dentist", async () => {
    await block(fx.dentists.ayd, "10:00", "11:00");
    expect(await codeOf(block(fx.dentists.ayd, "10:30", "11:30"))).toBe("23P01");
  });

  it("allows touching ranges", async () => {
    await block(fx.dentists.ayd, "10:00", "11:00");
    await block(fx.dentists.ayd, "11:00", "12:00");
    const rows = await db.select().from(entries);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.during.start.getTime()).sort()).toEqual([
      T("2026-11-10", "10:00").getTime(),
      T("2026-11-10", "11:00").getTime(),
    ]);
  });

  it("allows overlap across dentists", async () => {
    await block(fx.dentists.ayd, "10:00", "11:00");
    await block(fx.dentists.kay, "10:00", "11:00");
    expect(await db.select().from(entries)).toHaveLength(2);
  });

  it("ignores inactive entries", async () => {
    const [p] = await insertPatient();
    await db.insert(entries).values({
      dentistId: fx.dentists.ayd,
      kind: "appointment",
      during: during("10:00", "10:30"),
      patientId: p.id,
      treatmentId: fx.treatments.checkup,
      status: "cancelled",
      source: "online",
      active: false,
    });
    await block(fx.dentists.ayd, "10:00", "10:30");
    expect(await db.select().from(entries)).toHaveLength(2);
  });

  it("blocks also collide with holds and appointments", async () => {
    const [p] = await insertPatient();
    await db.insert(entries).values({
      dentistId: fx.dentists.ayd,
      kind: "hold",
      during: during("14:00", "14:30"),
      expiresAt: T("2026-11-10", "14:05"),
      holdTokenHash: "h",
    });
    const code = await codeOf(
      db.insert(entries).values({
        dentistId: fx.dentists.ayd,
        kind: "appointment",
        during: during("14:15", "14:45"),
        patientId: p.id,
        treatmentId: fx.treatments.checkup,
        status: "booked",
        source: "online",
      }),
    );
    expect(code).toBe("23P01");
  });

  it("rejects an empty range (start == end)", async () => {
    expect(await codeOf(block(fx.dentists.ayd, "10:00", "10:00"))).toBe("23514");
  });

  it("rejects a cancelled entry left active", async () => {
    const [p] = await insertPatient();
    const code = await codeOf(
      db.insert(entries).values({
        dentistId: fx.dentists.ayd,
        kind: "appointment",
        during: during("10:00", "10:30"),
        patientId: p.id,
        treatmentId: fx.treatments.checkup,
        status: "cancelled",
        source: "online",
        active: true,
      }),
    );
    expect(code).toBe("23514");
  });
});

import { patients } from "@/lib/db/schema";
function insertPatient() {
  return db
    .insert(patients)
    .values({ name: "Test Patient", phoneE164: "+905321112233", locale: "en" })
    .returning({ id: patients.id });
}
