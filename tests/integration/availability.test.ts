import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closedDates, entries } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import {
  assertBookable,
  countPublicSlots,
  getDayStrip,
  getDaySlots,
  nextFreeSlot,
} from "@/lib/booking/availability";
import { BookingError } from "@/lib/booking/errors";

const db = testDb();
const now = new Date(NOW_ISO);
const D = "2026-11-10";
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

const times = (s: { start: Date }[]) => s.map((x) => x.start.getTime());
const has = (s: { start: Date }[], t: string) => times(s).includes(T(D, t).getTime());
const day = (treatmentId: number, dentistId: number | "any", date = D) =>
  getDaySlots(db, { treatmentId, dentistId, date, now, audience: "public" });

const insertEntry = (
  dentistId: number,
  kind: "block" | "hold",
  from: string,
  to: string,
  expiresAt?: Date,
) =>
  db.insert(entries).values({
    dentistId,
    kind,
    during: { start: T(D, from), end: T(D, to) },
    expiresAt,
    holdTokenHash: kind === "hold" ? "h" : undefined,
    blockReason: kind === "block" ? "meeting" : undefined,
  });

describe("availability", () => {
  it("lists slots for one dentist", async () => {
    const s = await day(fx.treatments.checkup, fx.dentists.ayd);
    expect(s[0].start).toEqual(T(D, "10:00"));
    expect(s[0].dentistIds).toEqual([fx.dentists.ayd]);
    expect(has(s, "12:30")).toBe(false);
  });

  it("any merges dentists", async () => {
    const s = await day(fx.treatments.checkup, "any");
    expect(s[0].dentistIds).toEqual([fx.dentists.ayd, fx.dentists.kay]);
  });

  it("only dentists who perform the treatment", async () => {
    const s = await day(fx.treatments.whitening, "any");
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) expect(x.dentistIds).toEqual([fx.dentists.ayd]);
  });

  it("existing appointment and block remove starts", async () => {
    await insertEntry(fx.dentists.ayd, "block", "10:00", "11:00");
    const a = await day(fx.treatments.checkup, fx.dentists.ayd);
    expect(has(a, "10:00")).toBe(false);
    expect(has(a, "10:30")).toBe(false);
    expect(has(a, "11:00")).toBe(true);
    const k = await day(fx.treatments.checkup, fx.dentists.kay);
    expect(has(k, "10:00")).toBe(true);
  });

  it("ignores expired holds", async () => {
    await insertEntry(fx.dentists.ayd, "hold", "10:00", "10:30", new Date(now.getTime() - 60_000));
    expect(has(await day(fx.treatments.checkup, fx.dentists.ayd), "10:00")).toBe(true);
  });

  it("active holds count", async () => {
    await insertEntry(fx.dentists.ayd, "hold", "10:00", "10:30", new Date(now.getTime() + 300_000));
    expect(has(await day(fx.treatments.checkup, fx.dentists.ayd), "10:00")).toBe(false);
  });

  it("ignoreEntryId frees the entry's own slot", async () => {
    const [e] = await db
      .insert(entries)
      .values({
        dentistId: fx.dentists.ayd,
        kind: "block",
        during: { start: T(D, "10:00"), end: T(D, "11:00") },
        blockReason: "meeting",
      })
      .returning({ id: entries.id });
    const s = await getDaySlots(db, {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.ayd,
      date: D,
      now,
      audience: "public",
      ignoreEntryId: e.id,
    });
    expect(has(s, "10:00")).toBe(true);
  });

  it("closed date returns nothing", async () => {
    await db.insert(closedDates).values({ date: "2026-11-11", labelEn: "x", labelTr: "x" });
    expect(await day(fx.treatments.checkup, "any", "2026-11-11")).toEqual([]);
    const strip = await getDayStrip(db, {
      treatmentId: fx.treatments.checkup,
      dentistId: "any",
      from: D,
      days: 3,
      now,
      audience: "public",
    });
    expect(strip.find((x) => x.date === "2026-11-11")?.available).toBe(false);
  });

  it("Sunday unavailable in strip", async () => {
    const strip = await getDayStrip(db, {
      treatmentId: fx.treatments.checkup,
      dentistId: "any",
      from: D,
      days: 7,
      now,
      audience: "public",
    });
    expect(strip.map((x) => [x.date, x.available])).toEqual([
      ["2026-11-10", true],
      ["2026-11-11", true],
      ["2026-11-12", true],
      ["2026-11-13", true],
      ["2026-11-14", true],
      ["2026-11-15", false],
      ["2026-11-16", true],
    ]);
  });

  it("nextFreeSlot finds the earliest", async () => {
    expect(await nextFreeSlot(db, now)).toEqual({
      start: T(D, "10:00"),
      dentistId: fx.dentists.ayd,
      treatmentId: fx.treatments.checkup,
    });
  });

  it("countPublicSlots counts dentist/start pairs", async () => {
    // per dentist: 10:00..12:00 = 9 starts, 13:30..17:30 = 17 starts; 2 dentists
    expect(await countPublicSlots(db, D, now)).toBe(52);
    await insertEntry(fx.dentists.ayd, "block", "10:00", "11:00");
    expect(await countPublicSlots(db, D, now)).toBe(48);
  });

  it("assertBookable rejects an off-grid time", async () => {
    const q = {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.ayd,
      now,
      audience: "public" as const,
    };
    await expect(assertBookable(db, { ...q, start: T(D, "10:05") })).rejects.toMatchObject({
      code: "outside_rules",
    });
    await expect(assertBookable(db, { ...q, start: T(D, "10:15") })).resolves.toBeUndefined();
    await expect(assertBookable(db, { ...q, start: T(D, "10:05") })).rejects.toBeInstanceOf(BookingError);
  });
});
