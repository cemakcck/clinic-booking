"use client";

import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { btnGhost, btnPrimary } from "./ui";

const seg = "flex overflow-hidden rounded-card border border-line bg-white text-[13px]";
const segItem =
  "inline-flex items-center px-3 py-1.5 font-medium text-ink hover:bg-soft focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand";

/** Title, previous/today/next, Day/Week, the week's dentist, and the two create buttons. */
export default function Toolbar({
  view,
  title,
  hrefs,
  dentists,
  weekDentistId,
  date,
  canBlock,
  canCreate,
  onBlock,
  onWalkIn,
}: {
  view: "day" | "week";
  title: string;
  hrefs: { prev: string; next: string; today: string; day: string; week: string };
  dentists: { id: number; name: string }[];
  weekDentistId: number | null;
  date: string;
  canBlock: boolean;
  canCreate: boolean;
  onBlock: () => void;
  onWalkIn: () => void;
}) {
  const t = useTranslations("staff.calendar");
  const router = useRouter();
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-3">
      <h1 id="cal-title" tabIndex={-1} className="mr-2 text-[22px] font-bold tracking-tight text-ink outline-none">
        {title}
      </h1>
      <nav aria-label={t("dateNav")} className={seg}>
        <Link href={hrefs.prev} aria-label={view === "day" ? t("prevDay") : t("prevWeek")} className={segItem}>
          <span aria-hidden="true">‹</span>
        </Link>
        <Link href={hrefs.today} className={`${segItem} border-x border-line`}>
          {t("today")}
        </Link>
        <Link href={hrefs.next} aria-label={view === "day" ? t("nextDay") : t("nextWeek")} className={segItem}>
          <span aria-hidden="true">›</span>
        </Link>
      </nav>
      <div role="group" aria-label={t("view")} className={seg}>
        {(["day", "week"] as const).map((v) => (
          <Link
            key={v}
            href={hrefs[v]}
            aria-current={view === v ? "page" : undefined}
            className={`${segItem} ${view === v ? "bg-ink text-white hover:bg-ink" : ""}`}
          >
            {t(v)}
          </Link>
        ))}
      </div>
      {view === "week" && (
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          {t("dentist")}
          <select
            value={weekDentistId ?? ""}
            onChange={(e) => router.push(`/staff/calendar?view=week&date=${date}&dentist=${e.target.value}`)}
            className="rounded-card border border-[#7a908d] bg-white px-2.5 py-1.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
          >
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex gap-2 sm:ml-auto">
        {canBlock && (
          <button type="button" onClick={onBlock} className={btnGhost}>
            {t("blockTime")}
          </button>
        )}
        {canCreate && (
          <button type="button" onClick={onWalkIn} className={btnPrimary}>
            {t("walkIn")}
          </button>
        )}
      </div>
    </div>
  );
}
