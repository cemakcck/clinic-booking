import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { entries } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import type { Actor } from "@/lib/auth/roles";
import { confirmBooking, placeHold } from "@/lib/booking/holds";
import { createStaffAppointment, moveAppointment, setStatus } from "@/lib/staff/appointments";

const db = testDb();
const now = new Date(NOW_ISO); // Tue 2026-11-10 08:00
const D = "2026-11-10";
const min = (n: number) => new Date(now.getTime() + n * 60_000);
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

const reception: Actor = { userId: "u-rec", name: "Rec", role: "receptionist", dentistId: null };
const patient = { name: "Ayşe Yılmaz", phone: "0532 111 2233", email: "ayse@mail.test", locale: "en" as const };

const scheduledAt = async (id: string) => {
  const [r] = await db.select({ s: entries.scheduledAt }).from(entries).where(eq(entries.id, id));
  return r.s;
};

describe("entries.scheduledAt", () => {
  it("confirmBooking sets scheduledAt to now", async () => {
    const h = await placeHold(db, {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.ayd,
      start: T(D, "11:00"),
      now,
      ipHash: "ip-1",
    });
    const at = min(3);
    const r = await confirmBooking(db, { holdId: h.holdId, holdToken: h.holdToken, patient, now: at, ipHash: "ip-c" });
    expect(await scheduledAt(r.appointmentId)).toEqual(at);
  });

  it("a staff-created appointment sets scheduledAt to now", async () => {
    const at = min(5);
    const { appointmentId } = await createStaffAppointment(db, reception, {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.ayd,
      start: T(D, "11:00"),
      patient,
      now: at,
    });
    expect(await scheduledAt(appointmentId)).toEqual(at);
  });

  it("moveEntry (reschedule) updates scheduledAt to now", async () => {
    const { appointmentId } = await createStaffAppointment(db, reception, {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.ayd,
      start: T(D, "11:00"),
      patient,
      now: min(5),
    });
    const at = min(20);
    await moveAppointment(db, reception, { appointmentId, newStart: T(D, "14:00"), now: at });
    expect(await scheduledAt(appointmentId)).toEqual(at);
  });

  it("a status change (arrived) leaves scheduledAt unchanged", async () => {
    const created = min(5);
    const { appointmentId } = await createStaffAppointment(db, reception, {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.ayd,
      start: T(D, "11:00"),
      patient,
      now: created,
    });
    await setStatus(db, reception, { appointmentId, status: "arrived" });
    expect(await scheduledAt(appointmentId)).toEqual(created);
  });
});
