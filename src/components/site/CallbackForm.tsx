"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useRef } from "react";
import { submitCallback, type CallbackState } from "@/app/[locale]/(public)/contact/actions";

const initial: CallbackState = { status: "idle" };
const field =
  "mt-1.5 w-full rounded-card border-[1.5px] border-line bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none focus:border-brand aria-[invalid=true]:border-[#b3261e]";
const label = "block text-sm font-semibold text-ink";

export default function CallbackForm({
  treatments,
  defaultTreatment,
}: {
  treatments: { slug: string; name: string }[];
  defaultTreatment?: string;
}) {
  const t = useTranslations("callback");
  const locale = useLocale();
  const [state, action, pending] = useActionState(submitCallback, initial);

  const successRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") successRef.current?.focus();
    if (state.status === "error") {
      const first = formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]");
      if (first) first.focus();
      else formRef.current?.querySelector<HTMLElement>("[role=alert]")?.focus();
    }
  }, [state]);

  if (state.status === "success") {
    return (
      <div ref={successRef} tabIndex={-1} role="status" data-testid="callback-success" className="mt-6 max-w-xl rounded-card bg-white p-6 ring-1 ring-line outline-none focus:ring-2 focus:ring-brand">
        <p className="text-lg font-bold text-ink">{t("thanksTitle")}</p>
        <p className="mt-1 text-mute">{t("thanksBody")}</p>
      </div>
    );
  }

  const errors = state.status === "error" ? state.fieldErrors : {};
  const v = state.status === "error" ? state.values : undefined;
  const err = (f: string) => (errors[f] ? t(`errors.${errors[f]}` as never) : null);
  const errId = (f: string) => (errors[f] ? `cb-${f}-error` : undefined);
  const fieldError = (f: string) =>
    errors[f] ? (
      <p id={`cb-${f}-error`} className="mt-1 text-sm text-[#b3261e]">
        {err(f)}
      </p>
    ) : null;
  const selected = v ? v.treatmentSlug : treatments.some((x) => x.slug === defaultTreatment) ? defaultTreatment : "";
  // Changes with every failed submit so the (React-reset) inputs re-initialize with what was typed.
  const formKey = v ? JSON.stringify(v) : "initial";

  return (
    <form ref={formRef} key={formKey} action={action} noValidate className="mt-6 grid max-w-xl gap-4">
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {errors.form && (
        <p role="alert" tabIndex={-1} className="rounded-card bg-white p-3 text-sm font-semibold text-[#b3261e] ring-1 ring-[#b3261e]">
          {err("form")}
        </p>
      )}
      <div>
        <label htmlFor="cb-name" className={label}>{t("name")}</label>
        <input id="cb-name" name="name" defaultValue={v?.name} autoComplete="name" required aria-invalid={!!errors.name} aria-describedby={errId("name")} className={field} />
        {fieldError("name")}
      </div>
      <div>
        <label htmlFor="cb-phone" className={label}>{t("phone")}</label>
        <input id="cb-phone" name="phone" defaultValue={v?.phone} type="tel" autoComplete="tel" required placeholder={t("phoneHint")} aria-invalid={!!errors.phone} aria-describedby={errId("phone")} className={field} />
        {fieldError("phone")}
      </div>
      <div>
        <label htmlFor="cb-treatment" className={label}>{t("treatment")}</label>
        <select id="cb-treatment" name="treatmentSlug" defaultValue={selected} className={field}>
          <option value="">{t("treatmentNone")}</option>
          {treatments.map((x) => (
            <option key={x.slug} value={x.slug}>{x.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="cb-locale" className={label}>{t("language")}</label>
        <select id="cb-locale" name="locale" defaultValue={v?.locale ?? locale} className={field}>
          <option value="en">{t("languageEn")}</option>
          <option value="tr">{t("languageTr")}</option>
        </select>
      </div>
      <div>
        <label htmlFor="cb-message" className={label}>{t("message")}</label>
        <textarea id="cb-message" name="message" defaultValue={v?.message} rows={3} aria-invalid={!!errors.message} aria-describedby={errId("message")} className={field} />
        {fieldError("message")}
      </div>
      <div>
        <button type="submit" disabled={pending} className="rounded-card bg-brand px-5 py-3 text-sm font-semibold text-white hover:bg-ink disabled:opacity-70">
          {pending ? t("sending") : t("submit")}
        </button>
      </div>
    </form>
  );
}
