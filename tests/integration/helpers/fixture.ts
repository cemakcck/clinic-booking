import {
  clinicHours,
  clinicSettings,
  dentists,
  dentistTreatments,
  treatments,
  workingHours,
} from "@/lib/db/schema";
import type { Db } from "@/lib/db/client";

export type Fixture = {
  dentists: { ayd: number; kay: number };
  treatments: { checkup: number; whitening: number; rootcanal: number };
};

/** The fixed test "now": a Tuesday, 08:00 Istanbul time. */
export const NOW_ISO = "2026-11-10T08:00:00+03:00";

export async function seedFixture(db: Db): Promise<Fixture> {
  await db.insert(clinicHours).values([
    ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, open: "09:00", close: "18:00" })),
    { weekday: 6, open: "10:00", close: "14:00" },
    { weekday: 0, open: null, close: null },
  ]);
  await db.insert(clinicSettings).values({ id: 1, lunchStart: "12:30", lunchEnd: "13:30" });

  const [ayd, kay] = await db
    .insert(dentists)
    .values([
      { slug: "ayd", name: "Dr. Ayd", titleEn: "Dentist", titleTr: "Diş Hekimi", bioEn: "", bioTr: "", sortOrder: 1 },
      { slug: "kay", name: "Dr. Kay", titleEn: "Dentist", titleTr: "Diş Hekimi", bioEn: "", bioTr: "", sortOrder: 2 },
    ])
    .returning({ id: dentists.id });

  const [checkup, whitening, rootcanal] = await db
    .insert(treatments)
    .values([
      { slug: "checkup", nameEn: "Check-up", nameTr: "Kontrol", descEn: "", descTr: "", durationMin: 30, sortOrder: 1 },
      { slug: "whitening", nameEn: "Whitening", nameTr: "Beyazlatma", descEn: "", descTr: "", durationMin: 60, sortOrder: 2 },
      { slug: "rootcanal", nameEn: "Root canal", nameTr: "Kanal tedavisi", descEn: "", descTr: "", durationMin: 90, sortOrder: 3 },
    ])
    .returning({ id: treatments.id });

  await db.insert(dentistTreatments).values([
    { dentistId: ayd.id, treatmentId: checkup.id },
    { dentistId: kay.id, treatmentId: checkup.id },
    { dentistId: ayd.id, treatmentId: whitening.id },
    { dentistId: kay.id, treatmentId: rootcanal.id },
  ]);

  const hours = [
    ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "18:00" })),
    { weekday: 6, start: "10:00", end: "14:00" },
  ];
  await db
    .insert(workingHours)
    .values([ayd.id, kay.id].flatMap((dentistId) => hours.map((h) => ({ dentistId, ...h }))));

  return {
    dentists: { ayd: ayd.id, kay: kay.id },
    treatments: { checkup: checkup.id, whitening: whitening.id, rootcanal: rootcanal.id },
  };
}
