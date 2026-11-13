import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closedDates, dentists, entries, patients } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import type { Actor } from "@/lib/auth/roles";
import { dashboardData, utilisationEntries } from "@/lib/dashboard/metrics";

const db = testDb();
// Wed 2026-11-18 10:30 Istanbul. "week" = Mon 16 00:00 → now; previous = Mon 9 00:00 → Wed 11 10:30.
const now = T("2026-11-18", "10:30");
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

const reception: Actor = { userId: "u-rec", name: "Rec", role: "receptionist", dentistId: null };
const admin: Actor = { userId: "u-adm", name: "Adm", role: "admin", dentistId: null };
const drAyd = (): Actor => ({ userId: "u-ayd", name: "Dr. Ayd", role: "dentist", dentistId: fx.dentists.ayd });

type Status = "booked" | "arrived" | "completed" | "no_show" | "cancelled";
let seq = 0;
async function appt(
  dentistId: number,
  date: string,
  from: string,
  to: string,
  status: Status = "booked",
  source: "online" | "staff" = "online",
) {
  const [p] = await db
    .insert(patients)
    .values({ name: "Ayşe Yılmaz", phoneE164: `+90532333${String(++seq).padStart(4, "0")}`, locale: "tr" })
    .returning({ id: patients.id });
  await db.insert(entries).values({
    dentistId,
    kind: "appointment",
    during: { start: T(date, from), end: T(date, to) },
    treatmentId: fx.treatments.checkup,
    patientId: p.id,
    status,
    active: status !== "cancelled",
    source,
  });
}

async function block(dentistId: number, date: string, from: string, to: string) {
  await db
    .insert(entries)
    .values({ dentistId, kind: "block", during: { start: T(date, from), end: T(date, to) }, blockReason: "surgery" });
}

function hasNaN(v: unknown): boolean {
  if (typeof v === "number") return Number.isNaN(v);
  if (v && typeof v === "object") return Object.values(v).some(hasNaN);
  return false;
}

