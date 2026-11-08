import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { closedDates, dentists, entries, patients, treatments, workingHours } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import type { Actor } from "@/lib/auth/roles";
import { BookingError } from "@/lib/booking/errors";
import { findOutsideHours } from "@/lib/staff/outside-hours";
import {
  addClosedDate,
  removeClosedDate,
  saveClinicHours,
  saveDentist,
  saveTreatment,
} from "@/lib/staff/settings";

const db = testDb();
let fx: Fixture;
const admin: Actor = { userId: "u-a", name: "Deniz", role: "admin", dentistId: null };
const reception: Actor = { userId: "u-r", name: "Rita", role: "receptionist", dentistId: null };

const prevDemo = process.env.DEMO_MODE;
beforeEach(async () => {
  process.env.DEMO_MODE = "";
  await resetTables(db);
  fx = await seedFixture(db);
});
afterEach(() => {
  if (prevDemo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = prevDemo;
});
afterAll(closeTestDb);

const treatment = (over: Partial<Parameters<typeof saveTreatment>[2]> = {}) => ({
  slug: "filling",
  nameEn: "Filling",
  nameTr: "Dolgu",
  descEn: "A filling.",
  descTr: "Bir dolgu.",
  durationMin: 45,
  sortOrder: 9,
  active: true,
  ...over,
});

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof BookingError) return e;
    throw e;
  }
  return null;
}

