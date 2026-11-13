"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { sendMyRemindersNow } from "@/app/[locale]/staff/(app)/reminders/actions";
import { btnPrimary } from "@/components/calendar/ui";
import { Link, useRouter } from "@/i18n/navigation";

export type ReminderItem = {
  id: string;
  /** Formatted send time, e.g. "Fri 13 Nov, 09:12". */
  when: string;
  channel: "email" | "sms";
  /** Translated outcome label. */
  outcome: string;
  patientName: string;
  contact: string | null;
  /** The SMS text; null for email. */
  message: string | null;
  appointment: { label: string; dentistName: string; href: string };
};

const CHANNEL_CHIP = { sms: "bg-[#e7eefc] text-[#1f3f8f]", email: "bg-[#e3f5ea] text-[#17673a]" } as const;

type Msg = { ok: boolean; text: string; book?: boolean };

/** Demo-only "Send my reminders now"; the outcome is announced in a polite live region. */
export function SendNowButton() {
  const t = useTranslations("staff.reminders");
  const te = useTranslations("staff.calendar.errors");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [, refresh] = useTransition();

  async function send() {
    setBusy(true);
    try {
      const r = await sendMyRemindersNow(locale);
      if (r.ok) {
        setMsg({ ok: true, text: r.considered === 0 ? t("nothingUpcoming") : t("sent", { count: r.sent }) });
        refresh(() => router.refresh());
      } else if (r.reason === "no_bookings") {
        setMsg({ ok: false, text: t("noBookings"), book: true });
      } else if (r.reason === "rate_limited") {
        setMsg({ ok: false, text: te("rate_limited") });
      } else {
        setMsg({ ok: false, text: te("generic") });
      }
    } catch {
      setMsg({ ok: false, text: te("generic") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="send-now" className="my-4 rounded-card border border-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnPrimary} disabled={busy} onClick={send}>
          {busy ? t("sending") : t("sendNow")}
        </button>
        <p className="min-w-0 flex-1 text-sm text-mute">{t("sendNowHint")}</p>
      </div>
      <p
        role="status"
        data-testid="send-now-status"
        className={`mt-2 min-h-5 text-sm ${msg && !msg.ok ? "font-semibold text-[#8a1c14]" : "text-ink"}`}
      >
        {msg?.text}
        {msg?.book && (
          <>
            {" "}
            <Link href="/book" className="text-brand underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              {t("bookLink")}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

/** The log table; rows arrive prepared (and, in the demo, masked) by the page. */
export default function RemindersLog({ items }: { items: ReminderItem[] }) {
  const t = useTranslations("staff.reminders");
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t("listLabel")}</caption>
        <thead className="bg-soft text-xs text-mute">
          <tr>
            <th scope="col" className="px-3 py-2">{t("colTime")}</th>
            <th scope="col" className="px-3 py-2">{t("colChannel")}</th>
            <th scope="col" className="px-3 py-2">{t("colPatient")}</th>
            <th scope="col" className="px-3 py-2">{t("colContact")}</th>
            <th scope="col" className="px-3 py-2">{t("colAppointment")}</th>
            <th scope="col" className="px-3 py-2">{t("colOutcome")}</th>
            <th scope="col" className="px-3 py-2">{t("colMessage")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} data-testid="reminder" data-channel={r.channel} className="border-t border-line align-top">
              <td className="px-3 py-2 whitespace-nowrap text-ink">{r.when}</td>
              <td className="px-3 py-2">
                <span data-testid="reminder-channel" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CHANNEL_CHIP[r.channel]}`}>
                  {r.channel === "sms" ? t("channelSms") : t("channelEmail")}
                </span>
              </td>
              <th scope="row" className="px-3 py-2 font-semibold text-ink">{r.patientName}</th>
              <td data-testid="reminder-contact" className="px-3 py-2 whitespace-nowrap text-ink">{r.contact ?? t("noContact")}</td>
              <td className="px-3 py-2 text-ink">
                <Link
                  href={r.appointment.href}
                  className="font-semibold whitespace-nowrap text-brand underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  {r.appointment.label}
                </Link>
                <div className="text-xs text-mute">{r.appointment.dentistName}</div>
              </td>
              <td data-testid="reminder-outcome" className="px-3 py-2 text-ink">{r.outcome}</td>
              <td data-testid="reminder-message" className="min-w-56 px-3 py-2 break-words text-ink [overflow-wrap:anywhere]">
                {r.message ?? <span className="text-mute">{t("emailMessage")}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
