import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { clinicHours, clinicSettings, dentists, dentistTreatments, treatments } from "@/lib/db/schema";
import type { Locale } from "@/i18n/routing";

export type TreatmentSummary = {
  id: number;
  slug: string;
  name: string;
  description: string;
  durationMin: number;
};

export type DentistRef = { id: number; slug: string; name: string; title: string };

export type TreatmentDetail = TreatmentSummary & { dentists: DentistRef[] };

export type DentistSummary = DentistRef & {
  bio: string;
  treatments: { slug: string; name: string }[];
};

const tr = (locale: Locale) => locale === "tr";

export async function listTreatments(db: DbOrTx, locale: Locale): Promise<TreatmentSummary[]> {
  const rows = await db
    .select()
    .from(treatments)
    .where(eq(treatments.active, true))
    .orderBy(asc(treatments.sortOrder), asc(treatments.id));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: tr(locale) ? r.nameTr : r.nameEn,
    description: tr(locale) ? r.descTr : r.descEn,
    durationMin: r.durationMin,
  }));
}

export async function getTreatment(db: DbOrTx, slug: string, locale: Locale): Promise<TreatmentDetail | null> {
  const [r] = await db
    .select()
    .from(treatments)
    .where(and(eq(treatments.slug, slug), eq(treatments.active, true)))
    .limit(1);
  if (!r) return null;
  const ds = await db
    .select({
      id: dentists.id,
      slug: dentists.slug,
      name: dentists.name,
      titleEn: dentists.titleEn,
      titleTr: dentists.titleTr,
    })
    .from(dentists)
    .innerJoin(dentistTreatments, eq(dentistTreatments.dentistId, dentists.id))
    .where(and(eq(dentistTreatments.treatmentId, r.id), eq(dentists.active, true)))
    .orderBy(asc(dentists.sortOrder), asc(dentists.id));
  return {
    id: r.id,
    slug: r.slug,
    name: tr(locale) ? r.nameTr : r.nameEn,
    description: tr(locale) ? r.descTr : r.descEn,
    durationMin: r.durationMin,
    dentists: ds.map((d) => ({ id: d.id, slug: d.slug, name: d.name, title: tr(locale) ? d.titleTr : d.titleEn })),
  };
}

export async function listDentists(db: DbOrTx, locale: Locale): Promise<DentistSummary[]> {
  const [ds, links] = await Promise.all([
    db
      .select()
      .from(dentists)
      .where(eq(dentists.active, true))
      .orderBy(asc(dentists.sortOrder), asc(dentists.id)),
    db
      .select({
        dentistId: dentistTreatments.dentistId,
        slug: treatments.slug,
        nameEn: treatments.nameEn,
        nameTr: treatments.nameTr,
      })
      .from(dentistTreatments)
      .innerJoin(treatments, eq(treatments.id, dentistTreatments.treatmentId))
      .where(eq(treatments.active, true))
      .orderBy(asc(treatments.sortOrder), asc(treatments.id)),
  ]);
  return ds.map((d) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    title: tr(locale) ? d.titleTr : d.titleEn,
    bio: tr(locale) ? d.bioTr : d.bioEn,
    treatments: links
      .filter((l) => l.dentistId === d.id)
      .map((l) => ({ slug: l.slug, name: tr(locale) ? l.nameTr : l.nameEn })),
  }));
}

export type OpeningHours = {
  /** Monday first; open/close null when closed. */
  days: { weekday: number; open: string | null; close: string | null }[];
  lunch: { start: string; end: string } | null;
};

export async function getOpeningHours(db: DbOrTx): Promise<OpeningHours> {
  const [rows, [settings]] = await Promise.all([
    db.select().from(clinicHours),
    db.select().from(clinicSettings).limit(1),
  ]);
  const byDay = new Map(rows.map((r) => [r.weekday, r]));
  const days = [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
    weekday,
    open: byDay.get(weekday)?.open ?? null,
    close: byDay.get(weekday)?.close ?? null,
  }));
  return { days, lunch: settings ? { start: settings.lunchStart, end: settings.lunchEnd } : null };
}

export async function dentistName(db: DbOrTx, id: number): Promise<string | null> {
  const [r] = await db.select({ name: dentists.name }).from(dentists).where(eq(dentists.id, id)).limit(1);
  return r?.name ?? null;
}