describe("settings", () => {
  it("admin saves a treatment when not demo", async () => {
    const id = await saveTreatment(db, admin, treatment());
    const [row] = await db.select().from(treatments).where(eq(treatments.id, id));
    expect(row).toMatchObject({ slug: "filling", nameEn: "Filling", durationMin: 45 });
    await saveTreatment(db, admin, treatment({ id, nameEn: "Composite filling", durationMin: 60 }));
    const [again] = await db.select().from(treatments).where(eq(treatments.id, id));
    expect(again).toMatchObject({ nameEn: "Composite filling", durationMin: 60 });
  });

  it("demo refuses with demo_disabled", async () => {
    process.env.DEMO_MODE = "1";
    const calls = [
      saveTreatment(db, admin, treatment()),
      saveClinicHours(db, admin, {
        days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "09:00", close: "17:00" })),
        lunchStart: "12:30",
        lunchEnd: "13:30",
      }),
      addClosedDate(db, admin, { date: "2026-12-25", labelEn: "X", labelTr: "Y" }),
      removeClosedDate(db, admin, "2026-12-25"),
      saveDentist(db, admin, {
        slug: "new", name: "Dr. New", titleEn: "D", titleTr: "D", bioEn: "", bioTr: "",
        sortOrder: 3, active: true, treatmentIds: [], hours: [],
      }),
    ];
    for (const c of calls) expect((await code(c))?.code).toBe("demo_disabled");
    expect(await db.select().from(treatments)).toHaveLength(3);
  });

  it("receptionist forbidden", async () => {
    expect((await code(saveTreatment(db, reception, treatment())))?.code).toBe("forbidden");
    expect((await code(addClosedDate(db, reception, { date: "2026-12-25", labelEn: "X", labelTr: "Y" })))?.code).toBe("forbidden");
    process.env.DEMO_MODE = "1";
    expect((await code(saveTreatment(db, reception, treatment())))?.code).toBe("forbidden");
  });

  it("shrinking dentist hours flags existing appointments", async () => {
    const [p] = await db
      .insert(patients)
      .values({ name: "P", phoneE164: "+905320000001", email: "p@example.com", locale: "en" })
      .returning({ id: patients.id });
    const [e] = await db
      .insert(entries)
      .values({
        dentistId: fx.dentists.ayd,
        kind: "appointment",
        during: { start: T("2026-11-11", "16:00"), end: T("2026-11-11", "16:30") },
        treatmentId: fx.treatments.checkup,
        patientId: p.id,
        status: "booked",
        source: "staff",
      })
      .returning({ id: entries.id });
    expect(await findOutsideHours(db, "2026-11-11", "2026-11-11")).toEqual([]);

    await saveDentist(db, admin, {
      id: fx.dentists.ayd, slug: "ayd", name: "Dr. Ayd", titleEn: "Dentist", titleTr: "Diş Hekimi",
      bioEn: "", bioTr: "", sortOrder: 1, active: true,
      treatmentIds: [fx.treatments.checkup],
      hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "15:00" })),
    });
    expect(await findOutsideHours(db, "2026-11-11", "2026-11-11")).toEqual([e.id]);
    const [row] = await db.select().from(entries).where(eq(entries.id, e.id));
    expect(row).toMatchObject({ active: true, status: "booked" });
    expect(await db.select().from(workingHours).where(eq(workingHours.dentistId, fx.dentists.ayd))).toHaveLength(5);

    // Clinic hours too: closing earlier flags without touching.
    await saveClinicHours(db, admin, {
      days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        open: weekday === 0 ? null : "09:00",
        close: weekday === 0 ? null : "14:00",
      })),
      lunchStart: "12:30",
      lunchEnd: "13:30",
    });
    const [still] = await db.select().from(entries).where(eq(entries.id, e.id));
    expect(still.active).toBe(true);
  });

  it("deactivating a dentist with upcoming appointments is refused with the list", async () => {
    const now = T("2026-11-10", "08:00");
    const [p] = await db
      .insert(patients)
      .values({ name: "Patient Row", phoneE164: "+905320000002", email: "p@example.com", locale: "en" })
      .returning({ id: patients.id });
    const mk = async (date: string, from: string, to: string, extra: Partial<typeof entries.$inferInsert> = {}) =>
      (
        await db
          .insert(entries)
          .values({
            dentistId: fx.dentists.ayd,
            kind: "appointment",
            during: { start: T(date, from), end: T(date, to) },
            treatmentId: fx.treatments.checkup,
            patientId: p.id,
            status: "booked",
            source: "online",
            ...extra,
          })
          .returning({ id: entries.id })
      )[0].id;
    const future = await mk("2026-11-12", "10:00", "10:30", { contactName: "Typed Name" });
    const legacy = await mk("2026-11-13", "10:00", "10:30");
    await mk("2026-11-09", "10:00", "10:30"); // past: does not block
    await mk("2026-11-12", "11:00", "11:30", { status: "cancelled", active: false }); // cancelled
    await mk("2026-11-12", "12:00", "12:30", { status: "completed" }); // not booked any more

    const input = {
      id: fx.dentists.ayd, slug: "ayd", name: "Dr. Ayd", titleEn: "Dentist", titleTr: "Diş Hekimi",
      bioEn: "", bioTr: "", sortOrder: 1, active: false,
      treatmentIds: [fx.treatments.checkup],
      hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "18:00" })),
    };
    const err = await code(saveDentist(db, admin, input, now));
    expect(err?.code).toBe("dentist_has_appointments");
    expect(err?.details).toEqual({
      appointments: [
        { id: future, start: T("2026-11-12", "10:00").toISOString(), patientName: "Typed Name" },
        { id: legacy, start: T("2026-11-13", "10:00").toISOString(), patientName: "Patient Row" },
      ],
    });
    const [d] = await db.select().from(dentists).where(eq(dentists.id, fx.dentists.ayd));
    expect(d.active).toBe(true);

    // Other edits while staying active are fine.
    await saveDentist(db, admin, { ...input, active: true, name: "Dr. Ayd R." }, now);

    await db.update(entries).set({ status: "cancelled", active: false }).where(inArray(entries.id, [future, legacy]));
    await saveDentist(db, admin, input, now);
    const [after] = await db.select().from(dentists).where(eq(dentists.id, fx.dentists.ayd));
    expect(after.active).toBe(false);
  });

  it("duration must be a multiple of 15", async () => {
    for (const durationMin of [20, 0, 255, 14]) {
      const err = await code(saveTreatment(db, admin, treatment({ durationMin })));
      expect(err?.code).toBe("invalid");
      expect((err?.details as { fields: Record<string, string> }).fields.durationMin).toBeTruthy();
    }
    expect(await db.select().from(treatments)).toHaveLength(3);
  });

  it("a duplicate slug is a field error", async () => {
    const err = await code(saveTreatment(db, admin, treatment({ slug: "checkup" })));
    expect(err?.code).toBe("invalid");
    expect((err?.details as { fields: Record<string, string> }).fields.slug).toBe("slugTaken");
  });

  it("validates hours and closed dates", async () => {
    const bad = await code(
      saveClinicHours(db, admin, {
        days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "18:00", close: "09:00" })),
        lunchStart: "12:30",
        lunchEnd: "13:30",
      }),
    );
    expect(bad?.code).toBe("invalid");
    await addClosedDate(db, admin, { date: "2026-12-25", labelEn: "Holiday", labelTr: "Tatil" });
    const dup = await code(addClosedDate(db, admin, { date: "2026-12-25", labelEn: "Again", labelTr: "Yine" }));
    expect((dup?.details as { fields: Record<string, string> }).fields.date).toBe("dateTaken");
    await removeClosedDate(db, admin, "2026-12-25");
    expect(await db.select().from(closedDates)).toHaveLength(0);
  });
});
