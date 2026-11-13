import { getTranslations } from "next-intl/server";
import type { DashboardData } from "@/lib/dashboard/metrics";
import type { Locale } from "@/i18n/routing";

/**
 * One horizontal bar per dentist with the percentage and the hours written beside it, so the bar
 * itself is decoration (aria-hidden) and the text carries the numbers.
 */
export default async function UtilisationBars({ data, locale }: { data: DashboardData; locale: Locale }) {
  const t = await getTranslations("staff.dashboard.utilisation");
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const hours = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  if (data.utilisation.length === 0) return <p className="text-sm text-mute">{t("empty")}</p>;

  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-white">
      {data.utilisation.map((u) => {
        const width = u.ratio === null ? 0 : Math.min(1, u.ratio) * 100;
        return (
          <li
            key={u.dentistId}
            data-testid="util-row"
            className="grid items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(9rem,13rem)_1fr_auto]"
          >
            <span data-testid="util-name" className="text-sm font-semibold text-ink">
              {u.name}
            </span>
            <span aria-hidden="true" className="block h-3 overflow-hidden rounded-full bg-soft ring-1 ring-line ring-inset">
              <span className="block h-full rounded-full bg-brand" style={{ width: `${width}%` }} />
            </span>
            <span className="flex items-baseline gap-2 sm:justify-end">
              <span data-testid="util-pct" className="text-sm font-bold text-ink tabular-nums">
                {u.ratio === null ? "—" : pct.format(u.ratio)}
              </span>
              <span className="text-xs text-mute tabular-nums">
                {u.ratio === null
                  ? t("noHours")
                  : t("detail", { booked: hours.format(u.bookedMin / 60), working: hours.format(u.workingMin / 60) })}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
