import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { emailLog, entries, patients } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import type { Actor } from "@/lib/auth/roles";
import { confirmBooking, placeHold } from "@/lib/booking/holds";
import { notifyPatient } from "@/lib/booking/notify";
import { cancelByStaff, createStaffAppointment, moveAppointment } from "@/lib/staff/appointments";
import { getCalendarDay } from "@/lib/staff/calendar-data";

const db = testDb();
const now = new Date(NOW_ISO);
const D = "2026-11-10";
let fx: Fixture;
const reception: Actor = { userId: "u-rec", name: "Rec", role: "receptionist", dentistId: null };

const prevDemo = process.env.DEMO_MODE;
beforeEach(async () => {
  process.env.DEMO_MODE = "";
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(async () => {
  if (prevDemo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = prevDemo;
  await closeTestDb();
});

async function book(at: string, patient: { name: string; phone: string; email: string; locale: "en" | "tr" }, ip: string) {
  const h = await placeHold(db, { treatmentId: fx.treatments.checkup, dentistId: fx.dentists.ayd, start: T(D, at), now, ipHash: ip });
  return confirmBooking(db, { holdId: h.holdId, holdToken: h.holdToken, patient, now, ipHash: ip });
}

const row = async (id: string) => (await db.select().from(entries).where(eq(entries.id, id)))[0];
const sentTo = async (id: string, kind: string) =>
  (await db.select().from(emailLog).where(eq(emailLog.appointmentId, id))).filter((r) => r.kind === kind).map((r) => r.toAddress);

describe("contact details are stored per appointment", () => {
  it("a second booking with the same phone cannot take over the first one's contact details", async () => {
    const a = await book("11:00", { name: "Ayla A", phone: "0532 111 2233", email: "a@x.com", locale: "en" }, "ip-a");
    const b = await book("14:00", { name: "Mallory B", phone: "+905321112233", email: "b@y.com", locale: "tr" }, "ip-b");

    const ra = await row(a.appointmentId);
    const rb = await row(b.appointmentId);
    expect(ra.patientId).toBe(rb.patientId);
    expect([ra.contactName, ra.contactEmail, ra.contactLocale]).toEqual(["Ayla A", "a@x.com", "en"]);
    expect([rb.contactName, rb.contactEmail, rb.contactLocale]).toEqual(["Mallory B", "b@y.com", "tr"]);

    // The patient row keeps what it had: fill-only, never overwritten.
    const [p] = await db.select().from(patients);
    expect([p.name, p.email, p.locale]).toEqual(["Ayla A", "a@x.com", "en"]);

    // A's emails still go to A, B's to B.
    await cancelByStaff(db, reception, { appointmentId: a.appointmentId, now });
    expect(await sentTo(a.appointmentId, "booking_cancelled")).toEqual(["a@x.com"]);
    await moveAppointment(db, reception, { appointmentId: b.appointmentId, newStart: T(D, "15:00"), now });
    expect(await sentTo(b.appointmentId, "booking_rescheduled")).toEqual(["b@y.com"]);
  });

  it("the staff calendar shows the name typed for that booking", async () => {
    const a = await book("11:00", { name: "Ayla A", phone: "0532 111 2233", email: "a@x.com", locale: "en" }, "ip-a");
    const b = await book("14:00", { name: "Mallory B", phone: "+905321112233", email: "b@y.com", locale: "en" }, "ip-b");
    const cal = await getCalendarDay(db, reception, D, now);
    const name = (id: string) => cal.entries.find((e) => e.id === id)?.patientName;
    expect(name(a.appointmentId)).toBe("Ayla A");
    expect(name(b.appointmentId)).toBe("Mallory B");
  });

  it("staff-created appointments store their own contact details and email them", async () => {
    await book("11:00", { name: "Ayla A", phone: "0532 111 2233", email: "a@x.com", locale: "en" }, "ip-a");
    const { appointmentId } = await createStaffAppointment(db, reception, {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.kay,
      start: T(D, "10:00"),
      patient: { name: "Walk In", phone: "0532 111 2233", email: "w@z.com", locale: "tr" },
      now,
    });
    const r = await row(appointmentId);
    expect([r.contactName, r.contactEmail, r.contactLocale]).toEqual(["Walk In", "w@z.com", "tr"]);
    expect(await sentTo(appointmentId, "booking_confirmation")).toEqual(["w@z.com"]);
    const [p] = await db.select().from(patients);
    expect(p.email).toBe("a@x.com");
  });

  it("a walk-in without email gets no email, even when the patient row has one", async () => {
    await book("11:00", { name: "Ayla A", phone: "0532 111 2233", email: "a@x.com", locale: "en" }, "ip-a");
    const { appointmentId } = await createStaffAppointment(db, reception, {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.kay,
      start: T(D, "10:00"),
      patient: { name: "Walk In", phone: "0532 111 2233", email: null, locale: "en" },
      now,
    });
    const r = await row(appointmentId);
    expect(r.contactName).toBe("Walk In");
    expect(r.contactEmail).toBeNull();
    // Cancelling it must not email the address someone else typed for another booking.
    await cancelByStaff(db, reception, { appointmentId, now });
    // (It is logged as suppressed with an empty address.)
    expect(await sentTo(appointmentId, "booking_cancelled")).toEqual([""]);
  });

  it("legacy rows without contact details fall back to the patient row", async () => {
    const [p] = await db
      .insert(patients)
      .values({ name: "Seed Person", phoneE164: "+905329990000", email: "seed@example.com", locale: "tr" })
      .returning({ id: patients.id });
    const [e] = await db
      .insert(entries)
      .values({
        dentistId: fx.dentists.ayd,
        kind: "appointment",
        during: { start: T(D, "16:00"), end: T(D, "16:30") },
        treatmentId: fx.treatments.checkup,
        patientId: p.id,
        status: "booked",
        source: "online",
      })
      .returning({ id: entries.id });
    await notifyPatient(db, "booking_cancelled", e.id, { trigger: "staff", now });
    const [log] = await db.select().from(emailLog).where(eq(emailLog.appointmentId, e.id));
    expect(log.toAddress).toBe("seed@example.com");
    expect(log.locale).toBe("tr");
    const cal = await getCalendarDay(db, reception, D, now);
    expect(cal.entries.find((x) => x.id === e.id)?.patientName).toBe("Seed Person");
  });
});
