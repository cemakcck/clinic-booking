import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import RemindersLog, { SendNowButton } from "@/components/staff/RemindersLog";
import { btnPrimary, field, label } from "@/components/calendar/ui";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { isDemo } from "@/lib/demo/mode";
import { MINE_COOKIE, parseMine } from "@/lib/demo/mine";
import { REMINDER_LOG_LIMIT, listReminders, type ReminderChannelFilter } from "@/lib/reminders/log";
import { addDays, atIstanbul, formatLongDate, istanbulDateOf, istanbulTimeOf } from "@/lib/time";
import type { Locale } from "@/i18n/routing";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const CHANNELS: readonly ReminderChannelFilter[] = ["all", "sms", "email"];
const CHANNEL_LABEL = { all: "channelAll", sms: "channelSms", email: "channelEmail" } as const;
const OUTCOMES = ["simulated", "sent", "logged", "suppressed", "capped", "failed"] as const;

/** A YYYY-MM-DD that is a real calendar date, else undefined. */
function validDate(v: string | undefined): string | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = atIstanbul(v, "12:00");
  return Number.isNaN(d.getTime()) || istanbulDateOf(d) !== v ? undefined : v;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.reminders" });
  return { title: t("metaTitle") };
}

export default async function RemindersPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale = raw as Locale;
  const actor = await requireActor();
  if (!can(actor, "reminders.view")) notFound();

  const sp = await searchParams;
  const today = istanbulDateOf(new Date());
  // Default: the last 7 days, ending today (Istanbul).
  let to = validDate(one(sp.to)) ?? today;
  let from = validDate(one(sp.from)) ?? addDays(to, -6);
  if (from > to) [from, to] = [to, from];
  const channel = CHANNELS.find((c) => c === one(sp.channel)) ?? "all";

  const t = await getTranslations("staff.reminders");
  // Demo: the visitor's own bookings unmask their own contact details (see lib/demo/mask).
  const mine = parseMine((await cookies()).get(MINE_COOKIE)?.value);
  const rows = await listReminders(await db(), actor, { from, to, channel, mine });
  const outcome = (s: string) => ((OUTCOMES as readonly string[]).includes(s) ? t(`outcome.${s as (typeof OUTCOMES)[number]}`) : s);
  const items = rows.map((r) => {
    const date = istanbulDateOf(r.appointment.start);
    return {
      id: r.id,
      when: `${formatLongDate(r.createdAt, locale)}, ${istanbulTimeOf(r.createdAt)}`,
      channel: r.channel,
      outcome: outcome(r.status),
      patientName: r.patientName,
      contact: r.contact,
      message: r.channel === "sms" ? r.body : null,
      appointment: {
        label: `${formatLongDate(r.appointment.start, locale)}, ${istanbulTimeOf(r.appointment.start)}`,
        dentistName: r.appointment.dentistName,
        href: `/staff/calendar?view=day&date=${date}&open=${r.appointment.id}`,
      },
    };
  });

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold tracking-tight text-ink">{t("title")}</h1>
      <p className="mt-1 text-sm text-mute">{t("lead")}</p>
      {isDemo() && <SendNowButton />}
      <form method="get" aria-label={t("filters")} className="my-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="rem-from" className={label}>{t("from")}</label>
          <input id="rem-from" name="from" type="date" defaultValue={from} max={today} className={field} />
        </div>
        <div>
          <label htmlFor="rem-to" className={label}>{t("to")}</label>
          <input id="rem-to" name="to" type="date" defaultValue={to} max={today} className={field} />
        </div>
        <div>
          <label htmlFor="rem-channel" className={label}>{t("channel")}</label>
          <select id="rem-channel" name="channel" defaultValue={channel} className={field}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{t(CHANNEL_LABEL[c])}</option>
            ))}
          </select>
        </div>
        <button type="submit" className={btnPrimary}>{t("apply")}</button>
      </form>
      <p data-testid="reminders-count" className="mb-2 text-sm text-mute">{t("count", { count: rows.length })}</p>
      {rows.length > 0 && <RemindersLog items={items} />}
      {rows.length >= REMINDER_LOG_LIMIT && <p className="mt-3 text-xs text-mute">{t("limit", { count: REMINDER_LOG_LIMIT })}</p>}
    </div>
  );
}
