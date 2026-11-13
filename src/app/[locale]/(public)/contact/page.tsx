import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { clinic } from "@/config/clinic";
import { db } from "@/lib/db/client";
import { getOpeningHours, listTreatments } from "@/lib/public/queries";
import { range, weekdayName } from "@/lib/public/hours";
import PageHeader from "@/components/site/PageHeader";
import CallbackForm from "@/components/site/CallbackForm";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ treatment?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "public.contact" });
  return { title: t("metaTitle") };
}

/** A stylised, not-to-scale sketch of Moda: sea, pier, the clinic street and the clinic pin. */
function MapArt({ label, pier, sea, street }: { label: string; pier: string; sea: string; street: string }) {
  return (
    <svg viewBox="0 0 560 380" role="img" aria-label={label} className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <rect width="560" height="380" fill="#f4faf8" />
      {/* sea */}
      <path d="M0 0h150c-20 60 10 110-10 170s-60 90-40 210H0Z" fill="#cfe7e1" />
      <path d="M30 90c18-6 30-6 46 0M24 150c18-6 30-6 46 0M40 250c18-6 30-6 46 0" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.8" />
      <text x="28" y="330" fill="#0f5e5a" fontSize="13" fontWeight="600" opacity="0.8">{sea}</text>
      {/* blocks */}
      <g fill="#e3efec">
        <rect x="190" y="24" width="90" height="70" rx="10" />
        <rect x="300" y="24" width="110" height="70" rx="10" />
        <rect x="430" y="24" width="110" height="70" rx="10" />
        <rect x="190" y="200" width="90" height="70" rx="10" />
        <rect x="300" y="200" width="110" height="70" rx="10" />
        <rect x="430" y="200" width="110" height="70" rx="10" />
        <rect x="190" y="290" width="90" height="70" rx="10" />
        <rect x="430" y="290" width="110" height="70" rx="10" />
      </g>
      <rect x="300" y="290" width="110" height="70" rx="10" fill="#d4ebe5" />
      <circle cx="355" cy="325" r="16" fill="#bfe0d8" />
      {/* streets */}
      <path d="M160 140H560" stroke="#ffffff" strokeWidth="26" />
      <path d="M160 140H560" stroke="#d9e6e3" strokeWidth="1.5" strokeDasharray="8 10" />
      <path d="M290 0v380M420 0v380" stroke="#ffffff" strokeWidth="14" />
      <text x="548" y="124" textAnchor="end" fill="#5d7472" fontSize="12" fontWeight="600">{street}</text>
      {/* pier */}
      <path d="M150 120h-46v14h46" fill="#ffffff" stroke="#bcd8d2" strokeWidth="1.5" />
      <g transform="translate(112 102)">
        <rect x="-4" y="-16" width="96" height="22" rx="11" fill="#ffffff" stroke="#d9e6e3" />
        <text x="44" y="-1" textAnchor="middle" fill="#10302e" fontSize="11" fontWeight="600">{pier}</text>
      </g>
      {/* walking route */}
      <path d="M150 128c40 0 60 12 140 12s60 30 66 60" stroke="#1f8a7f" strokeWidth="3" fill="none" strokeDasharray="1 8" strokeLinecap="round" />
      {/* pin */}
      <g transform="translate(356 196)">
        <ellipse cx="0" cy="6" rx="14" ry="4" fill="#0f5e5a" opacity="0.18" />
        <path d="M0 4C-14-12-20-22-20-32a20 20 0 0 1 40 0c0 10-6 20-20 36Z" fill="#0f5e5a" />
        <circle cx="0" cy="-32" r="8" fill="#7fd1c1" />
      </g>
    </svg>
  );
}

export default async function ContactPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { treatment: tq } = await searchParams;
  const treatment = Array.isArray(tq) ? tq[0] : tq;
  setRequestLocale(locale);
  const t = await getTranslations("public.contact");
  const conn = await db();
  const hours = await getOpeningHours(conn);
  const treatmentList = await listTreatments(conn, locale as Locale);

  return (
    <>
      <PageHeader kicker={t("kicker")} title={t("title")} lead={t("lead")} />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.15fr]">
        <div className="space-y-8">
          <dl className="grid gap-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-sm font-semibold text-mute">{t("address")}</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">{clinic.address}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-mute">{t("phone")}</dt>
              <dd className="mt-1">
                <a href={`tel:${clinic.phoneE164}`} className="text-lg font-semibold text-brand underline-offset-4 hover:underline">
                  {clinic.phoneDisplay}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-mute">{t("email")}</dt>
              <dd className="mt-1">
                <a href={`mailto:${clinic.email}`} className="text-lg font-semibold break-all text-brand underline-offset-4 hover:underline">
                  {clinic.email}
                </a>
              </dd>
            </div>
          </dl>

          <section className="rounded-card border border-line p-6">
            <h2 className="text-lg font-bold text-ink">{t("hours")}</h2>
            <dl className="mt-4 divide-y divide-line text-[15px]">
              {hours.days.map((d) => (
                <div key={d.weekday} className="flex justify-between py-2.5">
                  <dt className="text-ink">{weekdayName(d.weekday, locale as Locale)}</dt>
                  <dd className={`tabular-nums ${d.open ? "font-semibold text-ink" : "text-mute"}`}>
                    {range(d.open, d.close) ?? t("closed")}
                  </dd>
                </div>
              ))}
            </dl>
            {hours.lunch && (
              <p className="mt-3 text-sm text-mute">{t("lunch", { start: hours.lunch.start, end: hours.lunch.end })}</p>
            )}
          </section>
        </div>

        <figure>
          <div className="aspect-[56/38] overflow-hidden rounded-[22px] ring-1 ring-line">
            <MapArt label={t("mapLabel")} pier={t("mapPier")} sea={t("mapSea")} street={clinic.mapText} />
          </div>
          <figcaption className="mt-2 text-xs text-mute">{t("mapNote")}</figcaption>
        </figure>
      </div>

      <section id="callback" className="mx-auto max-w-6xl scroll-mt-24 px-4 sm:px-6">
        <div className="rounded-[22px] bg-soft p-8 sm:p-10">
          <h2 className="text-2xl font-bold text-ink">{t("callbackTitle")}</h2>
          <p className="mt-2 max-w-xl leading-relaxed text-mute">{t("callbackBody")}</p>
          <CallbackForm treatments={treatmentList.map((x) => ({ slug: x.slug, name: x.name }))} defaultTreatment={treatment} />
        </div>
      </section>
    </>
  );
}
