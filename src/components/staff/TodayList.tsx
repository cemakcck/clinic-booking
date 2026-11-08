"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { setStatusAction } from "@/app/[locale]/staff/(app)/calendar/actions";
import BlockDialog from "@/components/calendar/BlockDialog";
import { errorKey } from "@/components/calendar/errors";
import { STATUS_STYLE, btnGhost, btnPrimary } from "@/components/calendar/ui";
import { Link, useRouter } from "@/i18n/navigation";
import { istanbulDateOf, istanbulTimeOf } from "@/lib/time";
import type { CalStatus, TodayItem } from "@/lib/staff/calendar-data";

/** Status buttons per current status (mirrors the server's TRANSITIONS; the server decides). */
const NEXT: Record<CalStatus, { to: CalStatus; key: string; primary?: boolean }[]> = {
  booked: [
    { to: "arrived", key: "arrived", primary: true },
    { to: "no_show", key: "noShow" },
  ],
  arrived: [
    { to: "completed", key: "completed", primary: true },
    { to: "booked", key: "undoArrived" },
  ],
  no_show: [{ to: "booked", key: "undoNoShow" }],
  completed: [],
};

type Msg = { kind: "ok" | "error"; text: string; n: number };

/**
 * The dentist's day on a phone: greeting, date and count, the patients in time order with the
 * next one highlighted, status buttons that offer only the allowed transitions, "Block time"
 * (fixed to the dentist's own calendar) and a link to their week.
 */
export default function TodayList({
  locale,
  greeting,
  name,
  dateLabel,
  today,
  dentistId,
  items,
  nextId,
}: {
  locale: "en" | "tr";
  greeting: string;
  name: string;
  dateLabel: string;
  today: string;
  dentistId: number;
  items: TodayItem[];
  nextId: string | null;
}) {
  const t = useTranslations("staff.today");
  const tc = useTranslations("staff.calendar");
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  const [msg, setMsg] = useState<Msg | null>(null);
  const [blocking, setBlocking] = useState(false);
  const seq = useRef(0);
  const focusId = useRef<string | null>(null);

  // After a status change the clicked button is replaced: focus moves to its row.
  useEffect(() => {
    if (!focusId.current) return;
    const el = document.querySelector<HTMLElement>(`[data-testid="today-item"][data-id="${CSS.escape(focusId.current)}"]`);
    if (el) {
      el.focus();
      focusId.current = null;
    }
  });
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg((m) => (m?.n === msg.n ? null : m)), msg.kind === "error" ? 9000 : 6000);
    return () => clearTimeout(id);
  }, [msg]);

  function say(kind: Msg["kind"], text: string) {
    setMsg({ kind, text, n: ++seq.current });
  }

  async function change(item: TodayItem, to: CalStatus) {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const r = await setStatusAction({ appointmentId: item.id, status: to });
      if (r.ok) {
        say("ok", tc("toast.status", { name: item.patientName, status: tc(`status.${to}`) }));
        focusId.current = item.id;
      } else {
        say("error", tc(errorKey(r.code)));
      }
      startRefresh(() => router.refresh());
    } catch {
      say("error", tc("errors.generic"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-md sm:mx-0">
      <header data-testid="today-header">
        <p data-testid="today-greeting" className="text-[13px] text-mute">
          {greeting}
        </p>
        <h1 className="text-[24px] font-bold tracking-tight text-ink">{name}</h1>
        <p className="text-[13px] text-mute">
          {dateLabel} · <span data-testid="today-count">{t("count", { count: items.length })}</span>
        </p>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setBlocking(true)} className={btnGhost}>
          {t("blockTime")}
        </button>
        <Link href={`/staff/calendar?view=week&dentist=${dentistId}`} className={btnPrimary}>
          {t("openCalendar")}
        </Link>
      </div>

      <div role="status" aria-live="polite" className="mt-3 empty:hidden">
        {msg?.kind === "ok" && (
          <p data-testid="today-toast" className="rounded-card bg-ink px-3.5 py-2.5 text-[13px] font-semibold text-white">
            {msg.text}
          </p>
        )}
      </div>
      <div role="alert" className="mt-3 empty:hidden">
        {msg?.kind === "error" && (
          <p className="flex items-start justify-between gap-3 rounded-card bg-[#fdecea] px-3.5 py-2.5 text-[13px] font-semibold text-[#8a1c14]">
            <span>{msg.text}</span>
            <button
              type="button"
              onClick={() => setMsg(null)}
              aria-label={t("dismiss")}
              className="-my-0.5 cursor-pointer rounded-full px-1.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            >
              <span aria-hidden="true">×</span>
            </button>
          </p>
        )}
      </div>

      {items.length === 0 ? (
        <p data-testid="today-empty" className="mt-5 rounded-card bg-soft p-4 text-[14px] text-ink">
          {t("empty")}
        </p>
      ) : (
        <ol aria-label={t("list")} className="mt-4 grid gap-2">
          {items.map((it) => {
            const isNext = it.id === nextId;
            const done = it.status === "completed" || it.status === "no_show";
            return (
              <li
                key={it.id}
                tabIndex={-1}
                data-testid="today-item"
                data-id={it.id}
                data-status={it.status}
                data-next={isNext ? "true" : undefined}
                aria-current={isNext ? "true" : undefined}
                className={`rounded-card border-l-4 p-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  isNext ? "border-ink bg-brand text-white" : `${STATUS_STYLE[it.status]} text-ink ${done ? "opacity-80" : ""}`
                }`}
              >
                <div className="flex items-center gap-3 text-[14px]">
                  <span className="w-12 shrink-0 font-bold tabular-nums">{istanbulTimeOf(new Date(it.start))}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{it.patientName}</b>
                    <span className={`block truncate text-[12px] ${isNext ? "text-white/90" : "text-[#3f5553]"}`}>{it.treatmentName}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      isNext ? "bg-white text-brand" : "bg-white text-[#3f5553]"
                    }`}
                  >
                    {isNext ? t("next") : tc(`status.${it.status}`)}
                  </span>
                </div>
                {NEXT[it.status].length > 0 && (
                  <div role="group" aria-label={t("actionsFor", { name: it.patientName })} className="mt-2.5 flex flex-wrap gap-2 pl-[3.75rem]">
                    {NEXT[it.status].map((n) => (
                      <button
                        key={n.to}
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => void change(it, n.to)}
                        className={n.primary && !isNext ? btnPrimary : btnGhost}
                      >
                        {t(n.key)}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {blocking && (
        <BlockDialog
          locale={locale}
          date={today}
          dentists={[{ id: dentistId, name }]}
          blockable={[dentistId]}
          selfDentistId={dentistId}
          onClose={() => setBlocking(false)}
          onDone={(text) => {
            setBlocking(false);
            say("ok", text);
            startRefresh(() => router.refresh());
          }}
          onOpenAppointment={(id, startIso) =>
            router.push(`/staff/calendar?view=day&date=${istanbulDateOf(new Date(startIso))}&open=${id}`)
          }
        />
      )}
    </div>
  );
}
