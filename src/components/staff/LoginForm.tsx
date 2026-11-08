"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef } from "react";
import { signIn, type SignInState } from "@/app/[locale]/staff/login/actions";

const initial: SignInState = { error: null, email: "" };
const field =
  "mt-1.5 w-full rounded-card border-[1.5px] border-line bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none focus:border-brand aria-[invalid=true]:border-[#b3261e]";
const label = "block text-sm font-semibold text-ink";

export default function LoginForm() {
  const t = useTranslations("staff.login");
  const [state, action, pending] = useActionState(signIn, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.error) return;
    const form = formRef.current;
    const first = form?.querySelector<HTMLElement>("[aria-invalid=true]");
    (first ?? form?.querySelector<HTMLElement>("[role=alert]"))?.focus();
  }, [state]);

  const missing = state.error === "missing";
  const emailInvalid = missing && !state.email;
  const passwordInvalid = state.error !== null && !emailInvalid;

  return (
    <form ref={formRef} key={JSON.stringify(state)} action={action} noValidate className="mt-6 grid gap-4">
      {state.error && (
        <p id="login-error" role="alert" tabIndex={-1} className="rounded-card bg-white p-3 text-sm font-semibold text-[#b3261e] ring-1 ring-[#b3261e] outline-none focus:ring-2">
          {t(state.error)}
        </p>
      )}
      <div>
        <label htmlFor="login-email" className={label}>{t("email")}</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          aria-invalid={emailInvalid}
          aria-describedby={emailInvalid ? "login-error" : undefined}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="login-password" className={label}>{t("password")}</label>
        {/* Focus the password only when it is the empty field; a wrong pair focuses the alert. */}
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={missing && passwordInvalid}
          aria-describedby={state.error ? "login-error" : undefined}
          className={field}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex cursor-pointer items-center justify-center rounded-card bg-brand px-4 py-3 text-[15px] font-semibold text-white hover:bg-ink disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? t("pending") : t("submit")}
      </button>
    </form>
  );
}
