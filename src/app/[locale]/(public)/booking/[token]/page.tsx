import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { db } from "@/lib/db/client";
import { getByManageToken } from "@/lib/booking/manage";
import { loadAppointment } from "@/lib/booking/notify";
import { hashToken } from "@/lib/security/tokens";
import { clinic } from "@/config/clinic";
import { formatLongDate, formatSlotTime } from "@/lib/time";
import ManagePanel from "@/components/booking/ManagePanel";

type Props = { params: Promise<{ locale: string; token: string }> };

// Always read live: the appointment can change under the link.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "booking.manage" });
  // The URL carries the manage token: keep it out of search engines and Referer headers.
  return { title: t("metaTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function ManagePage({ params }: Props) {
  const { locale: raw, token } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  const t = await getTranslations("booking.manage");
  const conn = await db();
  const view = await getByManageToken(conn, token, new Date());

  if (!view) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{t("invalidTitle")}</h1>
        <p className="mt-3 text-lg text-mute">{t("invalidBody", { phone: clinic.phoneDisplay })}</p>
        <Link href="/" className="mt-6 inline-flex rounded-card bg-brand px-5 py-3 font-semibold text-white hover:bg-ink">
          {t("home")}
        </Link>
      </div>
    );
  }

  const appt = await loadAppointment(conn, { manageTokenHash: hashToken(token) });
  const treatment = appt ? (locale === "tr" ? appt.treatment.nameTr : appt.treatment.nameEn) : view.treatmentName;
  return (
    <ManagePanel
      token={token}
      locale={locale}
      status={view.status}
      canChange={view.canChange}
      when={`${formatLongDate(view.start, locale)}, ${formatSlotTime(view.start, locale)}`}
      treatment={treatment}
      dentist={view.dentistName}
      where={`${clinic.name}, ${clinic.address}`}
      phone={{ display: clinic.phoneDisplay, e164: clinic.phoneE164 }}
    />
  );
}