describe("dashboardData", () => {
  it("counts appointments and cancellations in the window", async () => {
    await appt(fx.dentists.ayd, "2026-11-16", "10:00", "10:30", "completed");
    await appt(fx.dentists.kay, "2026-11-17", "11:00", "11:30", "no_show");
    await appt(fx.dentists.kay, "2026-11-18", "09:00", "09:30", "arrived");
    await appt(fx.dentists.ayd, "2026-11-17", "14:00", "14:30", "cancelled");
    await appt(fx.dentists.ayd, "2026-11-18", "14:00", "14:30"); // after now: outside the headline window
    await appt(fx.dentists.ayd, "2026-11-13", "10:00", "10:30", "completed"); // last week, after the comparison cut
    await appt(fx.dentists.ayd, "2026-11-10", "10:00", "10:30", "completed"); // previous window
    await appt(fx.dentists.kay, "2026-11-11", "10:00", "10:30", "cancelled"); // previous window
    const r = await dashboardData(db, reception, "week", now);
    expect(r.period).toBe("week");
    expect(r.scope).toEqual({ dentistId: null });
    expect(r.current).toMatchObject({ appointments: 3, cancellations: 1 });
    expect(r.previous).toMatchObject({ appointments: 1, cancellations: 1 });
  });

  it("no-show rate ignores upcoming appointments", async () => {
    await appt(fx.dentists.ayd, "2026-11-16", "10:00", "10:30", "completed");
    await appt(fx.dentists.ayd, "2026-11-16", "11:00", "11:30", "no_show");
    await appt(fx.dentists.kay, "2026-11-17", "10:00", "10:30", "arrived");
    await appt(fx.dentists.kay, "2026-11-17", "11:00", "11:30", "completed");
    await appt(fx.dentists.kay, "2026-11-17", "15:00", "15:30", "booked"); // started but never marked
    await appt(fx.dentists.ayd, "2026-11-18", "11:00", "11:30", "booked"); // upcoming
    await appt(fx.dentists.ayd, "2026-11-19", "11:00", "11:30", "booked"); // upcoming
    const r = await dashboardData(db, reception, "week", now);
    expect(r.current.appointments).toBe(5);
    expect(r.current.noShowRate).toBeCloseTo(1 / 4, 10);
    const r4 = await dashboardData(db, reception, "4w", now);
    expect(r4.current.noShowRate).toBeCloseTo(1 / 4, 10);
  });

  it("online vs staff split", async () => {
    await appt(fx.dentists.ayd, "2026-11-16", "10:00", "10:30", "completed", "online");
    await appt(fx.dentists.ayd, "2026-11-16", "11:00", "11:30", "completed", "online");
    await appt(fx.dentists.kay, "2026-11-17", "10:00", "10:30", "arrived", "online");
    await appt(fx.dentists.kay, "2026-11-17", "11:00", "11:30", "completed", "staff");
    await appt(fx.dentists.kay, "2026-11-17", "14:00", "14:30", "no_show", "staff");
    await appt(fx.dentists.kay, "2026-11-17", "15:00", "15:30", "cancelled", "staff");
    const r = await dashboardData(db, reception, "week", now);
    expect(r.current).toMatchObject({ appointments: 5, online: 3, staff: 2 });
  });

  it("utilisation subtracts lunch, closed dates and blocks", async () => {
    // Whole week Mon 16 → Mon 23. Mon–Fri 09–18 minus lunch = 480 min/day; Sat 10–14 minus lunch = 180.
    await db.insert(closedDates).values({ date: "2026-11-19", labelEn: "Holiday", labelTr: "Tatil" });
    await block(fx.dentists.ayd, "2026-11-20", "09:00", "11:00"); // −120
    await block(fx.dentists.ayd, "2026-11-17", "12:00", "14:00"); // −60 (lunch already removed)
    await block(fx.dentists.ayd, "2026-11-24", "09:00", "18:00"); // next week: ignored
    await appt(fx.dentists.ayd, "2026-11-16", "10:00", "10:30", "completed"); // 30
    await appt(fx.dentists.ayd, "2026-11-18", "09:00", "09:30", "arrived"); // 30
    await appt(fx.dentists.ayd, "2026-11-18", "14:00", "15:00", "booked"); // 60, future part of the week counts
    await appt(fx.dentists.ayd, "2026-11-17", "15:00", "16:00", "cancelled"); // excluded
    const r = await dashboardData(db, admin, "week", now);
    expect(r.utilisation).toEqual([
      { dentistId: fx.dentists.ayd, name: "Dr. Ayd", bookedMin: 120, workingMin: 1920, ratio: 120 / 1920 },
      { dentistId: fx.dentists.kay, name: "Dr. Kay", bookedMin: 0, workingMin: 2100, ratio: 0 },
    ]);
  });

  it("utilisation counts only booked time inside working hours, so it never exceeds 100%", async () => {
    // Sat 21: 10–14 minus lunch = 180 working minutes for Dr. Ayd.
    await appt(fx.dentists.ayd, "2026-11-21", "10:00", "13:00", "completed"); // 150: the half hour in lunch (12:30–13:30) doesn't count
    await appt(fx.dentists.ayd, "2026-11-21", "15:00", "17:00", "completed"); // walk-in after closing: 0
    await appt(fx.dentists.ayd, "2026-11-22", "10:00", "11:00", "completed"); // Sunday, closed: 0
    const r = await dashboardData(db, admin, "week", now);
    const ayd = r.utilisation.find((u) => u.dentistId === fx.dentists.ayd)!;
    expect(ayd.bookedMin).toBe(150);
    expect(ayd.ratio!).toBeLessThanOrEqual(1);
  });

  it("utilisation ratio stays at most 1 when walk-ins outside hours outweigh the working time", async () => {
    // Close every weekday but Saturday for this check: only 180 working minutes in the week.
    for (const d of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"])
      await db.insert(closedDates).values({ date: d, labelEn: "Closed", labelTr: "Kapalı" });
    await appt(fx.dentists.ayd, "2026-11-21", "10:00", "12:00", "completed"); // 120 in hours
    await appt(fx.dentists.ayd, "2026-11-21", "14:00", "20:00", "completed"); // 360 after closing
    const r = await dashboardData(db, admin, "week", now);
    const ayd = r.utilisation.find((u) => u.dentistId === fx.dentists.ayd)!;
    expect(ayd).toMatchObject({ bookedMin: 120, workingMin: 180 });
    expect(ayd.ratio).toBeCloseTo(120 / 180, 10);
  });

  it("heatmap buckets by Istanbul weekday and hour", async () => {
    await appt(fx.dentists.ayd, "2026-11-16", "10:00", "10:30", "completed");
    await appt(fx.dentists.kay, "2026-11-16", "10:45", "11:15", "completed");
    await appt(fx.dentists.ayd, "2026-11-14", "11:00", "11:30", "completed"); // Saturday
    await appt(fx.dentists.ayd, "2026-11-17", "17:30", "18:00", "no_show");
    await appt(fx.dentists.ayd, "2026-11-15", "10:00", "10:30", "completed"); // Sunday: clinic closed
    await appt(fx.dentists.ayd, "2026-11-17", "08:00", "08:30", "completed"); // before opening
    await appt(fx.dentists.ayd, "2026-11-17", "09:00", "09:30", "cancelled");
    const r = await dashboardData(db, reception, "4w", now);
    const cell = (weekday: number, hour: number) => r.heatmap.find((h) => h.weekday === weekday && h.hour === hour);
    // Opening hours only: Mon–Fri 09–17 (9 hours each) + Sat 10–13 (4 hours).
    expect(r.heatmap).toHaveLength(5 * 9 + 4);
    expect(r.heatmap.every((h) => h.weekday >= 1 && h.weekday <= 6)).toBe(true);
    expect(cell(1, 10)?.count).toBe(2);
    expect(cell(6, 11)?.count).toBe(1);
    expect(cell(2, 17)?.count).toBe(1);
    expect(cell(2, 9)?.count).toBe(0);
    expect(cell(2, 8)).toBeUndefined();
    expect(cell(7, 10)).toBeUndefined();
    expect(r.heatmap.reduce((n, h) => n + h.count, 0)).toBe(4);
  });

  it("a dentist sees only their own numbers", async () => {
    await appt(fx.dentists.ayd, "2026-11-16", "10:00", "10:30", "completed", "online");
    await appt(fx.dentists.ayd, "2026-11-17", "10:00", "10:30", "no_show", "staff");
    await appt(fx.dentists.kay, "2026-11-16", "11:00", "11:30", "completed", "staff");
    await appt(fx.dentists.kay, "2026-11-17", "11:00", "11:30", "cancelled", "staff");
    await appt(fx.dentists.kay, "2026-11-10", "11:00", "11:30", "completed"); // kay, previous window
    await block(fx.dentists.kay, "2026-11-20", "09:00", "18:00");
    const r = await dashboardData(db, drAyd(), "week", now);
    expect(r.scope).toEqual({ dentistId: fx.dentists.ayd });
    expect(r.current).toEqual({ appointments: 2, cancellations: 0, noShowRate: 0.5, online: 1, staff: 1 });
    expect(r.previous).toBeNull();
    expect(r.utilisation).toHaveLength(1);
    expect(r.utilisation[0]).toMatchObject({ dentistId: fx.dentists.ayd, name: "Dr. Ayd", bookedMin: 60 });
    expect(r.heatmap.reduce((n, h) => n + h.count, 0)).toBe(2);
    const json = JSON.stringify(r);
    expect(json).not.toContain("Dr. Kay");
    expect(json).not.toContain(`"dentistId":${fx.dentists.kay}`);
  });

  it("a dentist account without a dentist id is refused", async () => {
    await expect(
      dashboardData(db, { userId: "u-x", name: "X", role: "dentist", dentistId: null }, "week", now),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("previous is null when the previous window is empty", async () => {
    await appt(fx.dentists.ayd, "2026-11-16", "10:00", "10:30", "completed");
    await appt(fx.dentists.ayd, "2026-11-12", "10:00", "10:30", "completed"); // last week, after the cut
    const r = await dashboardData(db, reception, "week", now);
    expect(r.previous).toBeNull();
    await appt(fx.dentists.kay, "2026-11-09", "10:00", "10:30", "completed");
    const r2 = await dashboardData(db, reception, "week", now);
    expect(r2.previous).toMatchObject({ appointments: 1, cancellations: 0, noShowRate: 0 });
  });

  it("empty period yields nulls, not NaN", async () => {
    const [idle] = await db
      .insert(dentists)
      .values({ slug: "idle", name: "Dr. Idle", titleEn: "", titleTr: "", bioEn: "", bioTr: "", sortOrder: 3 })
      .returning({ id: dentists.id });
    for (const p of ["week", "4w", "3m"] as const) {
      const r = await dashboardData(db, reception, p, now);
      expect(r.current).toEqual({ appointments: 0, cancellations: 0, noShowRate: null, online: 0, staff: 0 });
      expect(r.previous).toBeNull();
      expect(r.utilisation.find((u) => u.dentistId === idle.id)).toEqual({
        dentistId: idle.id,
        name: "Dr. Idle",
        bookedMin: 0,
        workingMin: 0,
        ratio: null,
      });
      expect(r.heatmap.every((h) => h.count === 0)).toBe(true);
      expect(hasNaN(r)).toBe(false);
    }
  });
});

describe("utilisationEntries", () => {
  it("returns only the given dentists' rows inside the window", async () => {
    await appt(fx.dentists.ayd, "2026-11-17", "10:00", "10:30"); // in window, ayd
    await block(fx.dentists.ayd, "2026-11-17", "15:00", "16:00"); // in window, ayd
    await appt(fx.dentists.ayd, "2026-12-01", "10:00", "10:30"); // out of window
    await appt(fx.dentists.kay, "2026-11-17", "10:00", "10:30"); // other dentist
    await appt(fx.dentists.kay, "2026-12-01", "10:00", "10:30"); // other dentist, out of window
    await appt(fx.dentists.ayd, "2026-11-17", "11:00", "11:30", "cancelled");
    const w = { start: T("2026-11-16", "00:00"), end: T("2026-11-23", "00:00") };
    const rows = await utilisationEntries(db, w, [fx.dentists.ayd]);
    expect(rows.map((r) => r.kind).sort()).toEqual(["appointment", "block"]);
    expect(rows.every((r) => r.dentistId === fx.dentists.ayd)).toBe(true);
  });
});
