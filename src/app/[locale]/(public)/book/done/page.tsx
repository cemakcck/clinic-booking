import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { db } from "@/lib/db/client";
import { loadAppointment } from "@/lib/booking/notify";
import { hashToken } from "@/lib/security/tokens";
import { isDemo } from "@/lib/demo/mode";
import { clinic } from "@/config/clinic";
import { formatLongDate, formatSlotTime } from "@/lib/time";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "booking.done" });
  // The URL carries the manage token: keep it out of search engines and Referer headers.
  return { title: t("metaTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function DonePage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  const tok = (await searchParams).t;
  const token = typeof tok === "string" && tok.length >= 20 && tok.length <= 200 ? tok : null;
  if (!token) notFound();
  const appt = await loadAppointment(await db(), { manageTokenHash: hashToken(token) });
  if (!appt) notFound();

  const t = await getTranslations("booking.done");
  const ts = await getTranslations("booking.summary");
  const treatment = locale === "tr" ? appt.treatment.nameTr : appt.treatment.nameEn;
  const firstName = appt.patient.name.split(" ")[0] ?? appt.patient.name;
  const cancelled = appt.status === "cancelled";
  const row = "grid gap-0.5 border-b border-line py-3 sm:grid-cols-[8rem_1fr] sm:gap-4";

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-accent text-ink">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </span>
        <p className="text-sm font-semibold text-brand">{cancelled ? t("cancelledKicker") : t("kicker")}</p>
      </div>
      <h1 className="mt-4 text-4xl font-bold tracking-tight text-ink sm:text-5xl">{cancelled ? t("cancelledTitle") : t("title")}</h1>
      <p className="mt-3 text-lg text-mute">{cancelled ? t("cancelledLead") : t("lead", { name: firstName })}</p>

      <section data-testid="confirmation" aria-labelledby="appt-title" className="mt-8 rounded-[18px] border border-line bg-white p-5 sm:p-6">
        <h2 id="appt-title" className="sr-only">{ts("title")}</h2>
        <dl className="text-[15px]">
          <div className={row}>
            <dt className="text-mute">{ts("when")}</dt>
            <dd className="font-semibold text-ink">
              {formatLongDate(appt.start, locale)}, {formatSlotTime(appt.start, locale)}
              <span className="ml-2 text-sm font-normal text-mute">{ts("tz")}</span>
            </dd>
          </div>
          <div className={row}>
            <dt className="text-mute">{ts("treatment")}</dt>
            <dd className="font-semibold text-ink">{treatment}</dd>
          </div>
          <div className={row}>
            <dt className="text-mute">{ts("dentist")}</dt>
            <dd data-testid="confirmation-dentist" className="font-semibold text-ink">{appt.dentist.name}</dd>
          </div>
          <div className={`${row} border-b-0`}>
            <dt className="text-mute">{t("where")}</dt>
            <dd className="text-ink">{clinic.name}, {clinic.address}</dd>
          </div>
        </dl>
        {!cancelled && (
          <>
        <p className="mt-4 flex gap-2 rounded-card bg-soft p-3 text-sm text-ink">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3.5 6.5 8.5 6 8.5-6" />
          </svg>
          {t("emailed")}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={`/api/ics/${encodeURIComponent(token)}`}
            download="appointment.ics"
            className="inline-flex items-center gap-2 rounded-card bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3.5" y="5" width="17" height="15" rx="2" />
              <path d="M8 3v4M16 3v4M3.5 10h17M12 13v4M10 15h4" />
            </svg>
            {t("addToCalendar")}
          </a>
          <Link
            href={`/booking/${encodeURIComponent(token)}`}
            className="inline-flex items-center rounded-card border-[1.5px] border-brand bg-white px-4 py-2.5 text-sm font-semibold text-brand hover:bg-soft"
          >
            {t("manage")}
          </Link>
        </div>
        <p className="mt-2 text-[13px] text-mute">{t("manageHint")}</p>
          </>
        )}
      </section>

      {isDemo() && !cancelled && (
        <aside data-testid="demo-callout" aria-labelledby="demo-callout-title" className="mt-6 rounded-[18px] bg-ink p-5 text-white sm:p-6">
          <h2 id="demo-callout-title" className="text-lg font-bold">{t("demoTitle")}</h2>
          <p className="mt-1 text-sm text-white/80">{t("demoBody")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* Task 12 turns this into the one-click receptionist sign-in. */}
            <button
              type="button"
              disabled
              aria-describedby="demo-callout-soon"
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-card border border-white/40 px-4 py-2.5 text-sm font-semibold text-white/80"
            >
              {t("demoCta")} <span aria-hidden="true">→</span>
            </button>
            <span id="demo-callout-soon" className="text-[13px] text-white/75">{t("demoSoon")}</span>
          </div>
        </aside>
      )}

      <Link href="/book" className="mt-8 inline-flex text-sm font-semibold text-brand underline-offset-4 hover:underline">
        {t("bookAnother")} <span aria-hidden="true">&nbsp;→</span>
      </Link>
    </div>
  );
}
