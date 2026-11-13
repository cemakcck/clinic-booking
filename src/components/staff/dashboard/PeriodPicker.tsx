import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PERIODS, type Period } from "@/lib/dashboard/periods";

/** Plain links, so the period works without JavaScript; the active one carries aria-current. */
export default async function PeriodPicker({ active }: { active: Period }) {
  const t = await getTranslations("staff.dashboard");
  return (
    <nav aria-label={t("periodLabel")} className="flex flex-wrap gap-1.5">
      {PERIODS.map((p) => (
        <Link
          key={p}
          href={p === "week" ? "/staff/dashboard" : `/staff/dashboard?period=${p}`}
          aria-current={p === active ? "page" : undefined}
          className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
            p === active ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-brand"
          }`}
        >
          {t(`period.${p}`)}
        </Link>
      ))}
    </nav>
  );
}
