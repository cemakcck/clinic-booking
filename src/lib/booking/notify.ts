import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { dentists, entries, patients, treatments } from "@/lib/db/schema";
import { buildIcs } from "@/lib/email/ics";
import { sendEmail } from "@/lib/email/send";
import { renderEmail, type EmailKind } from "@/lib/email/templates";
import { clinic } from "@/config/clinic";
import { routing, type Locale } from "@/i18n/routing";

export function siteUrl(): string {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function manageUrl(locale: Locale, token: string): string {
  return `${siteUrl()}/${locale}/booking/${encodeURIComponent(token)}`;
}

export type AppointmentView = {
  id: string;
  start: Date;
  end: Date;
  status: string | null;
  locale: Locale;
  patient: { name: string; email: string | null };
  treatment: { slug: string; nameEn: string; nameTr: string; name: string };
  dentist: { slug: string; name: string };
};

const asLocale = (l: string): Locale => ((routing.locales as readonly string[]).includes(l) ? (l as Locale) : "en");

/** Loads an appointment with its patient, treatment and dentist; names in the patient's locale. */
export async function loadAppointment(
  db: Db,
  where: { id: string } | { manageTokenHash: string },
): Promise<AppointmentView | null> {
  const [r] = await db
    .select({
      id: entries.id,
      during: entries.during,
      status: entries.status,
      kind: entries.kind,
      pName: patients.name,
      pEmail: patients.email,
      pLocale: patients.locale,
      tSlug: treatments.slug,
      tEn: treatments.nameEn,
      tTr: treatments.nameTr,
      dSlug: dentists.slug,
      dName: dentists.name,
    })
    .from(entries)
    .innerJoin(patients, eq(patients.id, entries.patientId))
    .innerJoin(treatments, eq(treatments.id, entries.treatmentId))
    .innerJoin(dentists, eq(dentists.id, entries.dentistId))
    .where("id" in where ? eq(entries.id, where.id) : eq(entries.manageTokenHash, where.manageTokenHash))
    .limit(1);
  if (!r || r.kind !== "appointment") return null;
  const locale = asLocale(r.pLocale);
  return {
    id: r.id,
    start: r.during.start,
    end: r.during.end,
    status: r.status,
    locale,
    patient: { name: r.pName, email: r.pEmail },
    treatment: { slug: r.tSlug, nameEn: r.tEn, nameTr: r.tTr, name: locale === "tr" ? r.tTr : r.tEn },
    dentist: { slug: r.dSlug, name: r.dName },
  };
}

/** The .ics for an appointment, in the given locale. Times are UTC instants, so no TZ drift. */
export function appointmentIcs(a: AppointmentView, locale: Locale, now: Date, link?: string): string {
  const treatment = locale === "tr" ? a.treatment.nameTr : a.treatment.nameEn;
  const desc = [`${treatment} · ${a.dentist.name}`, clinic.phoneDisplay, ...(link ? [link] : [])].join("\n");
  return buildIcs({
    uid: `${a.id}@lindenya.example`,
    start: a.start,
    end: a.end,
    summary: `${treatment} · ${clinic.name}`,
    location: `${clinic.name}, ${clinic.address}`,
    description: desc,
    now,
  });
}

/**
 * Emails the patient about their appointment in their own locale. The .ics goes along with
 * confirmations and reschedules. Never throws: email trouble must not undo a booking.
 */
export async function notifyPatient(
  db: Db,
  kind: EmailKind,
  appointmentId: string,
  ctx: { trigger: "patient" | "staff"; ipHash?: string; manageToken?: string; now: Date },
): Promise<void> {
  try {
    const a = await loadAppointment(db, { id: appointmentId });
    if (!a) return;
    const link = ctx.manageToken ? manageUrl(a.locale, ctx.manageToken) : undefined;
    const { subject, html, text } = renderEmail(kind, a.locale, {
      patientName: a.patient.name,
      treatmentName: a.treatment.name,
      dentistName: a.dentist.name,
      start: a.start,
      manageUrl: link,
    });
    const withIcs = kind === "booking_confirmation" || kind === "booking_rescheduled";
    await sendEmail(db, {
      kind,
      to: a.patient.email,
      locale: a.locale,
      subject,
      html,
      text,
      trigger: ctx.trigger,
      ipHash: ctx.ipHash,
      appointmentId: a.id,
      attachments: withIcs
        ? [
            {
              filename: "appointment.ics",
              // Resend reads string content as base64.
              content: Buffer.from(appointmentIcs(a, a.locale, ctx.now, link), "utf8").toString("base64"),
            },
          ]
        : undefined,
      now: ctx.now,
    });
  } catch (e) {
    console.error(`[notify] ${kind} failed: ${e instanceof Error ? e.message : "unknown"}`);
  }
}
