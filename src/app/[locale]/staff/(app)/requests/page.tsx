import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import RequestsList from "@/components/staff/RequestsList";
import { Link } from "@/i18n/navigation";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { REQUEST_LIMIT, listRequests, type RequestFilter } from "@/lib/staff/requests";
import { formatLongDate, istanbulTimeOf } from "@/lib/time";
import type { Locale } from "@/i18n/routing";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FILTERS = ["new", "contacted", "closed", "all"] as const;
const LABEL = { new: "filterNew", contacted: "filterContacted", closed: "filterClosed", all: "filterAll" } as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.requests" });
  return { title: t("metaTitle") };
}

export default async function RequestsPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw as Locale;
  const actor = await requireActor();
  if (!can(actor, "requests.view")) notFound();

  const sp = await searchParams;
  const q = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const filter: RequestFilter = FILTERS.find((f) => f === q) ?? "new";
  const t = await getTranslations("staff.requests");
  const rows = await listRequests(await db(), actor, filter);
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    language: r.locale === "tr" ? "Türkçe" : "English",
    when: `${formatLongDate(r.createdAt, locale)}, ${istanbulTimeOf(r.createdAt)}`,
    treatment: (locale === "tr" ? r.treatmentTr : r.treatmentEn) ?? null,
    message: r.message?.trim() ? r.message : null,
    status: r.status,
    masked: r.masked,
  }));

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-ink">{t("title")}</h1>
      <p className="mt-1 text-sm text-mute">{t("lead")}</p>
      <nav aria-label={t("filters")} className="my-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/staff/requests?status=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              f === filter ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-brand"
            }`}
          >
            {t(LABEL[f])}
          </Link>
        ))}
      </nav>
      <RequestsList items={items} />
      {rows.length >= REQUEST_LIMIT && <p className="mt-3 text-xs text-mute">{t("limit", { count: REQUEST_LIMIT })}</p>}
    </div>
  );
}
