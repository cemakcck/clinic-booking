import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { entries, patients } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import { BookingError } from "@/lib/booking/errors";
import { getDaySlots } from "@/lib/booking/availability";
import { insertEntry } from "@/lib/booking/entries";
import { cancelByPatient, getByManageToken, rescheduleByPatient } from "@/lib/booking/manage";
import { hashToken } from "@/lib/security/tokens";

const db = testDb();
const now = new Date(NOW_ISO);
const D = "2026-11-12"; // Thursday, more than 24h after now
const TOKEN = "manage-token-manage-token-manage-token-1";
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

async function book(date: string, from: string, to: string, token = TOKEN) {
  const [p] = await db
    .insert(patients)
    .values({ name: "Test Patient", phoneE164: "+905321112233", email: "p@example.com", locale: "en" })
    .onConflictDoNothing()
    .returning({ id: patients.id });
  const patientId = p?.id ?? (await db.select({ id: patients.id }).from(patients))[0].id;
  return insertEntry(
    db,
    {
      dentistId: fx.dentists.ayd,
      kind: "appointment",
      during: { start: T(date, from), end: T(date, to) },
      treatmentId: fx.treatments.checkup,
      patientId,
      status: "booked",
      source: "online",
      manageTokenHash: hashToken(token),
    },
    now,
  );
}

const row = async (id: string) => (await db.select().from(entries).where(eq(entries.id, id)))[0];
const free = async (date: string) =>
  (await getDaySlots(db, { treatmentId: fx.treatments.checkup, dentistId: fx.dentists.ayd, date, now, audience: "public" })).map(
    (s) => s.start.getTime(),
  );
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof BookingError) return e.code;
    throw e;
  }
  return null;
};

describe("getByManageToken", () => {
  it("returns the view with canChange", async () => {
    const id = await book(D, "10:00", "10:30");
    const v = await getByManageToken(db, TOKEN, now);
    expect(v).toMatchObject({ appointmentId: id, treatmentName: "Check-up", dentistName: "Dr. Ayd", status: "booked", canChange: true });
    expect(v?.start).toEqual(T(D, "10:00"));
  });
  it("unknown token gives null", async () => {
    expect(await getByManageToken(db, "nope", now)).toBeNull();
  });
  it("link expires after the appointment", async () => {
    await book(D, "10:00", "10:30");
    expect(await getByManageToken(db, TOKEN, new Date(T(D, "10:30").getTime() - 60_000))).not.toBeNull();
    expect(await getByManageToken(db, TOKEN, new Date(T(D, "10:30").getTime() + 60_000))).toBeNull();
  });
});

describe("cancelByPatient", () => {
  it("cancel frees the slot", async () => {
    const id = await book(D, "10:00", "10:30");
    expect(await free(D)).not.toContain(T(D, "10:00").getTime());
    await cancelByPatient(db, TOKEN, now);
    expect(await row(id)).toMatchObject({ status: "cancelled", active: false, cancelledBy: "patient" });
    expect(await free(D)).toContain(T(D, "10:00").getTime());
    expect((await getByManageToken(db, TOKEN, now))?.status).toBe("cancelled");
    expect((await getByManageToken(db, TOKEN, now))?.canChange).toBe(false);
  });
  it("cancelling twice is harmless", async () => {
    await book(D, "10:00", "10:30");
    await cancelByPatient(db, TOKEN, now);
    await cancelByPatient(db, TOKEN, now);
  });
  it("cannot change within 24h", async () => {
    // now is Tue 08:00; Wed 07:00 is 23h away.
    await book("2026-11-11", "07:00", "07:30");
    expect((await getByManageToken(db, TOKEN, now))?.canChange).toBe(false);
    expect(await codeOf(cancelByPatient(db, TOKEN, now))).toBe("too_late");
    expect(await codeOf(rescheduleByPatient(db, TOKEN, T(D, "11:00"), now))).toBe("too_late");
  });
  it("exactly 24h is still allowed", async () => {
    await book("2026-11-11", "08:00", "08:30");
    expect((await getByManageToken(db, TOKEN, now))?.canChange).toBe(true);
  });
  it("after the appointment is link_expired; unknown token is not_found", async () => {
    await book(D, "10:00", "10:30");
    expect(await codeOf(cancelByPatient(db, TOKEN, T(D, "11:00")))).toBe("link_expired");
    expect(await codeOf(cancelByPatient(db, "nope", now))).toBe("not_found");
  });
  it("only a booked appointment can be cancelled", async () => {
    const id = await book(D, "10:00", "10:30");
    await db.update(entries).set({ status: "arrived" }).where(eq(entries.id, id));
    expect(await codeOf(cancelByPatient(db, TOKEN, now))).toBe("too_late");
  });
});

describe("rescheduleByPatient", () => {
  it("moves the same row; the old slot is free", async () => {
    const id = await book(D, "10:00", "10:30");
    await rescheduleByPatient(db, TOKEN, T(D, "15:00"), now);
    const r = await row(id);
    expect(r.during).toEqual({ start: T(D, "15:00"), end: T(D, "15:30") });
    expect(r.dentistId).toBe(fx.dentists.ayd);
    expect(r.status).toBe("booked");
    expect(await free(D)).toContain(T(D, "10:00").getTime());
    expect(await free(D)).not.toContain(T(D, "15:00").getTime());
  });
  it("onto a taken slot gives slot_taken", async () => {
    await book(D, "10:00", "10:30");
    await book(D, "15:00", "15:30", "other-token-other-token-other-token-2");
    expect(await codeOf(rescheduleByPatient(db, TOKEN, T(D, "15:00"), now))).toBe("slot_taken");
  });
  it("may overlap its own old range", async () => {
    const id = await book(D, "10:00", "10:30");
    await rescheduleByPatient(db, TOKEN, T(D, "10:15"), now);
    expect((await row(id)).during).toEqual({ start: T(D, "10:15"), end: T(D, "10:45") });
  });
  it("outside the rules (Sunday, past the horizon, lunch) gives outside_rules", async () => {
    await book(D, "10:00", "10:30");
    expect(await codeOf(rescheduleByPatient(db, TOKEN, T("2026-11-15", "10:00"), now))).toBe("outside_rules");
    expect(await codeOf(rescheduleByPatient(db, TOKEN, T(D, "13:00"), now))).toBe("outside_rules");
    expect(await codeOf(rescheduleByPatient(db, TOKEN, T("2027-03-01", "10:00"), now))).toBe("outside_rules");
  });
  it("a cancelled appointment cannot be rescheduled", async () => {
    await book(D, "10:00", "10:30");
    await cancelByPatient(db, TOKEN, now);
    expect(await codeOf(rescheduleByPatient(db, TOKEN, T(D, "15:00"), now))).toBe("too_late");
  });
});
