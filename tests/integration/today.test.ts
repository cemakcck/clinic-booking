import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { entries, patients } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import type { Actor } from "@/lib/auth/roles";
import { BookingError } from "@/lib/booking/errors";
import { getTodayForDentist } from "@/lib/staff/calendar-data";

const db = testDb();
const D = "2026-11-10";
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

const drAyd = (): Actor => ({ userId: "u-ayd", name: "Dr. Ayd", role: "dentist", dentistId: fx.dentists.ayd });

let seq = 0;
async function appt(
  dentistId: number,
  date: string,
  from: string,
  to: string,
  status: "booked" | "arrived" | "completed" | "no_show" | "cancelled" = "booked",
  name = "Ayşe Yılmaz",
) {
  const [p] = await db
    .insert(patients)
    .values({ name, phoneE164: `+90532333${String(++seq).padStart(4, "0")}`, locale: "tr" })
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

describe("getTodayForDentist", () => {
  it("lists only the dentist's live appointments of the Istanbul day, in time order", async () => {
    const late = await appt(fx.dentists.ayd, D, "14:00", "14:30");
    const early = await appt(fx.dentists.ayd, D, "09:00", "09:30", "completed");
    await appt(fx.dentists.ayd, D, "11:00", "11:30", "cancelled");
    await appt(fx.dentists.ayd, "2026-11-11", "09:00", "09:30");
    await appt(fx.dentists.kay, D, "10:00", "10:30");
    const r = await getTodayForDentist(db, drAyd(), new Date(T(D, "08:00")), { locale: "tr" });
    expect(r.items.map((i) => i.id)).toEqual([early, late]);
    expect(r.items[0]).toMatchObject({ patientName: "Ayşe Yılmaz", treatmentName: "Kontrol", status: "completed" });
  });

  it("nextId is the first booked or arrived item whose end is after now", async () => {
    await appt(fx.dentists.ayd, D, "09:00", "09:30", "completed");
    await appt(fx.dentists.ayd, D, "10:00", "10:30", "no_show");
    const arrived = await appt(fx.dentists.ayd, D, "11:00", "11:30", "arrived");
    const later = await appt(fx.dentists.ayd, D, "15:00", "15:30");
    expect((await getTodayForDentist(db, drAyd(), new Date(T(D, "11:10")))).nextId).toBe(arrived);
    expect((await getTodayForDentist(db, drAyd(), new Date(T(D, "11:30")))).nextId).toBe(later);
    expect((await getTodayForDentist(db, drAyd(), new Date(T(D, "16:00")))).nextId).toBeNull();
  });

  it("uses the Istanbul day around midnight", async () => {
    const a = await appt(fx.dentists.ayd, D, "00:15", "00:45");
    const r = await getTodayForDentist(db, drAyd(), new Date("2026-11-09T21:30:00Z")); // 00:30 Istanbul on the 10th
    expect(r.items.map((i) => i.id)).toEqual([a]);
  });

  it("refuses an actor without a dentist calendar", async () => {
    const rec: Actor = { userId: "u", name: "Rec", role: "receptionist", dentistId: null };
    await expect(getTodayForDentist(db, rec, new Date(NOW_ISO))).rejects.toBeInstanceOf(BookingError);
  });
});
