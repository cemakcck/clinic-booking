import { getTranslations } from "next-intl/server";
import type { DashboardData, Headline } from "@/lib/dashboard/metrics";
import type { Period } from "@/lib/dashboard/periods";
import type { Locale } from "@/i18n/routing";

type Kind = "count" | "rate";
type TileKey = "appointments" | "noShowRate" | "onlineShare" | "cancellations";

const share = (h: Headline) => (h.online + h.staff === 0 ? null : h.online / (h.online + h.staff));

const VALUE: Record<TileKey, { kind: Kind; of: (h: Headline) => number | null }> = {
  appointments: { kind: "count", of: (h) => h.appointments },
  noShowRate: { kind: "rate", of: (h) => h.noShowRate },
  onlineShare: { kind: "rate", of: share },
  cancellations: { kind: "count", of: (h) => h.cancellations },
};
const ORDER: readonly TileKey[] = ["appointments", "noShowRate", "onlineShare", "cancellations"];

/**
 * Change against the comparison period: counts as a relative change ("↑ 12%"), rates as
 * percentage points ("↑ 3 pts"), since a relative change of a rate reads misleadingly. `null`
 * when there is nothing to compare with (no previous data, or a count's base of 0).
 */
function change(kind: Kind, cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  if (kind === "count") return prev === 0 ? null : Math.round(((cur - prev) / prev) * 100);
  return Math.round((cur - prev) * 100);
}

/** Headline tiles (spec §6.4): the value, a plain-language note and the comparison, all as text. */
export default async function Tiles({ data, locale }: { data: DashboardData; locale: Locale }) {
  const t = await getTranslations("staff.dashboard");
  const num = new Intl.NumberFormat(locale);
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const period: Period = data.period;

  const note = (k: TileKey) =>
    k === "onlineShare"
      ? t("note.onlineShare", { online: num.format(data.current.online), staff: num.format(data.current.staff) })
      : t(`note.${k}`);

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {ORDER.map((k) => {
        const { kind, of } = VALUE[k];
        const cur = of(data.current);
        const delta = data.previous ? change(kind, cur, of(data.previous)) : null;
        const value = cur === null ? "—" : kind === "count" ? num.format(cur) : pct.format(cur);
        const amount =
          delta === null ? "" : kind === "count" ? pct.format(Math.abs(delta) / 100) : t("points", { n: Math.abs(delta) });
        return (
          <li key={k} data-testid="tile" className="flex flex-col rounded-card border border-line bg-white p-4">
            <h3 className="text-[13px] font-semibold text-mute">{t(`tile.${k}`)}</h3>
            <p data-testid="tile-value" className="mt-1 text-3xl font-bold tracking-tight text-ink tabular-nums">
              {value}
            </p>
            <p className="mt-0.5 text-xs text-mute">{note(k)}</p>
            <p data-testid="tile-compare" className="mt-3 border-t border-line pt-2 text-xs font-semibold text-ink">
              {delta === null ? (
                t(`none.${period}`)
              ) : delta === 0 ? (
                t("noChange", { vs: t(`vs.${period}`) })
              ) : (
                <>
                  <span aria-hidden="true" className="mr-1 text-brand">
                    {delta > 0 ? "↑" : "↓"}
                  </span>
                  <span className="sr-only">{delta > 0 ? t("up") : t("down")} </span>
                  {amount} {t(`vs.${period}`)}
                </>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
