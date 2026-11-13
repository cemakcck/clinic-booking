import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import {
  callbackRequests,
  clinicHours,
  clinicSettings,
  dentists,
  dentistTreatments,
  entries,
  patients,
  reminders,
  treatments,
  workingHours,
} from "@/lib/db/schema";
import { clinicData } from "@/content/clinic-data";
import { upsertPatient } from "@/lib/booking/patients";
import { countPublicSlots } from "@/lib/booking/availability";
import { effectiveHours, type Interval } from "@/lib/slots/engine";
import { addDays, atIstanbul, istanbulDateOf, weekdayOf } from "@/lib/time";
import { REMINDER_LEAD_HOURS, SLOT_STEP_MIN } from "@/config/booking";
import { smsText } from "@/lib/reminders/sms";

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
const FILL_PROBABILITY = 0.6;
const CANCELLED_RATE = 0.05;
const NO_SHOW_RATE = 0.08;
/** Weeks of past appointments before this week's Monday (spec §6.5). */
const HISTORY_WEEKS = 26;
/** The oldest history week fills less, rising to FILL_PROBABILITY: a gentle growth trend. */
const HISTORY_FILL_START = 0.48;
/** Past SMS reminder rows are only written for appointments that started in this many days. */
const REMINDER_HISTORY_DAYS = 14;
/** Seeded appointments were made this many days before their start (inclusive range). */
const LEAD_DAYS = [2, 20] as const;
/** History and booking-lead draws use their own sequences, so this fortnight's seed is unchanged. */
const HISTORY_SEED = 20260517;
const LEAD_SEED = 20260611;
const DAY_MS = 86_400_000;

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

  const leadEdge = now.getTime();

  /** One day's appointments for every dentist, drawn from `r` with fill probability `fill`. */
  const planDay = (date: string, r: () => number, fill: number): Planned[] => {
    const out: Planned[] = [];
    const choose = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
    const wd = weekdayOf(date);
    const clinicDay = clinicData.clinicHours.find((h) => h.weekday === wd);
    if (!clinicDay?.open || !clinicDay.close) return out;
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
        if (fits.length === 0 || r() > fill) {
          t += step * (1 + Math.floor(r() * 2));
          continue;
        }
        const tr = choose(fits);
        const end = t + tr.durationMin * MIN;
        const cancelled = r() < CANCELLED_RATE;
        let status: NewRow["status"];
        if (cancelled) status = "cancelled";
        else if (end <= leadEdge) status = r() < NO_SHOW_RATE ? "no_show" : r() < 0.12 ? "arrived" : "completed";
        else if (t <= leadEdge) status = "arrived";
        else status = "booked";
        out.push({
          _day: date,
          dentistId,
          kind: "appointment",
          during: { start: new Date(t), end: new Date(end) },
          active: !cancelled,
          treatmentId: tr.id,
          patientId: choose(patientIds),
          status,
          source: r() < 0.6 ? "online" : "staff",
          cancelledBy: cancelled ? (r() < 0.7 ? "patient" : "staff") : null,
          createdBy: "seed",
        });
        t = Math.ceil(end / step) * step;
      }
    }
    return out;
  };

  const planned: Planned[] = dates.flatMap((date) => planDay(date, rng, FILL_PROBABILITY));
  const historyRng = mulberry32(HISTORY_SEED);
  const historyDays = HISTORY_WEEKS * 7;
  const history: Planned[] = Array.from({ length: historyDays }, (_, k) =>
    planDay(
      addDays(first, k - historyDays),
      historyRng,
      HISTORY_FILL_START + ((FILL_PROBABILITY - HISTORY_FILL_START) * k) / historyDays,
    ),
  ).flat();

  // Booked 2-20 days before the start, never after `now` (so future rows were booked already).
  const leadRng = mulberry32(LEAD_SEED);
  const [minLead, maxLead] = [LEAD_DAYS[0] * DAY_MS, LEAD_DAYS[1] * DAY_MS];
  for (const p of [...planned, ...history]) {
    const s0 = (p.during as Interval).start.getTime();
    const lo = Math.max(minLead, s0 - leadEdge + 60 * MIN);
    p.scheduledAt = new Date(s0 - Math.round(lo + leadRng() * Math.max(0, maxLead - lo)));
  }

  const CHUNK = 200;
  const insertAll = async (rows: Planned[]): Promise<string[]> => {
    const stripped = rows.map((p) => {
      const row: NewRow & { _day?: string } = { ...p };
      delete row._day;
      return row;
    });
    const out: string[] = [];
    for (let i = 0; i < stripped.length; i += CHUNK) {
      const r = await db
        .insert(entries)
        .values(stripped.slice(i, i + CHUNK))
        .returning({ id: entries.id });
      out.push(...r.map((x) => x.id));
    }
    return out;
  };
  const ids = await insertAll(planned);
  const historyIds = await insertAll(history);

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

  // --- past reminder log: the simulated SMS each recent non-cancelled appointment got the day before.
  // Only the guarantee deletes rows, and only future ones, so every id here still exists.
  const contact = new Map(
    (await db.select({ id: patients.id, phone: patients.phoneE164, locale: patients.locale }).from(patients)).map(
      (p) => [p.id, p],
    ),
  );
  const dentistName = new Map(clinicData.dentists.map((d) => [dentistBySlug.get(d.slug)!, d.name]));
  const since = leadEdge - REMINDER_HISTORY_DAYS * DAY_MS;
  const reminderRows: (typeof reminders.$inferInsert)[] = [];
  const allPlanned = [...planned, ...history];
  const allIds = [...ids, ...historyIds];
  allPlanned.forEach((p, i) => {
    const startAt = (p.during as Interval).start;
    if (p.status === "cancelled" || startAt.getTime() < since || startAt.getTime() > leadEdge) return;
    const who = contact.get(p.patientId!)!;
    const locale = who.locale === "tr" ? "tr" : "en";
    const createdAt = new Date(startAt.getTime() - REMINDER_LEAD_HOURS * 3_600_000);
    reminderRows.push({
      entryId: allIds[i],
      channel: "sms",
      startsAt: startAt,
      status: "simulated",
      toAddress: who.phone,
      locale,
      body: smsText(locale, { dentistName: dentistName.get(p.dentistId)!, start: startAt }, createdAt),
      source: "schedule",
      createdAt,
    });
  });
  for (let i = 0; i < reminderRows.length; i += CHUNK) {
    await db.insert(reminders).values(reminderRows.slice(i, i + CHUNK));
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
