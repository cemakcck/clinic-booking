"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { addClosedDateAction, removeClosedDateAction } from "@/app/[locale]/staff/(app)/settings/actions";
import { btnGhost } from "@/components/calendar/ui";
import { useRouter } from "@/i18n/navigation";
import { FormFooter, TextField, useSaver } from "./form-kit";

export type ClosedItem = { date: string; label: string; shown: string };

export default function ClosedDates({ items, demo, note }: { items: ClosedItem[]; demo: boolean; note: ReactNode }) {
  const t = useTranslations("staff.settings.hours");
  const router = useRouter();
  const [formRef, s] = useSaver();
  const [v, setV] = useState({ date: "", labelEn: "", labelTr: "" });
  const [removing, setRemoving] = useState<string | null>(null);
  const [rm, setRm] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof v) => (x: string) => setV((p) => ({ ...p, [k]: x }));

  async function remove(date: string) {
    setRemoving(date);
    try {
      const r = await removeClosedDateAction(date);
      setRm(r.ok ? { ok: true, text: t("removed") } : { ok: false, text: r.code });
      if (r.ok) router.refresh();
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section aria-labelledby="closed-h" className="mt-10 max-w-2xl">
      <h2 id="closed-h" className="text-xl font-bold tracking-tight text-ink">{t("closedTitle")}</h2>
      <p className="mt-1 text-sm text-mute">{t("closedLead")}</p>
      <p role="status" className="min-h-6 text-sm font-semibold text-[#17673a]">{rm?.ok ? rm.text : null}</p>
      {items.length === 0 ? (
        <p className="rounded-card border border-line bg-white p-4 text-sm text-mute">{t("closedEmpty")}</p>
      ) : (
        <ul className="grid gap-2" data-testid="closed-dates">
          {items.map((c) => (
            <li key={c.date} data-date={c.date} className="flex items-center justify-between gap-3 rounded-card border border-line bg-white px-4 py-2.5 text-sm">
              <span><b className="text-ink">{c.shown}</b> <span className="text-mute">{c.label}</span></span>
              <button type="button" className={btnGhost} disabled={demo || removing === c.date} aria-label={t("removeLabel", { date: c.shown })} onClick={() => remove(c.date)}>
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        ref={formRef}
        noValidate
        className="mt-5 grid gap-4 rounded-card border border-line p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void s.save(
            () => addClosedDateAction(v),
            () => {
              setV({ date: "", labelEn: "", labelTr: "" });
              router.refresh();
            },
            t("added"),
          );
        }}
      >
        <TextField prefix="cd" name="date" type="date" narrow label={t("date")} value={v.date} onChange={set("date")} error={s.fields.date} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField prefix="cd" name="labelEn" label={t("labelEn")} value={v.labelEn} onChange={set("labelEn")} error={s.fields.labelEn} />
          <TextField prefix="cd" name="labelTr" label={t("labelTr")} value={v.labelTr} onChange={set("labelTr")} error={s.fields.labelTr} />
        </div>
        <FormFooter demo={demo} pending={s.pending} alert={s.alert} status={s.status} note={demo ? null : note} saveLabel={t("addClosed")} />
      </form>
    </section>
  );
}
