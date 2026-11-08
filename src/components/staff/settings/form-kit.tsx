"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { btnPrimary, field, label as labelCls } from "@/components/calendar/ui";
import type { SettingsResult } from "@/app/[locale]/staff/(app)/settings/actions";

export const idOf = (prefix: string, name: string) => `${prefix}-${name.replace(/\./g, "-")}`;

export function TextField({
  prefix, name, label, value, onChange, error, hint, multiline = false, type = "text", inputMode, narrow = false,
}: {
  prefix: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  multiline?: boolean;
  type?: "text" | "time" | "date";
  inputMode?: "numeric";
  narrow?: boolean;
}) {
  const id = idOf(prefix, name);
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    name,
    value,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    className: `${field} ${narrow ? "max-w-[9rem]" : ""}`,
  };
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {multiline ? (
        <textarea {...common} rows={4} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={type} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-mute">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-[13px] font-semibold text-[#8a1c14]">{error}</p>}
    </div>
  );
}

export function CheckField({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-brand" />
      {label}
    </label>
  );
}

/**
 * Save plumbing shared by the settings forms: the action's result becomes per-field errors (focus
 * moves to the first invalid field, else to the alert) or a polite "Saved." status. The forms keep
 * their typed values in state, so an error never clears what was typed.
 */
export function useSaver() {
  const t = useTranslations("staff.settings");
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const msg = (key: string) => (t.has(`errors.${key}`) ? t(`errors.${key}`) : t("errors.invalid"));

  useEffect(() => {
    if (!tick || (!alert && Object.keys(fields).length === 0)) return;
    const form = ref.current;
    const first = form?.querySelector<HTMLElement>("[aria-invalid=true]");
    (first ?? form?.querySelector<HTMLElement>("[role=alert]"))?.focus();
    // Only when a new failed save arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  async function save(call: () => Promise<SettingsResult>, onOk: (r: Extract<SettingsResult, { ok: true }>) => void, okText = t("saved")) {
    setPending(true);
    setStatus(null);
    try {
      const r = await call();
      if (r.ok) {
        setFields({});
        setAlert(null);
        setStatus(okText);
        onOk(r);
      } else {
        const f = Object.fromEntries(Object.entries(r.fields ?? {}).map(([k, v]) => [k, msg(v)]));
        setFields(f);
        const hasFields = Object.keys(f).length > 0;
        setAlert(hasFields && r.code === "invalid" ? t("errors.summary") : msg(r.code === "invalid" ? "form" : r.code));
        setTick((n) => n + 1);
      }
    } catch {
      setFields({});
      setAlert(t("errors.generic"));
      setTick((n) => n + 1);
    } finally {
      setPending(false);
    }
  }

  return [ref, { pending, fields, alert, status, save }] as const;
}

/** Save button (disabled in the demo, described by the note) plus the live regions. */
export function FormFooter({
  demo, pending, alert, status, note, saveLabel,
}: {
  demo: boolean;
  pending: boolean;
  alert: string | null;
  status: string | null;
  note: ReactNode;
  saveLabel?: string;
}) {
  const t = useTranslations("staff.settings");
  return (
    <div className="mt-5 grid gap-3">
      {demo && note}
      {alert && (
        <p role="alert" tabIndex={-1} className="rounded-card bg-white p-3 text-sm font-semibold text-[#8a1c14] ring-1 ring-[#b3261e] outline-none focus:ring-2">
          {alert}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className={btnPrimary} disabled={demo || pending} aria-describedby={demo ? "demo-note" : undefined}>
          {pending ? t("saving") : (saveLabel ?? t("save"))}
        </button>
        <p role="status" data-testid="settings-status" className="text-sm font-semibold text-[#17673a]">{status}</p>
      </div>
    </div>
  );
}
