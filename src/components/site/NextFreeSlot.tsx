import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { db } from "@/lib/db/client";
import { nextFreeSlot } from "@/lib/booking/availability";
import { dentistName } from "@/lib/public/queries";
import { addDays, formatLongDate, formatSlotTime, istanbulDateOf } from "@/lib/time";

/** Live: the earliest publicly bookable start, computed from the real schedule on every request. */
export default async function NextFreeSlot({ locale, className = "" }: { locale: Locale; className?: string }) {
  const t = await getTranslations("public.slot");
  const conn = await db();
  const now = new Date();
  const slot = await nextFreeSlot(conn, now);
  const name = slot ? await dentistName(conn, slot.dentistId) : null;

  let day = "";
  if (slot) {
    const date = istanbulDateOf(slot.start);
    const today = istanbulDateOf(now);
    day = date === today ? t("today") : date === addDays(today, 1) ? t("tomorrow") : formatLongDate(slot.start, locale);
  }

  return (
    <div
      data-testid="next-free-slot"
      className={`rounded-card bg-white p-4 shadow-[0_14px_36px_-12px_rgba(16,48,46,0.28)] ring-1 ring-line ${className}`}
    >
      <p className="flex items-center gap-2 text-[13px] font-medium text-mute">
        <span aria-hidden="true" className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-arrived opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-arrived" />
        </span>
        {t("label")}
      </p>
      {slot ? (
        <>
          <p className="mt-1.5 text-base font-bold text-ink">
            {t("when", { day, time: formatSlotTime(slot.start, locale) })}
          </p>
          <p className="text-[13px] text-mute">
            {name ? `${t("with", { name })} · ` : ""}
            {t("tz")}
          </p>
          <Link href="/book" className="mt-3 inline-flex text-sm font-semibold text-brand underline-offset-4 hover:underline">
            {t("book")} <span aria-hidden="true">&nbsp;→</span>
          </Link>
        </>
      ) : (
        <p className="mt-1.5 text-sm text-ink">{t("none")}</p>
      )}
    </div>
  );
}
