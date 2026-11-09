import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { btnGhost, btnPrimary, field, label } from "@/components/calendar/ui";
import { Link } from "@/i18n/navigation";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { MINE_COOKIE, parseMine } from "@/lib/demo/mine";
import { BookingError } from "@/lib/booking/errors";
import { PATIENT_LIMIT, getPatientAppointments, searchPatients, type PatientAppointment } from "@/lib/staff/patients";
import { formatLongDate } from "@/lib/time";
import type { Locale } from "@/i18n/routing";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.patients" });
  return { title: t("metaTitle") };
}

export default async function PatientsPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw as Locale;
  const actor = await requireActor();
  if (!can(actor, "patients.view")) notFound();

  const sp = await searchParams;
  const q = (one(sp.q) ?? "").slice(0, 80);
  const pid = one(sp.patient);
  const t = await getTranslations("staff.patients");
  const tc = await getTranslations("staff.calendar");
  const conn = await db();
  // Demo: the visitor's own bookings unmask their own contact details (see lib/demo/mask).
  const mine = parseMine((await cookies()).get(MINE_COOKIE)?.value);
  const now = new Date();
  const rows = await searchPatients(conn, actor, q, now, { mine });
  const detail = pid && UUID.test(pid)
    ? await getPatientAppointments(conn, actor, pid, now, { mine }).catch((e) => {
        if (e instanceof BookingError && e.code === "not_found") return null;
        throw e;
      })
    : null;
  const href = (patient?: string) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (patient) s.set("patient", patient);
    return `/staff/patients${s.size ? `?${s}` : ""}`;
  };
  const status = (s: string) => (s === "cancelled" ? t("cancelled") : tc(`status.${s}`));
  const treatment = (a: PatientAppointment) => (locale === "tr" ? a.treatmentTr : a.treatmentEn) ?? t("noTreatment");

  const table = (title: string, empty: string, list: PatientAppointment[], testid: string) => (
    <section aria-labelledby={`${testid}-h`} className="mt-4">
      <h3 id={`${testid}-h`} className="text-[14px] font-bold text-ink">{title}</h3>
      {list.length === 0 ? (
        <p className="mt-1 text-sm text-mute">{empty}</p>
      ) : (
        <ul data-testid={testid} className="mt-2 grid gap-2">
          {list.map((a) => (
            <li key={a.id} data-testid="patient-appointment" className="rounded-card border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b className="text-ink">{formatLongDate(a.date, locale)}, {a.time}–{a.endTime}</b>
                <span className="rounded-full bg-soft px-2.5 py-0.5 text-xs font-semibold text-ink">{status(a.status)}</span>
              </div>
              <p className="mt-1 text-mute">
                {a.dentistName} · {treatment(a)}
              </p>
              <Link
                href={`/staff/calendar?view=day&date=${a.date}&open=${a.id}`}
                className="mt-1 inline-block font-semibold text-brand underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {t("openInCalendar")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-ink">{t("title")}</h1>
      <p className="mt-1 text-sm text-mute">{actor.role === "dentist" ? t("leadOwn") : t("leadAll")}</p>
      <form role="search" method="get" className="my-4 flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <label htmlFor="patient-q" className={label}>{t("search")}</label>
          <input id="patient-q" name="q" type="search" defaultValue={q} placeholder={t("placeholder")} autoComplete="off" maxLength={80} className={field} />
        </div>
        <button type="submit" className={btnPrimary}>{t("submit")}</button>
        {q && <Link href="/staff/patients" className={btnGhost}>{t("clear")}</Link>}
      </form>
      <p role="status" data-testid="patients-count" className="mb-2 text-sm text-mute">{t("results", { count: rows.length })}</p>
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        <div className="overflow-x-auto rounded-card border border-line bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("listLabel")}</caption>
            <thead className="bg-soft text-xs text-mute">
              <tr>
                <th scope="col" className="px-3 py-2">{t("name")}</th>
                <th scope="col" className="px-3 py-2">{t("phone")}</th>
                <th scope="col" className="px-3 py-2">{t("upcoming")}</th>
                <th scope="col" className="px-3 py-2">{t("past")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} data-testid="patient-row" aria-current={detail?.patient.id === p.id ? "true" : undefined} className="border-t border-line">
                  <th scope="row" className="px-3 py-2 font-semibold text-ink">
                    <Link href={href(p.id)} className="underline decoration-line underline-offset-2 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                      {p.name}
                    </Link>
                    <div className="text-xs font-normal text-mute">{p.email ?? t("noEmail")}</div>
                  </th>
                  <td className="px-3 py-2 whitespace-nowrap">{p.phone}</td>
                  <td className="px-3 py-2">{p.upcoming}</td>
                  <td className="px-3 py-2">{p.past}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length >= PATIENT_LIMIT && <p className="border-t border-line px-3 py-2 text-xs text-mute">{t("limit", { count: PATIENT_LIMIT })}</p>}
        </div>
        {pid && (
          <aside data-testid="patient-detail" aria-label={detail ? t("detailFor", { name: detail.patient.name }) : t("notFound")} className="rounded-card border border-line bg-white p-4">
            {detail ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[16px] font-bold text-ink">{detail.patient.name}</h2>
                  <Link href={href()} className={btnGhost}>{t("close")}</Link>
                </div>
                <p className="mt-1 text-sm text-mute">{detail.patient.phone}{detail.patient.email ? ` · ${detail.patient.email}` : ""}</p>
                {table(t("upcomingTitle"), t("noUpcoming"), detail.upcoming, "upcoming-list")}
                {table(t("pastTitle"), t("noPast"), detail.past, "past-list")}
              </>
            ) : (
              <p className="text-sm text-mute">{t("notFound")}</p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
