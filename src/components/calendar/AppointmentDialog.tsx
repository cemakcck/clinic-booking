"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { cancel, move, setStatusAction, type ActionResult } from "@/app/[locale]/staff/(app)/calendar/actions";
import { formatLongDate, istanbulDateOf, istanbulTimeOf } from "@/lib/time";
import Modal from "./Modal";
import { errorKey } from "./errors";
import type { CalEntry, TreatmentOpt } from "./types";
import { btnDanger, btnGhost, btnPrimary, btnQuietDanger, field, label } from "./ui";
import { useSlots } from "./useSlots";

/** "+905321112233" → "+90 532 111 22 33"; other numbers are shown as stored. */
function formatPhone(e164: string): string {
  const m = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+90 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

type Status = "booked" | "arrived" | "completed" | "no_show";

/** Status buttons per current status (mirrors the server's TRANSITIONS; the server decides). */
const NEXT: Record<Status, { to: Status; key: string; primary?: boolean }[]> = {
  booked: [
    { to: "arrived", key: "arrived", primary: true },
    { to: "no_show", key: "no_show" },
  ],
  arrived: [
    { to: "completed", key: "completed", primary: true },
    { to: "booked", key: "undoArrived" },
  ],
  no_show: [{ to: "booked", key: "undoNoShow" }],
  completed: [],
};

/**
 * Details of one appointment, with status buttons, cancel (confirmed inline) and a reschedule
 * form: the keyboard path for everything drag-and-drop does.
 */
export default function AppointmentDialog({
  entry,
  locale,
  dentists,
  treatment,
  manageable,
  outside,
  onClose,
  onCloseFocus,
  onDone,
}: {
  entry: CalEntry;
  locale: "en" | "tr";
  dentists: { id: number; name: string }[];
  treatment: TreatmentOpt | undefined;
  manageable: number[];
  outside: boolean;
  onClose: () => void;
  onCloseFocus: () => void;
  /** Success: close, refresh the calendar and announce `text`. */
  onDone: (text: string, gone?: boolean) => void;
}) {
  const t = useTranslations("staff.calendar");
  const start = new Date(entry.start);
  const end = new Date(entry.end);
  const status = (entry.status ?? "booked") as Status;
  const editable = entry.editable;

  const [mode, setMode] = useState<"view" | "cancel" | "reschedule">("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [date, setDate] = useState(istanbulDateOf(start));
  const [dentistId, setDentistId] = useState(entry.dentistId);
  const [time, setTime] = useState(istanbulTimeOf(start));
  const slots = useSlots();
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const rescheduleRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (mode === "cancel") confirmRef.current?.focus();
    if (mode === "reschedule") rescheduleRef.current?.focus();
  }, [mode]);
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  const dentistName = dentists.find((d) => d.id === entry.dentistId)?.name ?? "";
  const choices = dentists.filter(
    (d) => manageable.includes(d.id) && (treatment ? treatment.dentistIds.includes(d.id) : d.id === entry.dentistId),
  );
  const when = `${formatLongDate(start, locale)}, ${istanbulTimeOf(start)}–${istanbulTimeOf(end)}`;

  async function refreshSlots(d: string, dentist: number, keep: string) {
    if (!entry.treatmentId) return;
    const list = await slots.load({ treatmentId: entry.treatmentId, dentistId: dentist, date: d, appointmentId: entry.id });
    if (list) setTime(list.includes(keep) ? keep : (list[0] ?? ""));
  }

  function run(fn: () => Promise<ActionResult>, okText: string, gone = false) {
    setError(null);
    startBusy(async () => {
      try {
        const r = await fn();
        if (r.ok) onDone(okText, gone);
        else {
          setError(t(errorKey(r.code)));
          if (mode === "reschedule" && (r.code === "slot_taken" || r.code === "outside_rules")) {
            void refreshSlots(date, dentistId, time);
          }
        }
      } catch {
        setError(t("errors.generic"));
      }
    });
  }

  const row = "grid grid-cols-[6.5rem_1fr] gap-3 border-b border-line py-2 text-[14px] last:border-b-0";

  return (
    <Modal
      title={
        <span className="flex flex-wrap items-center gap-2">
          {entry.patientName}
          {entry.mine && (
            <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 text-[12px] font-bold text-[#6b4d00] ring-1 ring-mine">
              {t("mine")}
            </span>
          )}
        </span>
      }
      description={editable ? `${entry.treatmentName} · ${when}` : t("appt.readOnly")}
      onClose={onClose}
      onCloseFocus={onCloseFocus}
      wide
    >
      {error && (
        <p ref={alertRef} tabIndex={-1} role="alert" className="mb-3 rounded-card bg-[#fdecea] p-3 text-[13px] font-semibold text-[#8a1c14] outline-none">
          {error}
        </p>
      )}

      {mode !== "reschedule" && (
        <dl>
          <div className={row}>
            <dt className="text-mute">{t("appt.when")}</dt>
            <dd className="font-semibold text-ink">
              {when} <span className="text-[12px] font-normal text-mute">({t("appt.tz")})</span>
            </dd>
          </div>
          <div className={row}>
            <dt className="text-mute">{t("appt.treatment")}</dt>
            <dd className="text-ink">{entry.treatmentName}</dd>
          </div>
          <div className={row}>
            <dt className="text-mute">{t("appt.dentist")}</dt>
            <dd className="text-ink">{dentistName}</dd>
          </div>
          {entry.patientPhone && (
            <div className={row}>
              <dt className="text-mute">{t("appt.phone")}</dt>
              <dd>
                <a href={`tel:${entry.patientPhone}`} className="font-semibold text-brand underline-offset-2 hover:underline">
                  {formatPhone(entry.patientPhone)}
                </a>
              </dd>
            </div>
          )}
          <div className={row}>
            <dt className="text-mute">{t("appt.status")}</dt>
            <dd className="font-semibold text-ink" data-testid="appt-status">
              {t(`status.${status}`)}
              {outside && <span className="ml-2 text-[12px] font-semibold text-[#8a1c14]">⚠ {t("outside")}</span>}
            </dd>
          </div>
        </dl>
      )}

      {editable && mode === "view" && (
        <>
          {NEXT[status].length > 0 && (
            <div role="group" aria-label={t("appt.statusActions")} className="mt-4 flex flex-wrap gap-2">
              {NEXT[status].map((n) => (
                <button
                  key={n.to}
                  type="button"
                  disabled={busy}
                  className={n.primary ? btnPrimary : btnGhost}
                  onClick={() =>
                    run(
                      () => setStatusAction({ appointmentId: entry.id, status: n.to }),
                      t("toast.status", { name: entry.patientName ?? "", status: t(`status.${n.to}`) }),
                    )
                  }
                >
                  {t(`appt.${n.key}`)}
                </button>
              ))}
            </div>
          )}
          {status === "booked" && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              <button
                type="button"
                className={btnGhost}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMode("reschedule");
                  void refreshSlots(date, dentistId, time);
                }}
              >
                {t("appt.reschedule")}
              </button>
              <button type="button" className={btnQuietDanger} disabled={busy} onClick={() => setMode("cancel")}>
                {t("appt.cancel")}
              </button>
            </div>
          )}
        </>
      )}

      {editable && mode === "cancel" && (
        <div className="mt-4 rounded-card border border-[#f0c4bf] bg-[#fdf3f2] p-4">
          <h3 ref={confirmRef} tabIndex={-1} className="text-[15px] font-bold text-ink outline-none">
            {t("appt.cancelConfirm")}
          </h3>
          <p className="mt-1 text-[13px] text-mute">{t("appt.cancelBody")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={btnDanger}
              disabled={busy}
              onClick={() => run(() => cancel({ appointmentId: entry.id }), t("toast.cancelled"), true)}
            >
              {busy ? t("appt.working") : t("appt.cancelYes")}
            </button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => setMode("view")}>
              {t("appt.cancelKeep")}
            </button>
          </div>
        </div>
      )}

      {editable && mode === "reschedule" && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!time) return;
            run(
              () =>
                move({
                  appointmentId: entry.id,
                  date,
                  time,
                  dentistId: dentistId !== entry.dentistId ? dentistId : undefined,
                }),
              t("toast.moved", { when: `${formatLongDate(date, locale)}, ${time}` }),
            );
          }}
        >
          <h3 ref={rescheduleRef} tabIndex={-1} className="text-[15px] font-bold text-ink outline-none">
            {t("appt.rescheduleTitle")}
          </h3>
          <p className="text-[13px] text-mute">{t("appt.tz")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className={label}>
              {t("appt.date")}
              <input
                type="date"
                required
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) void refreshSlots(e.target.value, dentistId, time);
                }}
                className={field}
              />
            </label>
            <label className={label}>
              {t("appt.dentist")}
              <select
                value={dentistId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setDentistId(id);
                  void refreshSlots(date, id, time);
                }}
                className={field}
              >
                {choices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              {t("appt.time")}
              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={slots.state === "loading"}
                aria-describedby="resched-slots"
                className={field}
              >
                {slots.slots.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p id="resched-slots" data-testid="slots-state" data-state={slots.state} aria-live="polite" className="mt-1.5 min-h-5 text-[12px] text-mute">
            {slots.state === "loading" ? t("appt.loadingSlots") : slots.state === "ready" && slots.slots.length === 0 ? t("appt.noSlots") : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={busy || !time || slots.state !== "ready"}>
              {busy ? t("appt.working") : t("appt.save")}
            </button>
            <button
              type="button"
              className={btnGhost}
              disabled={busy}
              onClick={() => {
                setError(null);
                setMode("view");
              }}
            >
              {t("appt.back")}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
