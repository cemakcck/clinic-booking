import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import {
  callbackRequests,
  clinicHours,
  clinicSettings,
  dentists,
  dentistTreatments,
  entries,
  treatments,
  workingHours,
} from "@/lib/db/schema";
import { clinicData } from "@/content/clinic-data";
import { upsertPatient } from "@/lib/booking/patients";
import { countPublicSlots } from "@/lib/booking/availability";
import { effectiveHours, type Interval } from "@/lib/slots/engine";
import { addDays, atIstanbul, istanbulDateOf, weekdayOf } from "@/lib/time";
import { SLOT_STEP_MIN } from "@/config/booking";

/** Seeded PRNG (mulberry32): same seed, same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
/** Public free slots (30-min probe) the seed leaves on guarded days: the guarantee of 8 plus headroom. */
const SEED_FLOOR = 8 + 4;
const FILL_PROBABILITY = 0.85;
const CANCELLED_RATE = 0.05;
const NO_SHOW_RATE = 0.08;

type Planned = NewRow & { _day: string };
type NewRow = typeof entries.$inferInsert;

/** Wall-clock day of the week containing `date`, back to Monday. */
function mondayOf(date: string): string {
  const wd = weekdayOf(date);
  return addDays(date, -((wd + 6) % 7));
}

export async function seedClinic(
  db: DbOrTx,
  opts: { now: Date; rng?: () => number },
): Promise<void> {
  const { now } = opts;
  const rng = opts.rng ?? mulberry32(20261108);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];

  // --- configuration
  await db.insert(clinicHours).values(clinicData.clinicHours);
  await db.insert(clinicSettings).values({
    id: 1,
    lunchStart: clinicData.lunch.start,
    lunchEnd: clinicData.lunch.end,
  });
  const tRows = await db
    .insert(treatments)
    .values(
      clinicData.treatments.map((t, i) => ({
        slug: t.slug,
        nameEn: t.nameEn,
        nameTr: t.nameTr,
        descEn: t.descEn,
        descTr: t.descTr,
        durationMin: t.durationMin,
        sortOrder: i + 1,
      })),
    )
    .returning({ id: treatments.id, slug: treatments.slug, durationMin: treatments.durationMin });
  const treatmentBySlug = new Map(tRows.map((t) => [t.slug, t]));

  const dRows = await db
    .insert(dentists)
    .values(
      clinicData.dentists.map((d) => ({
        slug: d.slug,
        name: d.name,
        titleEn: d.titleEn,
        titleTr: d.titleTr,
        bioEn: d.bioEn,
        bioTr: d.bioTr,
        sortOrder: d.sortOrder,
      })),
    )
    .returning({ id: dentists.id, slug: dentists.slug });
  const dentistBySlug = new Map(dRows.map((d) => [d.slug, d.id]));

  await db.insert(dentistTreatments).values(
    clinicData.dentists.flatMap((d) =>
      d.treatments.map((slug) => ({
        dentistId: dentistBySlug.get(d.slug)!,
        treatmentId: treatmentBySlug.get(slug)!.id,
      })),
    ),
  );
  await db.insert(workingHours).values(
    clinicData.dentists.flatMap((d) =>
      d.hours.map((h) => ({ dentistId: dentistBySlug.get(d.slug)!, ...h })),
    ),
  );

  const patientIds: string[] = [];
  for (const p of clinicData.patients) {
    patientIds.push(await upsertPatient(db, { name: p.name, phone: p.phone, email: p.email, locale: p.locale }));
  }

  // --- calendar
  const today = istanbulDateOf(now);
  const first = mondayOf(today);
  const last = addDays(first, 13); // Sunday of next week
  const dates = Array.from({ length: 14 }, (_, i) => addDays(first, i));

  const dentistIds = clinicData.dentists.map((d) => dentistBySlug.get(d.slug)!);
  // Controller spec: surgery on dentist 2 (Wed of this week, 14:00-16:00); leave for dentist 3 (next Thursday).
  const surgeryDate = addDays(first, 2);
  const leaveDate = addDays(first, 7 + 3);
  const blockRows: NewRow[] = [
    {
      dentistId: dentistIds[1],
      kind: "block",
      during: { start: atIstanbul(surgeryDate, "14:00"), end: atIstanbul(surgeryDate, "16:00") },
      blockReason: "surgery",
      blockNote: "Implant surgery session",
      createdBy: "seed",
    },
    {
      dentistId: dentistIds[2],
      kind: "block",
      during: { start: atIstanbul(leaveDate, "00:00"), end: atIstanbul(addDays(leaveDate, 1), "00:00") },
      blockReason: "leave",
      blockNote: "Annual leave",
      createdBy: "seed",
    },
  ];
  await db.insert(entries).values(blockRows);

  const planned: Planned[] = [];
  const leadEdge = now.getTime();

  for (const date of dates) {
    const wd = weekdayOf(date);
    const clinicDay = clinicData.clinicHours.find((h) => h.weekday === wd);
    if (!clinicDay?.open || !clinicDay.close) continue;
    for (const d of clinicData.dentists) {
      const dentistId = dentistBySlug.get(d.slug)!;
      const wh = d.hours.find((h) => h.weekday === wd);
      const hours = effectiveHours(
        { start: clinicDay.open, end: clinicDay.close },
        wh ? { start: wh.start, end: wh.end } : null,
        clinicData.lunch,
      );
      if (!hours) continue;
      const fixed: Interval[] = [
        ...hours.breaks.map((b) => ({ start: atIstanbul(date, b.start), end: atIstanbul(date, b.end) })),
        ...blockRows.filter((b) => b.dentistId === dentistId).map((b) => b.during as Interval),
      ];
      const dayEnd = atIstanbul(date, hours.open.end).getTime();
      const step = SLOT_STEP_MIN * MIN;
      const options = d.treatments.map((s) => treatmentBySlug.get(s)!);

      for (let t = atIstanbul(date, hours.open.start).getTime(); t < dayEnd; ) {
        const fits = options.filter((o) => {
          const end = t + o.durationMin * MIN;
          return end <= dayEnd && !fixed.some((f) => t < f.end.getTime() && f.start.getTime() < end);
        });
        if (fits.length === 0 || rng() > FILL_PROBABILITY) {
          t += step * (1 + Math.floor(rng() * 2));
          continue;
        }
        const tr = pick(fits);
        const end = t + tr.durationMin * MIN;
        const cancelled = rng() < CANCELLED_RATE;
        let status: NewRow["status"];
        if (cancelled) status = "cancelled";
        else if (end <= leadEdge) status = rng() < NO_SHOW_RATE ? "no_show" : rng() < 0.12 ? "arrived" : "completed";
        else if (t <= leadEdge) status = "arrived";
        else status = "booked";
        planned.push({
          _day: date,
          dentistId,
          kind: "appointment",
          during: { start: new Date(t), end: new Date(end) },
          active: !cancelled,
          treatmentId: tr.id,
          patientId: pick(patientIds),
          status,
          source: rng() < 0.6 ? "online" : "staff",
          cancelledBy: cancelled ? (rng() < 0.7 ? "patient" : "staff") : null,
          createdBy: "seed",
        });
        t = Math.ceil(end / step) * step;
      }
    }
  }

  const stripped = planned.map((p) => {
    const row: NewRow & { _day?: string } = { ...p };
    delete row._day;
    return row;
  });
  const CHUNK = 200;
  const ids: string[] = [];
  for (let i = 0; i < stripped.length; i += CHUNK) {
    const r = await db
      .insert(entries)
      .values(stripped.slice(i, i + CHUNK))
      .returning({ id: entries.id });
    ids.push(...r.map((x) => x.id));
  }

  // --- guarantee: today and the next 3 open days keep at least SEED_FLOOR public slots.
  const isOpenDay = (d: string) => Boolean(clinicData.clinicHours.find((h) => h.weekday === weekdayOf(d))?.open);
  const guarded: string[] = isOpenDay(today) ? [today] : [];
  for (let d = addDays(today, 1), n = 0; n < 3 && d <= last; d = addDays(d, 1)) {
    if (!isOpenDay(d)) continue;
    guarded.push(d);
    n++;
  }
  for (const date of guarded) {
    const deletable = planned
      .map((p, i) => ({ p, id: ids[i] }))
      .filter(
        ({ p }) =>
          p._day === date && p.active && p.status === "booked" && (p.during as Interval).start.getTime() > leadEdge,
      );
    while ((await countPublicSlots(db, date, now)) < SEED_FLOOR && deletable.length > 0) {
      const [{ id }] = deletable.splice(Math.floor(rng() * deletable.length), 1);
      await db.delete(entries).where(eq(entries.id, id));
    }
  }

  // --- callback requests
  await db.insert(callbackRequests).values([
    {
      name: "Aylin Sönmez",
      phoneE164: "+905325550190",
      locale: "tr",
      treatmentId: treatmentBySlug.get("implant-consult")!.id,
      message: "Implant hakkında bilgi almak istiyorum, akşam saatlerinde aranabilir miyim?",
      status: "new",
      ipHash: "seed",
    },
    {
      name: "Michael Turner",
      phoneE164: "+905325550191",
      locale: "en",
      treatmentId: treatmentBySlug.get("aligner-consult")!.id,
      message: "Could someone call me about clear aligners? I am in Istanbul until December.",
      status: "contacted",
      ipHash: "seed",
    },
  ]);
}
