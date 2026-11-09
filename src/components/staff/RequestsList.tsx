"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setRequestStatusAction } from "@/app/[locale]/staff/(app)/requests/actions";
import { btnGhost, btnPrimary } from "@/components/calendar/ui";
import { useRouter } from "@/i18n/navigation";

export type RequestItem = {
  id: string;
  name: string;
  phone: string;
  language: string;
  when: string;
  treatment: string | null;
  message: string | null;
  status: "new" | "contacted" | "closed";
  /** Demo mode: phone masked, message withheld. */
  masked?: boolean;
};

const CHIP: Record<RequestItem["status"], string> = {
  new: "bg-[#e7eefc] text-[#1f3f8f]",
  contacted: "bg-[#e3f5ea] text-[#17673a]",
  closed: "bg-[#eef1f0] text-[#3f5250]",
};

/** The inbox rows with their status buttons; the outcome is announced in a polite live region. */
export default function RequestsList({ items }: { items: RequestItem[] }) {
  const t = useTranslations("staff.requests");
  const te = useTranslations("staff.calendar");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [, refresh] = useTransition();

  async function change(it: RequestItem, to: RequestItem["status"]) {
    setBusy(it.id);
    try {
      const r = await setRequestStatusAction(it.id, to);
      if (r.ok) {
        setMsg({ ok: true, text: t("moved", { name: it.name, status: t(`status.${to}`) }) });
        refresh(() => router.refresh());
      } else {
        setMsg({ ok: false, text: te(`errors.${r.code}`) });
        if (r.code === "not_found") refresh(() => router.refresh());
      }
    } catch {
      setMsg({ ok: false, text: te("errors.generic") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p role="status" data-testid="requests-status" className={`min-h-6 text-sm ${msg && !msg.ok ? "font-semibold text-[#8a1c14]" : "text-mute"}`}>
        {msg?.text}
      </p>
      {items.length === 0 ? (
        <p className="rounded-card border border-line bg-white p-5 text-sm text-mute">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3">
          {items.map((it) => (
            <li key={it.id} data-testid="request" data-request-id={it.id} className="rounded-card border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[16px] font-bold text-ink">{it.name}</h2>
                <span
                  data-testid="request-status"
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP[it.status]}`}
                >
                  {t(`status.${it.status}`)}
                </span>
              </div>
              <p className="mt-1 text-sm text-mute">{t("received", { when: it.when })}</p>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-mute">{t("phone")}</dt>
                <dd>
                  {it.masked ? (
                    <span className="font-semibold text-ink">{it.phone}</span>
                  ) : (
                    <a href={`tel:${it.phone}`} className="font-semibold text-brand underline">
                      {it.phone}
                    </a>
                  )}
                </dd>
                <dt className="text-mute">{t("treatment")}</dt>
                <dd className="text-ink">{it.treatment ?? t("noTreatment")}</dd>
                <dt className="text-mute">{t("language")}</dt>
                <dd className="text-ink">{it.language}</dd>
              </dl>
              <p className="mt-2 text-sm break-words whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
                {it.masked ? (
                  <span className="text-mute italic">{t("hiddenInDemo")}</span>
                ) : (
                  (it.message ?? <span className="text-mute">{t("noMessage")}</span>)
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {it.status === "new" && (
                  <button type="button" className={btnPrimary} disabled={busy === it.id} onClick={() => change(it, "contacted")}>
                    {t("markContacted")}
                  </button>
                )}
                {it.status !== "closed" && (
                  <button type="button" className={btnGhost} disabled={busy === it.id} onClick={() => change(it, "closed")}>
                    {t("markClosed")}
                  </button>
                )}
                {it.status !== "new" && (
                  <button type="button" className={btnGhost} disabled={busy === it.id} onClick={() => change(it, "new")}>
                    {t("reopen")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
