"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { saveClinicHoursAction } from "@/app/[locale]/staff/(app)/settings/actions";
import { field, label as labelCls } from "@/components/calendar/ui";
import { useRouter } from "@/i18n/navigation";
import { CheckField, FormFooter, TextField, useSaver } from "./form-kit";

export type HoursValues = {
  days: { weekday: number; open: string | null; close: string | null }[];
  lunchStart: string;
  lunchEnd: string;
};
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export default function HoursForm({ initial, demo, note }: { initial: HoursValues; demo: boolean; note: ReactNode }) {
  const t = useTranslations("staff.settings");
  const th = useTranslations("staff.settings.hours");
  const router = useRouter();
  const [formRef, s] = useSaver();
  const [days, setDays] = useState<Record<number, { open: boolean; from: string; to: string }>>(() =>
    Object.fromEntries(
      initial.days.map((d) => [d.weekday, { open: d.open !== null, from: d.open ?? "09:00", to: d.close ?? "18:00" }]),
    ),
  );
  const [lunchStart, setLunchStart] = useState(initial.lunchStart);
  const [lunchEnd, setLunchEnd] = useState(initial.lunchEnd);
  const setDay = (d: number, patch: Partial<{ open: boolean; from: string; to: string }>) =>
    setDays((p) => ({ ...p, [d]: { ...p[d], ...patch } }));

  return (
    <form
      ref={formRef}
      noValidate
      className="grid max-w-2xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void s.save(
          () =>
            saveClinicHoursAction({
              days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
                weekday,
                open: days[weekday].open ? days[weekday].from : null,
                close: days[weekday].open ? days[weekday].to : null,
              })),
              lunchStart,
              lunchEnd,
            }),
          () => router.refresh(),
        );
      }}
    >
      <fieldset className="rounded-card border border-line p-4">
        <legend className="px-1 text-[13px] font-semibold text-ink">{th("title")}</legend>
        <div className="grid gap-3">
          {WEEK.map((d) => {
            const row = days[d];
            const err = s.fields[`days.${d}.open`] ?? s.fields[`days.${d}.close`];
            const bad = row.open && err;
            return (
              <div key={d} className="grid items-start gap-2 sm:grid-cols-[11rem_auto_auto]">
                <CheckField id={`hr-day-${d}`} label={row.open ? t(`days.${d}`) : `${t(`days.${d}`)} (${th("closedDay")})`} checked={row.open} onChange={(open) => setDay(d, { open })} />
                <div>
                  <label htmlFor={`hr-day-${d}-open`} className={labelCls}>{th("open")}</label>
                  <input id={`hr-day-${d}-open`} type="time" value={row.from} disabled={!row.open} onChange={(e) => setDay(d, { from: e.target.value })}
                    aria-invalid={bad ? true : undefined} aria-describedby={bad ? `hr-day-${d}-err` : undefined} className={`${field} max-w-[9rem]`} />
                </div>
                <div>
                  <label htmlFor={`hr-day-${d}-close`} className={labelCls}>{th("close")}</label>
                  <input id={`hr-day-${d}-close`} type="time" value={row.to} disabled={!row.open} onChange={(e) => setDay(d, { to: e.target.value })}
                    aria-invalid={bad ? true : undefined} aria-describedby={bad ? `hr-day-${d}-err` : undefined} className={`${field} max-w-[9rem]`} />
                </div>
                {bad && <p id={`hr-day-${d}-err`} className="text-[13px] font-semibold text-[#8a1c14] sm:col-span-3">{err}</p>}
              </div>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="rounded-card border border-line p-4">
        <legend className="px-1 text-[13px] font-semibold text-ink">{th("lunch")}</legend>
        <div className="flex flex-wrap gap-4">
          <TextField prefix="hr" name="lunchStart" type="time" narrow label={th("lunchStart")} value={lunchStart} onChange={setLunchStart} error={s.fields.lunchStart} />
          <TextField prefix="hr" name="lunchEnd" type="time" narrow label={th("lunchEnd")} value={lunchEnd} onChange={setLunchEnd} error={s.fields.lunchEnd} />
        </div>
      </fieldset>
      <p className="text-xs text-mute">{th("note")}</p>
      <FormFooter demo={demo} pending={s.pending} alert={s.alert} status={s.status} note={note} />
    </form>
  );
}
