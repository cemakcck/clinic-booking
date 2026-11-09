"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { createAppointment } from "@/app/[locale]/staff/(app)/calendar/actions";
import { timeToMin } from "@/lib/calendar/geometry";
import { formatLongDate } from "@/lib/time";
import Modal from "./Modal";
import { errorKey } from "./errors";
import type { TreatmentOpt } from "./types";
import { btnGhost, btnPrimary, field, label } from "./ui";
import { useSlots } from "./useSlots";

type Field = "name" | "phone" | "email";

/** For "now": the latest free start at or before the current minute, else the next one. */
function pickDefault(list: string[], isToday: boolean, nowMin: number): string {
  if (!list.length) return "";
  if (!isToday) return list[0];
  const past = list.filter((s) => timeToMin(s) <= nowMin);
  return past.length ? past[past.length - 1] : list[0];
}

/** Walk-in or phone booking: treatment, dentist, time (staff rules), name, phone, optional email. */
export default function NewAppointmentDialog({
  locale,
  date: initialDate,
  today,
  nowMin,
  treatments,
  dentists,
  manageable,
  onClose,
  onCloseFocus,
  onDone,
}: {
  locale: "en" | "tr";
  date: string;
  today: string;
  nowMin: number;
  treatments: TreatmentOpt[];
  dentists: { id: number; name: string }[];
  manageable: number[];
  onClose: () => void;
  onCloseFocus?: () => void;
  onDone: (text: string, date: string) => void;
}) {
  const t = useTranslations("staff.calendar");
  const options = treatments.filter((tr) => tr.dentistIds.some((id) => manageable.includes(id)));
  const dentistsFor = (tid: number) =>
    dentists.filter((d) => manageable.includes(d.id) && (options.find((o) => o.id === tid)?.dentistIds ?? []).includes(d.id));

  const [treatmentId, setTreatmentId] = useState(options[0]?.id ?? 0);
  const [dentistId, setDentistId] = useState(dentistsFor(options[0]?.id ?? 0)[0]?.id ?? 0);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [lang, setLang] = useState<"en" | "tr">(locale);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const slots = useSlots();
  const refs = { name: useRef<HTMLInputElement>(null), phone: useRef<HTMLInputElement>(null), email: useRef<HTMLInputElement>(null) };

  async function refresh(tid: number, did: number, d: string) {
    if (!tid || !did || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const list = await slots.load({ treatmentId: tid, dentistId: did, date: d });
    if (list) setTime((cur) => (list.includes(cur) ? cur : pickDefault(list, d === today, nowMin)));
  }

  // First load when the dialog opens; later loads follow the user's changes.
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    void refresh(treatmentId, dentistId, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !time) return;
    setErrors({});
    setFormError(null);
    startBusy(async () => {
      try {
        const r = await createAppointment({ treatmentId, dentistId, date, time, name, phone, email, locale: lang });
        if (r.ok) {
          onDone(t("toast.created", { when: `${formatLongDate(date, locale)}, ${time}` }), date);
          return;
        }
        const fe = (r.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors;
        if (r.code === "invalid" && fe) {
          const next: Partial<Record<Field, string>> = {};
          for (const f of ["name", "phone", "email"] as Field[]) if (fe[f]) next[f] = t(`errors.${f}`);
          setErrors(next);
          const firstBad = (["name", "phone", "email"] as Field[]).find((f) => next[f]);
          if (firstBad) refs[firstBad].current?.focus();
          return;
        }
        setFormError(t(errorKey(r.code)));
        if (r.code === "slot_taken" || r.code === "outside_rules") void refresh(treatmentId, dentistId, date);
      } catch {
        setFormError(t("errors.generic"));
      }
    });
  }

  const messages = [formError, ...Object.values(errors)].filter(Boolean) as string[];
  const input = (f: Field, type: string, value: string, set: (v: string) => void, extra?: object) => (
    <input
      ref={refs[f]}
      type={type}
      value={value}
      onChange={(e) => set(e.target.value)}
      aria-invalid={errors[f] ? true : undefined}
      aria-describedby={errors[f] ? `new-${f}-err` : undefined}
      className={field}
      {...extra}
    />
  );
  const fieldErr = (f: Field) =>
    errors[f] && (
      <span id={`new-${f}-err`} className="mt-1 block text-[12px] font-semibold text-[#8a1c14]">
        {errors[f]}
      </span>
    );

  return (
    <Modal title={t("create.title")} description={t("create.sub")} onClose={onClose} onCloseFocus={onCloseFocus} wide>
      <form noValidate onSubmit={submit} className="grid gap-3">
        {messages.length > 0 && (
          <div role="alert" className="rounded-card bg-[#fdecea] p-3 text-[13px] font-semibold text-[#8a1c14]">
            {messages.map((m) => (
              <p key={m}>{m}</p>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            {t("create.treatment")}
            <select
              value={treatmentId}
              onChange={(e) => {
                const tid = Number(e.target.value);
                const ds = dentistsFor(tid);
                const did = ds.some((d) => d.id === dentistId) ? dentistId : (ds[0]?.id ?? 0);
                setTreatmentId(tid);
                setDentistId(did);
                void refresh(tid, did, date);
              }}
              className={field}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.durationMin}′)
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            {t("dentist")}
            <select
              value={dentistId}
              onChange={(e) => {
                const did = Number(e.target.value);
                setDentistId(did);
                void refresh(treatmentId, did, date);
              }}
              className={field}
            >
              {dentistsFor(treatmentId).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            {t("appt.date")}
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                void refresh(treatmentId, dentistId, e.target.value);
              }}
              className={field}
            />
          </label>
          <label className={label}>
            {t("appt.time")}
            <select
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={slots.state === "loading"}
              aria-describedby="new-slots"
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
        <p id="new-slots" data-testid="slots-state" data-state={slots.state} aria-live="polite" className="-mt-1.5 min-h-4 text-[12px] text-mute">
          {slots.state === "loading" ? t("appt.loadingSlots") : slots.state === "ready" && slots.slots.length === 0 ? t("appt.noSlots") : ""}
        </p>
        <label className={label}>
          {t("create.name")}
          {input("name", "text", name, setName, { autoComplete: "off", maxLength: 80 })}
          {fieldErr("name")}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            {t("create.phone")}
            {input("phone", "tel", phone, setPhone, { autoComplete: "off", inputMode: "tel" })}
            {fieldErr("phone")}
          </label>
          <label className={label}>
            {t("create.email")}
            {input("email", "email", email, setEmail, { autoComplete: "off" })}
            {fieldErr("email")}
          </label>
        </div>
        <p className="-mt-1 text-[12px] text-mute">{t("create.emailHint")}</p>
        <label className={label}>
          {t("create.language")}
          <select value={lang} onChange={(e) => setLang(e.target.value as "en" | "tr")} className={field}>
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>
        </label>
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="submit" className={btnPrimary} disabled={busy || !time || slots.state !== "ready"}>
            {busy ? t("appt.working") : t("create.submit")}
          </button>
          <button type="button" className={btnGhost} onClick={onClose}>
            {t("create.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
