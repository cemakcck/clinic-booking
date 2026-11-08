import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closedDates, emailLog, entries, patients, workingHours } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import type { Actor } from "@/lib/auth/roles";
import { BookingError } from "@/lib/booking/errors";
import { countPublicSlots } from "@/lib/booking/availability";
import { placeHold } from "@/lib/booking/holds";
import {
  cancelByStaff,
  createStaffAppointment,
  moveAppointment,
  setStatus,
} from "@/lib/staff/appointments";
import { findOutsideHours } from "@/lib/staff/outside-hours";

const db = testDb();
const now = new Date(NOW_ISO); // Tue 2026-11-10 08:00
const D = "2026-11-10";
const WED = "2026-11-11";
let fx: Fixture;

const prevDemo = process.env.DEMO_MODE;
beforeEach(async () => {
  delete process.env.DEMO_MODE;
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(async () => {
  if (prevDemo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = prevDemo;
  await closeTestDb();
});

const reception: Actor = { userId: "u-rec", name: "Rec", role: "receptionist", dentistId: null };
const drAyd = (): Actor => ({ userId: "u-ayd", name: "Dr. Ayd", role: "dentist", dentistId: fx.dentists.ayd });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof BookingError ? e.code : e;
  }
  return "no error";
};

let phoneSeq = 0;
async function appt(
  dentistId: number,
  date: string,
  from: string,
  to: string,
  o: { treatmentId?: number; email?: string } = {},
): Promise<string> {
  const [p] = await db
    .insert(patients)
    .values({
      name: "Ayşe Yılmaz",
      phoneE164: `+90532111${String(++phoneSeq).padStart(4, "0")}`,
      email: o.email ?? "ayse@mail.test",
      locale: "tr",
    })
    .returning({ id: patients.id });
  const [r] = await db
    .insert(entries)
    .values({
      dentistId,
      kind: "appointment",
      during: { start: T(date, from), end: T(date, to) },
      treatmentId: o.treatmentId ?? fx.treatments.checkup,
      patientId: p.id,
      status: "booked",
      source: "online",
    })
    .returning({ id: entries.id });
  return r.id;
}

async function block(dentistId: number, date: string, from: string, to: string) {
  await db.insert(entries).values({
    dentistId,
    kind: "block",
    during: { start: T(date, from), end: T(date, to) },
    blockReason: "other",
  });
}

const rowOf = async (id: string) => (await db.select().from(entries).where(eq(entries.id, id)))[0];

describe("moveAppointment", () => {
  it("receptionist moves to another dentist who performs the treatment", async () => {
    const id = await appt(fx.dentists.ayd, WED, "10:00", "10:30");
    await moveAppointment(db, reception, { appointmentId: id, newStart: T(WED, "14:00"), newDentistId: fx.dentists.kay, now });
    const r = await rowOf(id);
    expect(r.dentistId).toBe(fx.dentists.kay);
    expect(r.during).toEqual({ start: T(WED, "14:00"), end: T(WED, "14:30") });
    const [mail] = await db.select().from(emailLog).where(eq(emailLog.appointmentId, id));
    expect(mail).toMatchObject({ kind: "booking_rescheduled", trigger: "staff" });
  });

  it("move to a dentist who doesn't perform it gives outside_rules", async () => {
    const id = await appt(fx.dentists.ayd, WED, "10:00", "11:00", { treatmentId: fx.treatments.whitening });
    expect(
      await code(moveAppointment(db, reception, { appointmentId: id, newStart: T(WED, "14:00"), newDentistId: fx.dentists.kay, now })),
    ).toBe("outside_rules");
    expect((await rowOf(id)).dentistId).toBe(fx.dentists.ayd);
  });

  it("dentist cannot move another dentist's appointment gives forbidden", async () => {
    const id = await appt(fx.dentists.kay, WED, "10:00", "10:30");
    expect(await code(moveAppointment(db, drAyd(), { appointmentId: id, newStart: T(WED, "14:00"), now }))).toBe("forbidden");
  });

  it("dentist cannot move own appointment to another dentist gives forbidden", async () => {
    const id = await appt(fx.dentists.ayd, WED, "10:00", "10:30");
    expect(
      await code(moveAppointment(db, drAyd(), { appointmentId: id, newStart: T(WED, "14:00"), newDentistId: fx.dentists.kay, now })),
    ).toBe("forbidden");
    // ...but may move it on their own calendar.
    await moveAppointment(db, drAyd(), { appointmentId: id, newStart: T(WED, "14:00"), now });
    expect((await rowOf(id)).during.start).toEqual(T(WED, "14:00"));
  });

  it("onto a taken time gives slot_taken; into lunch gives outside_rules", async () => {
    const id = await appt(fx.dentists.ayd, WED, "10:00", "10:30");
    await appt(fx.dentists.ayd, WED, "15:00", "15:30");
    expect(await code(moveAppointment(db, reception, { appointmentId: id, newStart: T(WED, "15:15"), now }))).toBe("slot_taken");
    expect(await code(moveAppointment(db, reception, { appointmentId: id, newStart: T(WED, "12:30"), now }))).toBe("outside_rules");
  });

  it("drag race: a move and a booking on the same slot, exactly one wins", async () => {
    for (let round = 0; round < 8; round++) {
      await resetTables(db);
      fx = await seedFixture(db);
      const id = await appt(fx.dentists.ayd, WED, "10:00", "10:30");
      const results = await Promise.allSettled([
        moveAppointment(db, reception, { appointmentId: id, newStart: T(D, "11:00"), now }),
        placeHold(db, { treatmentId: fx.treatments.checkup, dentistId: fx.dentists.ayd, start: T(D, "11:00"), now, ipHash: `ip-race-${round}` }),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const bad = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect({ round, ok: ok.length }).toEqual({ round, ok: 1 });
      expect((bad[0].reason as BookingError).code).toBe("slot_taken");
      const live = await db
        .select()
        .from(entries)
        .where(and(eq(entries.dentistId, fx.dentists.ayd), eq(entries.active, true)));
      expect(live.filter((e) => e.during.start.getTime() === T(D, "11:00").getTime())).toHaveLength(1);
    }
  });
});

describe("createStaffAppointment", () => {
  const patient = { name: "Çağlar Öztürk", phone: "0532 999 8877", email: null, locale: "tr" as const };

  it("walk-in in the past hour is allowed for staff", async () => {
    const later = T(D, "10:20");
    const { appointmentId } = await createStaffAppointment(db, reception, {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.ayd,
      start: T(D, "10:00"),
      patient,
      now: later,
    });
    const r = await rowOf(appointmentId);
    expect(r).toMatchObject({ kind: "appointment", status: "booked", source: "staff", createdBy: "u-rec" });
    expect(r.manageTokenHash).toBeNull();
    // More than an hour ago is too far back.
    expect(
      await code(
        createStaffAppointment(db, reception, { treatmentId: fx.treatments.checkup, dentistId: fx.dentists.kay, start: T(D, "09:00"), patient, now: later }),
      ),
    ).toBe("outside_rules");
  });

  it("with an email: manage token and a logged confirmation in demo", async () => {
    process.env.DEMO_MODE = "1";
    const { appointmentId } = await createStaffAppointment(db, reception, {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.ayd,
      start: T(WED, "10:00"),
      patient: { ...patient, email: "caglar@mail.test" },
      now,
    });
    expect((await rowOf(appointmentId)).manageTokenHash).toMatch(/^[0-9a-f]{64}$/);
    const [mail] = await db.select().from(emailLog).where(eq(emailLog.appointmentId, appointmentId));
    expect(mail).toMatchObject({ kind: "booking_confirmation", status: "logged", trigger: "staff" });
  });

  it("a walk-in without an email keeps the email already on file", async () => {
    await db.insert(patients).values({ name: "Old", phoneE164: "+905329998877", email: "keep@mail.test", locale: "en" });
    await createStaffAppointment(db, reception, {
      treatmentId: fx.treatments.checkup,
      dentistId: fx.dentists.ayd,
      start: T(WED, "10:00"),
      patient,
      now,
    });
    const [p] = await db.select().from(patients).where(eq(patients.phoneE164, "+905329998877"));
    expect(p).toMatchObject({ name: "Çağlar Öztürk", email: "keep@mail.test", locale: "tr" });
  });

  it("dentist creates on own calendar only; bad phone is invalid", async () => {
    const q = { treatmentId: fx.treatments.checkup, start: T(WED, "10:00"), patient, now };
    expect(await code(createStaffAppointment(db, drAyd(), { ...q, dentistId: fx.dentists.kay }))).toBe("forbidden");
    await createStaffAppointment(db, drAyd(), { ...q, dentistId: fx.dentists.ayd });
    expect(
      await code(createStaffAppointment(db, reception, { ...q, dentistId: fx.dentists.kay, patient: { ...patient, phone: "12" } })),
    ).toBe("invalid");
  });
});

describe("cancelByStaff and setStatus", () => {
  it("staff cancel in demo logs the email instead of sending", async () => {
    process.env.DEMO_MODE = "1";
    const id = await appt(fx.dentists.ayd, WED, "10:00", "10:30");
    await cancelByStaff(db, reception, { appointmentId: id, now });
    const r = await rowOf(id);
    expect(r).toMatchObject({ status: "cancelled", active: false, cancelledBy: "staff" });
    const [mail] = await db.select().from(emailLog).where(eq(emailLog.appointmentId, id));
    expect(mail).toMatchObject({ kind: "booking_cancelled", status: "logged", trigger: "staff" });
  });

  it("dentist cannot cancel another dentist's appointment", async () => {
    const id = await appt(fx.dentists.kay, WED, "10:00", "10:30");
    expect(await code(cancelByStaff(db, drAyd(), { appointmentId: id, now }))).toBe("forbidden");
  });

  it("status transitions follow the lifecycle", async () => {
    const id = await appt(fx.dentists.ayd, WED, "10:00", "10:30");
    await setStatus(db, drAyd(), { appointmentId: id, status: "arrived" });
    await setStatus(db, drAyd(), { appointmentId: id, status: "completed" });
    expect((await rowOf(id)).status).toBe("completed");
    expect(await code(setStatus(db, drAyd(), { appointmentId: id, status: "no_show" }))).toBe("invalid");

    const other = await appt(fx.dentists.kay, WED, "10:00", "10:30");
    expect(await code(setStatus(db, drAyd(), { appointmentId: other, status: "arrived" }))).toBe("forbidden");
    await cancelByStaff(db, reception, { appointmentId: other, now });
    expect(await code(setStatus(db, reception, { appointmentId: other, status: "booked" }))).toBe("invalid");
  });
});

describe("capacity floor", () => {
  it("capacity floor refuses a move in demo that drains a day", async () => {
    // Today, public (2h lead, 30-minute probe): Ayd free 17:00-18:00 (3 starts), Kay 17:30-18:00 (1).
    await block(fx.dentists.ayd, D, "09:00", "17:00");
    await block(fx.dentists.kay, D, "09:00", "17:30");
    expect(await countPublicSlots(db, D, now)).toBe(4);
    const id = await appt(fx.dentists.ayd, WED, "10:00", "10:30");
    const move = () => moveAppointment(db, reception, { appointmentId: id, newStart: T(D, "17:00"), now });

    process.env.DEMO_MODE = "1";
    expect(await code(move())).toBe("capacity_floor");
    expect((await rowOf(id)).during.start).toEqual(T(WED, "10:00"));

    process.env.DEMO_MODE = "";
    await move();
    expect((await rowOf(id)).during.start).toEqual(T(D, "17:00"));
  });

  it("capacity floor refuses a staff appointment in demo that drains a day", async () => {
    await block(fx.dentists.ayd, D, "09:00", "17:00");
    await block(fx.dentists.kay, D, "09:00", "17:30");
    process.env.DEMO_MODE = "1";
    expect(
      await code(
        createStaffAppointment(db, reception, {
          treatmentId: fx.treatments.checkup,
          dentistId: fx.dentists.kay,
          start: T(D, "17:30"),
          patient: { name: "Ali Veli", phone: "05321234567", locale: "en" },
          now,
        }),
      ),
    ).toBe("capacity_floor");
    expect(await db.select().from(patients)).toHaveLength(0);
  });
});

describe("findOutsideHours", () => {
  it("findOutsideHours flags an appointment after hours shrink", async () => {
    const late = await appt(fx.dentists.ayd, WED, "17:00", "17:30");
    const early = await appt(fx.dentists.ayd, WED, "10:00", "10:30");
    const kays = await appt(fx.dentists.kay, WED, "17:00", "17:30");
    expect(await findOutsideHours(db, D, "2026-11-13")).toEqual([]);

    await db
      .update(workingHours)
      .set({ end: "16:00" })
      .where(and(eq(workingHours.dentistId, fx.dentists.ayd), eq(workingHours.weekday, 3)));
    expect(await findOutsideHours(db, D, "2026-11-13")).toEqual([late]);
    expect(await findOutsideHours(db, "2026-11-12", "2026-11-13")).toEqual([]);
    void early;
    void kays;
  });

  it("flags closed dates, lunch overlaps and ignores cancelled ones", async () => {
    const lunch = await appt(fx.dentists.kay, WED, "12:15", "12:45");
    const cancelled = await appt(fx.dentists.ayd, "2026-11-12", "11:00", "11:30");
    await cancelByStaff(db, reception, { appointmentId: cancelled, now });
    const thu = await appt(fx.dentists.ayd, "2026-11-12", "10:00", "10:30");
    await db.insert(closedDates).values({ date: "2026-11-12", labelEn: "Holiday", labelTr: "Tatil" });
    expect((await findOutsideHours(db, D, "2026-11-13")).sort()).toEqual([lunch, thu].sort());
  });
});
