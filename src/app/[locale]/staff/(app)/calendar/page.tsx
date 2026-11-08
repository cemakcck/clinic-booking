import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import CalendarShell from "@/components/calendar/CalendarShell";
import type { Column } from "@/components/calendar/types";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { MINE_COOKIE, parseMine } from "@/lib/demo/mine";
import {
  activeDentists,
  getCalendarDay,
  getCalendarWeek,
  getGridHours,
  layoutEntries,
  treatmentOptions,
} from "@/lib/staff/calendar-data";
import { addDays, formatLongDate, istanbulDateOf, weekdayOf } from "@/lib/time";
import type { Locale } from "@/i18n/routing";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** A real YYYY-MM-DD date, or null (2026-02-31 and friends are rejected). */
function validDate(v: string | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return addDays(v, 0) === v ? v : null;
}

const mondayOf = (d: string) => addDays(d, -((weekdayOf(d) + 6) % 7));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.calendar" });
  return { title: t("metaTitle") };
}

export default async function CalendarPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw as Locale;
  // Pages authorize themselves: the layout's check alone can be skipped by segment requests.
  const actor = await requireActor();
  if (!can(actor, "calendar.viewAll")) notFound();

  const sp = await searchParams;
  const now = new Date();
  const today = istanbulDateOf(now);
  const view = one(sp.view) === "week" ? "week" : "day";
  const date = validDate(one(sp.date)) ?? today;
  const openId = one(sp.open);
  const mine = parseMine((await cookies()).get(MINE_COOKIE)?.value);
  const conn = await db();
  const t = await getTranslations("staff.calendar");

  const dentists = await activeDentists(conn);
  const requested = Number(one(sp.dentist));
  const weekDentistId =
    dentists.find((d) => d.id === requested)?.id ??
    dentists.find((d) => d.id === actor.dentistId)?.id ??
    dentists[0]?.id ??
    null;
  const weekStart = mondayOf(date);
  const dates = view === "day" ? [date] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const colDentists = view === "day" ? dentists : dentists.filter((d) => d.id === weekDentistId);

  const [data, treatments, grid] = await Promise.all([
    view === "day" || weekDentistId === null
      ? getCalendarDay(conn, actor, date, now, { locale, mine })
      : getCalendarWeek(conn, actor, weekDentistId, weekStart, now, { locale, mine }),
    treatmentOptions(conn, locale),
    getGridHours(
      conn,
      colDentists.map((d) => d.id),
      dates,
    ),
  ]);

  const columns: Column[] =
    view === "day"
      ? colDentists.map((d) => ({
          key: `${d.id}|${date}`,
          dentistId: d.id,
          date,
          title: d.name,
          hours: grid.hours[`${d.id}|${date}`],
          isToday: date === today,
          canManage: can(actor, "appointment.manage", { dentistId: d.id }),
        }))
      : colDentists.flatMap((d) =>
          dates.map((day) => ({
            key: `${d.id}|${day}`,
            dentistId: d.id,
            date: day,
            title: formatLongDate(day, locale),
            sub: day === today ? t("today") : undefined,
            hours: grid.hours[`${d.id}|${day}`],
            isToday: day === today,
            canManage: can(actor, "appointment.manage", { dentistId: d.id }),
          })),
        );

  const q = (o: Record<string, string | number | null | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) s.set(k, String(v));
    return `/staff/calendar?${s.toString()}`;
  };
  const step = view === "day" ? 1 : 7;
  const dentistParam = view === "week" ? weekDentistId : undefined;
  const hrefs = {
    prev: q({ view, date: addDays(date, -step), dentist: dentistParam }),
    next: q({ view, date: addDays(date, step), dentist: dentistParam }),
    today: q({ view, date: today, dentist: dentistParam }),
    day: q({ view: "day", date }),
    week: q({ view: "week", date, dentist: weekDentistId }),
  };
  const title =
    view === "day"
      ? formatLongDate(date, locale)
      : t("weekOf", { dentist: colDentists[0]?.name ?? "", date: formatLongDate(weekStart, locale) });

  return (
    <CalendarShell
      locale={locale}
      view={view}
      date={date}
      today={today}
      nowIso={now.toISOString()}
      title={title}
      hrefs={hrefs}
      bounds={grid.bounds}
      columns={columns}
      entries={data.entries}
      items={layoutEntries(data.entries, dates)}
      counters={data.counters}
      outsideHours={data.outsideHours}
      dentists={dentists}
      manageable={dentists.filter((d) => can(actor, "appointment.manage", { dentistId: d.id })).map((d) => d.id)}
      blockable={dentists.filter((d) => can(actor, "block.manage", { dentistId: d.id })).map((d) => d.id)}
      selfDentistId={actor.role === "dentist" ? actor.dentistId : null}
      treatments={treatments}
      weekDentistId={weekDentistId}
      openId={openId && UUID.test(openId) ? openId : null}
    />
  );
}
