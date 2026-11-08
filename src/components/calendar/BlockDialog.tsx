"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  createBlockAction,
  deleteBlockAction,
  updateBlockAction,
  type ActionResult,
} from "@/app/[locale]/staff/(app)/calendar/actions";
import { addDays, formatLongDate, istanbulDateOf, istanbulTimeOf } from "@/lib/time";
import Modal from "./Modal";
import { errorKey } from "./errors";
import type { CalEntry } from "./types";
import { btnDanger, btnGhost, btnPrimary, field, label } from "./ui";

const REASONS = ["surgery", "meeting", "personal", "leave", "other"] as const;
type Reason = (typeof REASONS)[number];
type Conflict = { appointmentId: string; start: string; patientName: string };

/**
 * Create, edit or view blocked time. Dentists can only block their own calendar (the dentist is
 * fixed). A refusal because of appointments lists them, each opening that appointment.
 */
export default function BlockDialog({
  locale,
  entry,
  date: viewDate,
  dentists,
  blockable,
  selfDentistId,
  onClose,
  onCloseFocus,
  onDone,
  onOpenAppointment,
}: {
  locale: "en" | "tr";
  /** Editing/viewing this block; creating a new one when absent. */
  entry?: CalEntry;
  date: string;
  dentists: { id: number; name: string }[];
  blockable: number[];
  selfDentistId: number | null;
  onClose: () => void;
  onCloseFocus?: () => void;
  onDone: (text: string) => void;
  onOpenAppointment: (id: string, startIso: string) => void;
}) {
  const t = useTranslations("staff.calendar");
  const readOnly = entry ? !entry.editable : false;
  const choices = dentists.filter((d) => blockable.includes(d.id));

  const init = (() => {
    if (!entry) return { sd: viewDate, st: "09:00", ed: viewDate, et: "10:00", allDay: false };
    const s = new Date(entry.start);
    const e = new Date(entry.end);
    const st = istanbulTimeOf(s);
    const et = istanbulTimeOf(e);
    const allDay = st === "00:00" && et === "00:00";
    return { sd: istanbulDateOf(s), st, ed: allDay ? addDays(istanbulDateOf(e), -1) : istanbulDateOf(e), et, allDay };
  })();

  const [dentistId, setDentistId] = useState(entry?.dentistId ?? selfDentistId ?? choices[0]?.id ?? 0);
  const [startDate, setStartDate] = useState(init.sd);
  const [startTime, setStartTime] = useState(init.st);
  const [endDate, setEndDate] = useState(init.ed);
  const [endTime, setEndTime] = useState(init.et);
  const [allDay, setAllDay] = useState(init.allDay);
  const [reason, setReason] = useState<Reason>((entry?.blockReason as Reason) ?? "meeting");
  const [note, setNote] = useState(entry?.blockNote ?? "");
  const [repeat, setRepeat] = useState<"none" | "count" | "until">("none");
  const [count, setCount] = useState("4");
  const [until, setUntil] = useState(addDays(viewDate, 28));
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busy, startBusy] = useTransition();
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error, conflicts]);

  const range = () =>
    allDay
      ? { startDate, startTime: "00:00", endDate: addDays(endDate, 1), endTime: "00:00" }
      : { startDate, startTime, endDate, endTime };

  function run(fn: () => Promise<ActionResult>, okText: string) {
    setError(null);
    setConflicts([]);
    startBusy(async () => {
      try {
        const r = await fn();
        if (r.ok) return onDone(okText);
        setError(t(errorKey(r.code)));
        if (r.code === "block_conflict") {
          setConflicts(((r.details as { conflicts?: Conflict[] } | undefined)?.conflicts ?? []).slice(0, 20));
        }
      } catch {
        setError(t("errors.generic"));
      }
    });
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const r = range();
    if (`${r.endDate}T${r.endTime}` <= `${r.startDate}T${r.startTime}`) {
      setConflicts([]);
      setError(t("errors.blockRange"));
      return;
    }
    if (entry) {
      run(() => updateBlockAction({ entryId: entry.id, ...r, reason, note }), t("toast.blockUpdated"));
    } else {
      const rep =
        repeat === "count"
          ? { mode: "count" as const, count: Number(count) }
          : repeat === "until"
            ? { mode: "until" as const, until }
            : { mode: "none" as const };
      run(() => createBlockAction({ dentistId, ...r, reason, note, repeat: rep }), t("toast.blockCreated"));
    }
  }

  const dentistName = dentists.find((d) => d.id === dentistId)?.name ?? "";

  if (readOnly && entry) {
    const s = new Date(entry.start);
    const e = new Date(entry.end);
    return (
      <Modal title={t("block.viewTitle")} description={t("block.readOnly")} onClose={onClose} onCloseFocus={onCloseFocus}>
        <dl className="text-[14px]">
          <div className="grid grid-cols-[6.5rem_1fr] gap-3 border-b border-line py-2">
            <dt className="text-mute">{t("block.reason")}</dt>
            <dd className="font-semibold text-ink">{t(`reasons.${entry.blockReason ?? "other"}`)}</dd>
          </div>
          <div className="grid grid-cols-[6.5rem_1fr] gap-3 border-b border-line py-2">
            <dt className="text-mute">{t("dentist")}</dt>
            <dd className="text-ink">{dentistName}</dd>
          </div>
          <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-2">
            <dt className="text-mute">{t("appt.when")}</dt>
            <dd className="text-ink">
              {formatLongDate(s, locale)} {istanbulTimeOf(s)} – {formatLongDate(e, locale)} {istanbulTimeOf(e)}
            </dd>
          </div>
        </dl>
      </Modal>
    );
  }

  return (
    <Modal
      title={entry ? t("block.editTitle") : t("block.title")}
      description={t("block.sub")}
      onClose={onClose}
      onCloseFocus={onCloseFocus}
      wide
    >
      <form noValidate onSubmit={save} className="grid gap-3">
        {error && (
          <div ref={alertRef} tabIndex={-1} role="alert" className="rounded-card bg-[#fdecea] p-3 text-[13px] text-[#8a1c14] outline-none">
            <p className="font-semibold">{error}</p>
            {conflicts.length > 0 && (
              <ul className="mt-2 grid gap-1">
                {conflicts.map((c) => {
                  const s = new Date(c.start);
                  return (
                    <li key={`${c.appointmentId}|${c.start}`}>
                      <button
                        type="button"
                        onClick={() => onOpenAppointment(c.appointmentId, c.start)}
                        className="cursor-pointer text-left font-semibold text-brand underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                      >
                        {t("block.conflictItem", {
                          name: c.patientName,
                          when: `${formatLongDate(s, locale)}, ${istanbulTimeOf(s)}`,
                        })}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {entry || selfDentistId !== null ? (
          <p className="text-[13px]">
            <span className="font-semibold text-ink">{t("dentist")}: </span>
            <span className="text-ink">{selfDentistId !== null && !entry ? `${dentistName} (${t("block.yourCalendar")})` : dentistName}</span>
          </p>
        ) : (
          <label className={label}>
            {t("dentist")}
            <select value={dentistId} onChange={(e) => setDentistId(Number(e.target.value))} className={field}>
              {choices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {entry?.seriesId && <p className="text-[12px] text-mute">{t("block.series")}</p>}
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-brand" />
          {t("block.allDay")}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            {t("block.startDate")}
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
          </label>
          {!allDay && (
            <label className={label}>
              {t("block.startTime")}
              <input type="time" step={900} value={startTime} onChange={(e) => setStartTime(e.target.value)} className={field} />
            </label>
          )}
          <label className={label}>
            {t("block.endDate")}
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={field} />
          </label>
          {!allDay && (
            <label className={label}>
              {t("block.endTime")}
              <input type="time" step={900} value={endTime} onChange={(e) => setEndTime(e.target.value)} className={field} />
            </label>
          )}
        </div>
        <label className={label}>
          {t("block.reason")}
          <select value={reason} onChange={(e) => setReason(e.target.value as Reason)} className={field}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`reasons.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t("block.note")}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={field} />
        </label>
        {!entry && (
          <fieldset className="grid gap-2">
            <legend className={`${label} mb-1`}>{t("block.repeat")}</legend>
            {(["none", "count", "until"] as const).map((m) => (
              <label key={m} className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                <input type="radio" name="repeat" checked={repeat === m} onChange={() => setRepeat(m)} className="size-4 accent-brand" />
                {t(m === "none" ? "block.repeatNone" : m === "count" ? "block.repeatCount" : "block.repeatUntil")}
              </label>
            ))}
            {repeat === "count" && (
              <label className={`${label} max-w-[12rem]`}>
                {t("block.weeks")}
                <input type="number" min={1} max={52} value={count} onChange={(e) => setCount(e.target.value)} className={field} />
              </label>
            )}
            {repeat === "until" && (
              <label className={`${label} max-w-[12rem]`}>
                {t("block.until")}
                <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={field} />
              </label>
            )}
          </fieldset>
        )}
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? t("appt.working") : t("block.save")}
          </button>
          {entry && (
            <button
              type="button"
              className={btnDanger}
              disabled={busy}
              onClick={() => run(() => deleteBlockAction({ entryId: entry.id }), t("toast.blockDeleted"))}
            >
              {t("block.delete")}
            </button>
          )}
          {entry?.seriesId && (
            <button
              type="button"
              className={btnGhost}
              disabled={busy}
              onClick={() => run(() => deleteBlockAction({ entryId: entry.id, wholeSeries: true }), t("toast.blockDeleted"))}
            >
              {t("block.deleteSeries")}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
