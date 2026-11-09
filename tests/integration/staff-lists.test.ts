import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callbackRequests, entries, patients } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import type { Actor } from "@/lib/auth/roles";
import { countNewRequests, listRequests, setRequestStatus } from "@/lib/staff/requests";
import { getPatientAppointments, searchPatients } from "@/lib/staff/patients";

const db = testDb();
const NOW = new Date(NOW_ISO);
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

const reception: Actor = { userId: "u-r", name: "Rita", role: "receptionist", dentistId: null };
const drAyd = (): Actor => ({ userId: "u-ayd", name: "Dr. Ayd", role: "dentist", dentistId: fx.dentists.ayd });
const drKay = (): Actor => ({ userId: "u-kay", name: "Dr. Kay", role: "dentist", dentistId: fx.dentists.kay });

async function request(name: string, status: "new" | "contacted" | "closed", minsAgo: number) {
  const [r] = await db
    .insert(callbackRequests)
    .values({
      name,
      phoneE164: "+905321110000",
      locale: "tr",
      status,
      ipHash: "x",
      createdAt: new Date(NOW.getTime() - minsAgo * 60_000),
    })
    .returning({ id: callbackRequests.id });
  return r.id;
}

let seq = 0;
async function patient(name: string, phone = `+90532777${String(++seq).padStart(4, "0")}`) {
  const [p] = await db
    .insert(patients)
    .values({ name, phoneE164: phone, email: "p@example.com", locale: "tr" })
    .returning({ id: patients.id });
  return p.id;
}
async function appt(patientId: string, dentistId: number, date: string, from: string, status: "booked" | "completed" | "cancelled" = "booked") {
  const [h] = from.split(":");
  const [r] = await db
    .insert(entries)
    .values({
      dentistId,
      kind: "appointment",
      during: { start: T(date, from), end: T(date, `${h}:30`) },
      treatmentId: fx.treatments.checkup,
      patientId,
      status,
      active: status !== "cancelled",
      source: "staff",
    })
    .returning({ id: entries.id });
  return r.id;
}

describe("requests", () => {
  it("requests filter and status change", async () => {
    const a = await request("Old", "new", 60);
    const b = await request("Newer", "new", 5);
    await request("Done", "closed", 30);

    expect((await listRequests(db, reception, "new")).map((r) => r.name)).toEqual(["Newer", "Old"]);
    expect(await listRequests(db, reception, "all")).toHaveLength(3);
    expect(await countNewRequests(db, reception)).toBe(2);

    await setRequestStatus(db, reception, a, "contacted");
    expect((await listRequests(db, reception, "contacted")).map((r) => r.name)).toEqual(["Old"]);
    expect((await listRequests(db, reception, "new")).map((r) => r.id)).toEqual([b]);
    expect(await countNewRequests(db, reception)).toBe(1);
  });

  it("dentist cannot list requests", async () => {
    const id = await request("X", "new", 1);
    await expect(listRequests(db, drAyd(), "all")).rejects.toMatchObject({ code: "forbidden" });
    await expect(setRequestStatus(db, drAyd(), id, "closed")).rejects.toMatchObject({ code: "forbidden" });
    await expect(countNewRequests(db, drAyd())).resolves.toBe(0);
  });

  it("setRequestStatus on an unknown id is not_found", async () => {
    await expect(
      setRequestStatus(db, reception, "00000000-0000-4000-8000-000000000000", "closed"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("patients", () => {
  it("patient search by Turkish name and by phone fragment \"532111\"", async () => {
    await patient("Ayşe Yılmaz", "+905321112233");
    await patient("AYŞE DEMİR");
    await patient("Ismail Işık");
    await patient("Michael Turner", "+447700900123");
    const names = async (q: string) => (await searchPatients(db, reception, q, NOW)).map((p) => p.name);

    expect(await names("ayşe")).toEqual(["AYŞE DEMİR", "Ayşe Yılmaz"]);
    expect(await names("AYŞE")).toEqual(["AYŞE DEMİR", "Ayşe Yılmaz"]);
    expect(await names("ayse")).toEqual(["AYŞE DEMİR", "Ayşe Yılmaz"]);
    expect(await names("demir")).toEqual(["AYŞE DEMİR"]);
    expect(await names("İsmail")).toEqual(["Ismail Işık"]);
    expect(await names("ısık")).toEqual(["Ismail Işık"]);
    expect(await names("100%")).toEqual([]);
    expect(await names("532111")).toEqual(["Ayşe Yılmaz"]);
    expect(await names("0532 111")).toEqual(["Ayşe Yılmaz"]);
    expect(await names("+44 7700")).toEqual(["Michael Turner"]);
    expect(await names("")).toHaveLength(4);
  });

  it("counts upcoming and past appointments, ignoring cancelled", async () => {
    const p = await patient("Ayşe Yılmaz");
    await appt(p, fx.dentists.ayd, "2026-11-12", "10:00");
    await appt(p, fx.dentists.ayd, "2026-11-03", "10:00", "completed");
    await appt(p, fx.dentists.ayd, "2026-11-13", "10:00", "cancelled");
    const [row] = await searchPatients(db, reception, "ayşe", NOW);
    expect(row).toMatchObject({ id: p, upcoming: 1, past: 1, phone: expect.stringMatching(/^\+90/) });
    const d = await getPatientAppointments(db, reception, p, NOW);
    expect(d.upcoming).toHaveLength(1);
    expect(d.past.map((a) => a.status).sort()).toEqual(["cancelled", "completed"]);
    expect(d.upcoming[0]).toMatchObject({ dentistName: "Dr. Ayd", date: "2026-11-12", time: "10:00" });
  });

  it("dentist sees only own patients", async () => {
    const mine = await patient("Ayşe Yılmaz");
    const theirs = await patient("Ayla Kaya");
    const both = await patient("Ayten Öz");
    await appt(mine, fx.dentists.ayd, "2026-11-12", "10:00");
    await appt(theirs, fx.dentists.kay, "2026-11-12", "11:00");
    await appt(both, fx.dentists.ayd, "2026-11-12", "12:00");
    await appt(both, fx.dentists.kay, "2026-11-13", "10:00");
    await patient("Nobody Booked");

    const list = (await searchPatients(db, drAyd(), "ay", NOW)).map((p) => p.name);
    expect(list).toEqual(["Ayşe Yılmaz", "Ayten Öz"]);
    expect(await searchPatients(db, drAyd(), "", NOW)).toHaveLength(2);
    const [t] = await searchPatients(db, drAyd(), "ayten", NOW);
    expect(t.upcoming).toBe(1);
    expect((await getPatientAppointments(db, drAyd(), both, NOW)).upcoming).toHaveLength(1);
    await expect(getPatientAppointments(db, drAyd(), theirs, NOW)).rejects.toMatchObject({ code: "not_found" });
    expect((await searchPatients(db, drKay(), "ayten", NOW))[0].upcoming).toBe(1);
  });
});
