import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { entries, patients } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import type { Actor } from "@/lib/auth/roles";
import { getCalendarDay, getCalendarWeek, getGridHours, layoutEntries } from "@/lib/staff/calendar-data";

const db = testDb();
const now = new Date(NOW_ISO); // Tue 2026-11-10 08:00 Istanbul
const D = "2026-11-10";
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

const reception: Actor = { userId: "u-rec", name: "Rec", role: "receptionist", dentistId: null };
const drAyd = (): Actor => ({ userId: "u-ayd", name: "Dr. Ayd", role: "dentist", dentistId: fx.dentists.ayd });

let seq = 0;
async function appt(dentistId: number, date: string, from: string, to: string, status: "booked" | "arrived" | "no_show" | "cancelled" = "booked") {
  const [p] = await db
    .insert(patients)
    .values({ name: "Ayşe Yılmaz", phoneE164: `+90532222${String(++seq).padStart(4, "0")}`, locale: "tr" })
    .returning({ id: patients.id });
  const [r] = await db
    .insert(entries)
    .values({
      dentistId,
      kind: "appointment",
      during: { start: T(date, from), end: T(date, to) },
      treatmentId: fx.treatments.checkup,
      patientId: p.id,
      status,
      active: status !== "cancelled",
      source: "online",
    })
    .returning({ id: entries.id });
  return r.id;
}

async function block(dentistId: number, start: Date, end: Date) {
  const [r] = await db
    .insert(entries)
    .values({ dentistId, kind: "block", during: { start, end }, blockReason: "surgery", blockNote: "Private note" })
    .returning({ id: entries.id });
  return r.id;
}

describe("getCalendarDay", () => {
  it("lists live entries per dentist with counters, localized names and the mine flag", async () => {
    const a = await appt(fx.dentists.ayd, D, "10:00", "10:30");
    await appt(fx.dentists.ayd, D, "11:00", "11:30", "arrived");
    await appt(fx.dentists.kay, D, "10:00", "10:30", "no_show");
    await appt(fx.dentists.kay, D, "14:00", "14:30", "cancelled");
    await appt(fx.dentists.kay, "2026-11-11", "10:00", "10:30");
    const r = await getCalendarDay(db, reception, D, now, { locale: "tr", mine: [a] });
    expect(r.dentists.map((d) => d.name)).toEqual(["Dr. Ayd", "Dr. Kay"]);
    expect(r.entries).toHaveLength(3);
    expect(r.counters).toMatchObject({ appointments: 3, arrived: 1, noShows: 1 });
    expect(r.counters.freeSlotsToday).toBeGreaterThan(0);
    const mine = r.entries.find((e) => e.id === a)!;
    expect(mine).toMatchObject({ mine: true, editable: true, treatmentName: "Kontrol", status: "booked" });
    expect(mine.patientPhone).toMatch(/^\+90532222/);
    expect(r.entries.filter((e) => e.mine)).toHaveLength(1);
  });

  it("a dentist sees others' entries read-only, without phone numbers or block notes", async () => {
    const own = await appt(fx.dentists.ayd, D, "10:00", "10:30");
    const other = await appt(fx.dentists.kay, D, "10:00", "10:30");
    const otherBlock = await block(fx.dentists.kay, T(D, "15:00"), T(D, "16:00"));
    const ownBlock = await block(fx.dentists.ayd, T(D, "15:00"), T(D, "16:00"));
    const r = await getCalendarDay(db, drAyd(), D, now);
    const by = new Map(r.entries.map((e) => [e.id, e]));
    expect(by.get(own)).toMatchObject({ editable: true });
    expect(by.get(own)!.patientPhone).toBeDefined();
    expect(by.get(other)).toMatchObject({ editable: false, patientName: "Ayşe Yılmaz" });
    expect(by.get(other)!.patientPhone).toBeUndefined();
    expect(by.get(otherBlock)).toMatchObject({ editable: false, blockReason: "surgery" });
    expect(by.get(otherBlock)!.blockNote).toBeUndefined();
    expect(by.get(ownBlock)).toMatchObject({ editable: true, blockNote: "Private note" });
  });
});

describe("getCalendarWeek and layout", () => {
  it("returns one dentist's week and splits a multi-day block per day", async () => {
    await appt(fx.dentists.ayd, "2026-11-09", "09:00", "09:30");
    await appt(fx.dentists.ayd, "2026-11-13", "09:00", "09:30");
    await appt(fx.dentists.kay, "2026-11-13", "09:00", "09:30");
    const leave = await block(fx.dentists.ayd, T("2026-11-11", "00:00"), T("2026-11-13", "00:00"));
    const r = await getCalendarWeek(db, reception, fx.dentists.ayd, "2026-11-09", now);
    expect(r.dentists).toHaveLength(1);
    expect(r.entries.filter((e) => e.kind === "appointment")).toHaveLength(2);
    expect(r.counters.appointments).toBe(2);
    const dates = Array.from({ length: 7 }, (_, i) => `2026-11-${String(9 + i).padStart(2, "0")}`);
    const items = layoutEntries(r.entries, dates).filter((i) => i.entryId === leave);
    expect(items.map((i) => [i.date, i.startMin, i.endMin])).toEqual([
      ["2026-11-11", 0, 1440],
      ["2026-11-12", 0, 1440],
    ]);
  });

  it("layout uses Istanbul clock minutes whatever the process zone", async () => {
    const id = await appt(fx.dentists.ayd, D, "13:45", "14:15");
    const r = await getCalendarDay(db, reception, D, now);
    const [it] = layoutEntries(
      r.entries.filter((e) => e.id === id),
      [D],
    );
    expect(it).toMatchObject({ startMin: 13 * 60 + 45, endMin: 14 * 60 + 15, startTime: "13:45", timeLabel: "13:45–14:15" });
  });

  it("grid hours: union bounds, dentist hours, lunch and closed days", async () => {
    const g = await getGridHours(db, [fx.dentists.ayd], ["2026-11-14", "2026-11-15", D]);
    expect(g.bounds).toEqual({ open: "09:00", close: "18:00" });
    expect(g.hours[`${fx.dentists.ayd}|2026-11-14`]).toMatchObject({ open: { start: "10:00", end: "14:00" }, breaks: [{ start: "12:30", end: "13:30" }] });
    expect(g.hours[`${fx.dentists.ayd}|2026-11-15`]).toMatchObject({ open: null, closed: true });
    expect(g.hours[`${fx.dentists.ayd}|${D}`].open).toEqual({ start: "09:00", end: "18:00" });
  });
});
