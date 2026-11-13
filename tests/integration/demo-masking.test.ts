import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { callbackRequests, entries, patients } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import type { Actor } from "@/lib/auth/roles";
import { getCalendarDay, getCalendarWeek } from "@/lib/staff/calendar-data";
import { getPatientAppointments, searchPatients } from "@/lib/staff/patients";
import { listRequests } from "@/lib/staff/requests";

const db = testDb();
const now = new Date(NOW_ISO);
const D = "2026-11-10";
let fx: Fixture;
const reception: Actor = { userId: "u-rec", name: "Rec", role: "receptionist", dentistId: null };
const PHONE = "+905321112233";
const MASKED_PHONE = "+90 5•• ••• •• 33";

const prevDemo = process.env.DEMO_MODE;
beforeEach(async () => {
  process.env.DEMO_MODE = "1";
  await resetTables(db);
  fx = await seedFixture(db);
});
afterEach(() => {
  if (prevDemo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = prevDemo;
});
afterAll(closeTestDb);

async function appt(source: "online" | "staff", from: string, phone = PHONE) {
  const [p] = await db
    .insert(patients)
    .values({ name: "Ayla A", phoneE164: phone, email: "ayla@mail.test", locale: "en" })
    .onConflictDoNothing()
    .returning({ id: patients.id });
  const patientId = p?.id ?? (await db.select({ id: patients.id }).from(patients))[0].id;
  const [h] = from.split(":");
  const [r] = await db
    .insert(entries)
    .values({
      dentistId: fx.dentists.ayd,
      kind: "appointment",
      during: { start: T(D, from), end: T(D, `${h}:30`) },
      treatmentId: fx.treatments.checkup,
      patientId,
      status: "booked",
      source,
      contactName: "Ayla A",
      contactEmail: "ayla@mail.test",
      contactLocale: "en",
    })
    .returning({ id: entries.id });
  return { id: r.id, patientId };
}

const phoneOf = (list: { id: string; patientPhone?: string }[], id: string) => list.find((e) => e.id === id)?.patientPhone;

describe("demo mode shows full contact details only for the visitor's own bookings", () => {
  it("calendar: an online appointment is masked, unless it is in this browser's mine list", async () => {
    const a = await appt("online", "11:00");
    const day = await getCalendarDay(db, reception, D, now, { mine: [] });
    expect(phoneOf(day.entries, a.id)).toBe(MASKED_PHONE);
    expect(day.entries.find((e) => e.id === a.id)?.contactMasked).toBe(true);
    expect(JSON.stringify(day)).not.toContain(PHONE);

    const mine = await getCalendarDay(db, reception, D, now, { mine: [a.id] });
    expect(phoneOf(mine.entries, a.id)).toBe(PHONE);
    expect(mine.entries.find((e) => e.id === a.id)?.contactMasked).toBeFalsy();

    const week = await getCalendarWeek(db, reception, fx.dentists.ayd, "2026-11-09", now, { mine: [] });
    expect(phoneOf(week.entries, a.id)).toBe(MASKED_PHONE);
  });

  it("calendar: staff-created appointments are masked too, unless in this browser's mine list", async () => {
    // Another demo visitor signed in as staff may have typed someone's real number.
    const a = await appt("staff", "11:00");
    const day = await getCalendarDay(db, reception, D, now, { mine: [] });
    expect(phoneOf(day.entries, a.id)).toBe(MASKED_PHONE);
    expect(day.entries.find((e) => e.id === a.id)?.contactMasked).toBe(true);
    const own = await getCalendarDay(db, reception, D, now, { mine: [a.id] });
    expect(phoneOf(own.entries, a.id)).toBe(PHONE);
  });

  it("calendar: live mode never masks", async () => {
    process.env.DEMO_MODE = "";
    const a = await appt("online", "11:00");
    const day = await getCalendarDay(db, reception, D, now, { mine: [] });
    expect(phoneOf(day.entries, a.id)).toBe(PHONE);
  });

  it("patients: masked when the patient has an online booking from someone else", async () => {
    const a = await appt("online", "11:00");
    const [row] = await searchPatients(db, reception, "", now);
    expect(row.phone).toBe(MASKED_PHONE);
    expect(row.email).toBe("a•••@mail.test");
    expect(JSON.stringify(await searchPatients(db, reception, "", now))).not.toContain("ayla@mail.test");
    const detail = await getPatientAppointments(db, reception, a.patientId, now);
    expect(detail.patient.phone).toBe(MASKED_PHONE);
    expect(detail.patient.email).toBe("a•••@mail.test");

    const [own] = await searchPatients(db, reception, "", now, { mine: [a.id] });
    expect(own.phone).toBe(PHONE);
    expect(own.email).toBe("ayla@mail.test");
    const ownDetail = await getPatientAppointments(db, reception, a.patientId, now, { mine: [a.id] });
    expect(ownDetail.patient.phone).toBe(PHONE);
  });

  it("patients: still masked when only one of the patient's online bookings is mine", async () => {
    // Someone booking with a victim's phone must not see the victim's stored email.
    const victim = await appt("online", "11:00");
    const attacker = await appt("online", "14:00");
    expect(victim.patientId).toBe(attacker.patientId);
    const [row] = await searchPatients(db, reception, "", now, { mine: [attacker.id] });
    expect(row.email).toBe("a•••@mail.test");
  });

  it("patients: a patient with only staff-created bookings is masked unless one is mine", async () => {
    const a = await appt("staff", "11:00");
    const [row] = await searchPatients(db, reception, "", now);
    expect(row.phone).toBe(MASKED_PHONE);
    expect(row.email).toBe("a•••@mail.test");
    expect(row.contactMasked).toBe(true);
    const detail = await getPatientAppointments(db, reception, a.patientId, now);
    expect(detail.patient.phone).toBe(MASKED_PHONE);
    const [own] = await searchPatients(db, reception, "", now, { mine: [a.id] });
    expect(own.phone).toBe(PHONE);
  });

  it("patients: a patient with no appointments at all is masked in demo mode", async () => {
    await db.insert(patients).values({ name: "No Visits", phoneE164: PHONE, email: "nv@mail.test", locale: "en" });
    const [row] = await searchPatients(db, reception, "", now);
    expect(row.phone).toBe(MASKED_PHONE);
  });

  it("patients: still masked when a staff-created booking for the same patient isn't mine", async () => {
    const other = await appt("staff", "11:00");
    const mine = await appt("online", "14:00");
    expect(other.patientId).toBe(mine.patientId);
    const [row] = await searchPatients(db, reception, "", now, { mine: [mine.id] });
    expect(row.email).toBe("a•••@mail.test");
  });

  it("patients: partial phone digits do not find masked rows (no digit-by-digit oracle)", async () => {
    await appt("online", "11:00");
    expect(await searchPatients(db, reception, "2233", now)).toHaveLength(0);
    expect(await searchPatients(db, reception, "532111223", now)).toHaveLength(0);
    // The full number still finds them (the receptionist already knows it), with or without 0 / +90.
    expect(await searchPatients(db, reception, "0532 111 22 33", now)).toHaveLength(1);
    expect(await searchPatients(db, reception, "+90 532 111 22 33", now)).toHaveLength(1);
    // Unmasked rows (this browser's own booking) keep partial matching.
    const [only] = await db.select({ id: entries.id }).from(entries);
    expect(await searchPatients(db, reception, "2233", now, { mine: [only.id] })).toHaveLength(1);
  });

  it("patients: live mode never masks", async () => {
    process.env.DEMO_MODE = "";
    await appt("online", "11:00");
    const [row] = await searchPatients(db, reception, "", now);
    expect(row.phone).toBe(PHONE);
    expect(row.email).toBe("ayla@mail.test");
  });

  it("call-back requests: phone and message are masked in demo, shown in live mode", async () => {
    await db.insert(callbackRequests).values({ name: "Caller", phoneE164: PHONE, locale: "en", message: "Call me at home", ipHash: "x" });
    const [r] = await listRequests(db, reception, "all");
    expect(r.phone).toBe(MASKED_PHONE);
    expect(r.message).toBeNull();
    expect(r.masked).toBe(true);
    expect(JSON.stringify(await listRequests(db, reception, "all"))).not.toMatch(/Call me|905321112233/);

    process.env.DEMO_MODE = "";
    const [live] = await listRequests(db, reception, "all");
    expect(live.phone).toBe(PHONE);
    expect(live.message).toBe("Call me at home");
    expect(live.masked).toBe(false);
  });
});
