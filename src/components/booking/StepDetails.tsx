"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { Details, Hold } from "./types";

const field =
  "mt-1.5 w-full rounded-card border-[1.5px] border-line bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none focus:border-brand aria-[invalid=true]:border-[#b3261e]";
const label = "block text-sm font-semibold text-ink";
const ORDER = ["name", "phone", "email", "privacy"] as const;

function Countdown({ expiresAt }: { expiresAt: string }) {
  const t = useTranslations("booking.details");
  const end = new Date(expiresAt).getTime();
  const [left, setLeft] = useState(() => end - Date.now());
  useEffect(() => {
    const id = setInterval(() => setLeft(end - Date.now()), 1000);
    return () => clearInterval(id);
  }, [end]);

  if (left <= 0) {
    return (
      <p role="status" data-testid="hold-countdown" className="mt-4 rounded-card bg-[#fdf3dc] p-3 text-sm text-ink ring-1 ring-mine">
        {t("heldExpired")}
      </p>
    );
  }
  const s = Math.ceil(left / 1000);
  const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <p data-testid="hold-countdown" className="mt-4 inline-flex items-center gap-2 rounded-full bg-soft px-3 py-1.5 text-sm font-medium text-brand">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2M9.5 2.5h5" />
      </svg>
      <span role="timer" aria-live="off" className="tabular-nums">
        {t("held", { time })}
      </span>
    </p>
  );
}

export default function StepDetails({
  hold,
  values,
  onChange,
  errors,
  submitting,
  onSubmit,
  onBack,
}: {
  hold: Hold;
  values: Details;
  onChange: (v: Details) => void;
  errors: Record<string, string>;
  submitting: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("booking.details");
  const te = useTranslations("booking.errors");
  const tl = useTranslations("language");
  const formRef = useRef<HTMLFormElement>(null);

  // New errors: focus the first invalid field, or the form-level alert.
  useEffect(() => {
    const first = ORDER.find((f) => errors[f]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    else if (errors.form) formRef.current?.querySelector<HTMLElement>("[role=alert]")?.focus();
  }, [errors]);

  const set = <K extends keyof Details>(k: K, v: Details[K]) => onChange({ ...values, [k]: v });
  const errId = (f: string) => (errors[f] ? `bk-${f}-error` : undefined);
  const describe = (f: string, hint?: string) => [hint, errId(f)].filter(Boolean).join(" ") || undefined;
  const fieldError = (f: string) =>
    errors[f] ? (
      <p id={`bk-${f}-error`} className="mt-1 text-sm text-[#b3261e]">
        {te(errors[f] as never)}
      </p>
    ) : null;

  return (
    <>
      <Countdown expiresAt={hold.expiresAt} />
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="mt-6 grid max-w-xl gap-4"
      >
        <div className="absolute -left-[9999px]" aria-hidden="true">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => set("website", e.target.value)} />
          </label>
        </div>
        {(errors.form || Object.keys(errors).length > 0) && (
          <p role="alert" tabIndex={-1} className="rounded-card bg-white p-3 text-sm font-semibold text-[#b3261e] ring-1 ring-[#b3261e] outline-none">
            {te((errors.form ?? "invalid") as never)}
          </p>
        )}
        <div>
          <label htmlFor="bk-name" className={label}>{t("name")}</label>
          <input id="bk-name" name="name" value={values.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" required aria-invalid={!!errors.name} aria-describedby={describe("name")} className={field} />
          {fieldError("name")}
        </div>
        <div>
          <label htmlFor="bk-phone" className={label}>{t("phone")}</label>
          <input id="bk-phone" name="phone" type="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" required placeholder={t("phoneHint")} aria-invalid={!!errors.phone} aria-describedby={describe("phone")} className={field} />
          {fieldError("phone")}
        </div>
        <div>
          <label htmlFor="bk-email" className={label}>{t("email")}</label>
          <input id="bk-email" name="email" type="email" value={values.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" required aria-invalid={!!errors.email} aria-describedby={describe("email", "bk-email-hint")} className={field} />
          <p id="bk-email-hint" className="mt-1 text-[13px] text-mute">{t("emailHint")}</p>
          {fieldError("email")}
        </div>
        <div>
          <label htmlFor="bk-language" className={label}>{t("language")}</label>
          <select id="bk-language" name="language" value={values.language} onChange={(e) => set("language", e.target.value)} className={field}>
            <option value="en">{tl("en")}</option>
            <option value="tr">{tl("tr")}</option>
          </select>
        </div>
        <div className="rounded-card bg-soft p-4">
          <p id="bk-privacy-note" className="text-sm leading-relaxed text-ink">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="mr-1.5 -mt-0.5 inline size-4 text-brand" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" />
            </svg>
            {t("privacyNote")}
          </p>
          <div className="mt-3 flex items-start gap-2.5">
            <input id="bk-privacy" name="privacy" type="checkbox" checked={values.privacy} onChange={(e) => set("privacy", e.target.checked)} required aria-invalid={!!errors.privacy} aria-describedby={describe("privacy", "bk-privacy-note")} className="mt-0.5 size-5 shrink-0 accent-brand" />
            <label htmlFor="bk-privacy" className="text-sm font-medium text-ink">{t("privacy")}</label>
          </div>
          {fieldError("privacy")}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={submitting} className="rounded-card bg-brand px-5 py-3 text-[15px] font-semibold text-white hover:bg-ink disabled:opacity-70">
            {submitting ? t("submitting") : t("submit")}
          </button>
          <button type="button" onClick={onBack} className="text-sm font-semibold text-brand underline-offset-4 hover:underline">
            {t("changeTime")}
          </button>
        </div>
      </form>
    </>
  );
}
