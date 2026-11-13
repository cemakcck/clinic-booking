import { getTranslations } from "next-intl/server";
import type { DashboardData } from "@/lib/dashboard/metrics";
import type { Locale } from "@/i18n/routing";

// Five steps from the staff palette; every step meets AA for the count printed on it.
const LEVELS = [
  "bg-white text-mute ring-1 ring-line ring-inset",
  "bg-soft text-ink",
  "bg-accent text-ink",
  "bg-brand text-white",
  "bg-ink text-white",
] as const;

const level = (count: number, max: number) => (count === 0 || max === 0 ? 0 : Math.max(1, Math.ceil((count / max) * 4)));

/** Mon=1 … Sun=7 as a localised name; 2024-01-01 was a Monday. */
function weekdayName(weekday: number, locale: Locale, width: "short" | "long") {
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, weekday)));
}

const hh = (h: number) => String(h).padStart(2, "0");

/**
 * Weekday × hour grid of appointment starts. The visible grid prints every count (shade is a
 * second cue, never the only one) and is hidden from assistive tech, which gets a real table.
 */
export default async function Heatmap({ data, locale }: { data: DashboardData; locale: Locale }) {
  const t = await getTranslations("staff.dashboard.heatmap");
  const num = new Intl.NumberFormat(locale);
  if (data.heatmap.length === 0) return <p className="text-sm text-mute">{t("empty")}</p>;

  const days = [...new Set(data.heatmap.map((c) => c.weekday))].sort((a, b) => a - b);
  const hours = [...new Set(data.heatmap.map((c) => c.hour))].sort((a, b) => a - b);
  const count = new Map(data.heatmap.map((c) => [`${c.weekday}-${c.hour}`, c.count]));
  const max = Math.max(0, ...data.heatmap.map((c) => c.count));
  const at = (d: number, h: number) => count.get(`${d}-${h}`);

  return (
    <div className="rounded-card border border-line bg-white p-4">
      <div
        aria-hidden="true"
        className="grid gap-1 text-center text-xs"
        style={{ gridTemplateColumns: `auto repeat(${hours.length}, minmax(0, 1fr))` }}
      >
        <span />
        {hours.map((h) => (
          <span key={h} className="pb-1 font-semibold text-mute tabular-nums">
            {hh(h)}
          </span>
        ))}
        {days.map((d) => (
          <div key={d} className="contents">
            <span className="pr-2 text-left font-semibold leading-8 text-mute">{weekdayName(d, locale, "short")}</span>
            {hours.map((h) => {
              const c = at(d, h);
              return c === undefined ? (
                <span key={h} />
              ) : (
                <span
                  key={h}
                  data-testid="heat-cell"
                  className={`flex h-8 items-center justify-center rounded-md font-semibold tabular-nums ${LEVELS[level(c, max)]}`}
                >
                  {num.format(c)}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-3 flex items-center justify-end gap-1 text-xs text-mute">
        <span className="mr-1">{t("fewer")}</span>
        {LEVELS.map((cls) => (
          <span key={cls} className={`size-4 rounded ${cls}`} />
        ))}
        <span className="ml-1">{t("more")}</span>
      </div>
      <table className="sr-only">
        <caption>{t("caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("weekday")}</th>
            {hours.map((h) => (
              <th key={h} scope="col">{`${hh(h)}:00`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d}>
              <th scope="row">{weekdayName(d, locale, "long")}</th>
              {hours.map((h) => {
                const c = at(d, h);
                return <td key={h}>{c === undefined ? t("closed") : num.format(c)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
