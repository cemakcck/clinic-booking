"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { saveDentistAction } from "@/app/[locale]/staff/(app)/settings/actions";
import { field, label as labelCls } from "@/components/calendar/ui";
import { Link, useRouter } from "@/i18n/navigation";
import { formatLongDate, istanbulDateOf, istanbulTimeOf } from "@/lib/time";
import { CheckField, FormFooter, TextField, useSaver } from "./form-kit";

export type DentistValues = {
  id?: number; slug: string; name: string; titleEn: string; titleTr: string; bioEn: string; bioTr: string;
  sortOrder: number; active: boolean; treatmentIds: number[];
  hours: { weekday: number; start: string; end: string }[];
};
export type TreatmentChoice = { id: number; name: string };

const WEEK = [1, 2, 3, 4, 5, 6, 0];

export default function DentistForm({
  initial, treatments, demo, note,
}: { initial: DentistValues; treatments: TreatmentChoice[]; demo: boolean; note: ReactNode }) {
  const t = useTranslations("staff.settings");
  const td = useTranslations("staff.settings.dentists");
  const router = useRouter();
  const locale = useLocale() as "en" | "tr";
  const [formRef, s] = useSaver();
  const [v, setV] = useState({ ...initial, sortOrder: String(initial.sortOrder) });
  const [hours, setHours] = useState<Record<number, { on: boolean; start: string; end: string }>>(() =>
    Object.fromEntries(
      WEEK.map((d) => {
        const h = initial.hours.find((x) => x.weekday === d);
        return [d, { on: !!h, start: h?.start ?? "09:00", end: h?.end ?? "18:00" }];
      }),
    ),
  );
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((p) => ({ ...p, [k]: x }));
  const setDay = (d: number, patch: Partial<{ on: boolean; start: string; end: string }>) =>
    setHours((p) => ({ ...p, [d]: { ...p[d], ...patch } }));

  return (
    <form
      ref={formRef}
      noValidate
      className="grid max-w-3xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const { treatmentIds, ...rest } = v;
        void s.save(
          () =>
            saveDentistAction({
              ...rest,
              sortOrder: rest.sortOrder.trim() === "" ? Number.NaN : Number(rest.sortOrder),
              treatmentIds,
              hours: WEEK.filter((d) => hours[d].on).map((d) => ({ weekday: d, start: hours[d].start, end: hours[d].end })),
            }),
          (r) => {
            if (initial.id === undefined) router.push(`/staff/settings/dentists/${r.id}`);
            else router.refresh();
          },
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField prefix="dn" name="name" label={td("name")} value={v.name} onChange={set("name")} error={s.fields.name} />
        <TextField prefix="dn" name="slug" label={td("fieldSlug")} hint={td("slugHint")} value={v.slug} onChange={set("slug")} error={s.fields.slug} />
        <TextField prefix="dn" name="titleEn" label={td("titleEn")} value={v.titleEn} onChange={set("titleEn")} error={s.fields.titleEn} />
        <TextField prefix="dn" name="titleTr" label={td("titleTr")} value={v.titleTr} onChange={set("titleTr")} error={s.fields.titleTr} />
      </div>
      <TextField prefix="dn" name="bioEn" label={td("bioEn")} multiline value={v.bioEn} onChange={set("bioEn")} error={s.fields.bioEn} />
      <TextField prefix="dn" name="bioTr" label={td("bioTr")} multiline value={v.bioTr} onChange={set("bioTr")} error={s.fields.bioTr} />
      <TextField prefix="dn" name="sortOrder" label={td("sortOrder")} inputMode="numeric" narrow value={v.sortOrder} onChange={set("sortOrder")} error={s.fields.sortOrder} />
      <CheckField id="dn-active" label={td("active")} checked={v.active} onChange={set("active")} />

      <fieldset className="rounded-card border border-line p-4">
        <legend className="px-1 text-[13px] font-semibold text-ink">{td("treatments")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {treatments.map((x) => (
            <CheckField
              key={x.id}
              id={`dn-treatment-${x.id}`}
              label={x.name}
              checked={v.treatmentIds.includes(x.id)}
              onChange={(on) => set("treatmentIds")(on ? [...v.treatmentIds, x.id] : v.treatmentIds.filter((i) => i !== x.id))}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-line p-4">
        <legend className="px-1 text-[13px] font-semibold text-ink">{td("hours")}</legend>
        <p className="mb-3 text-xs text-mute">{td("hoursHint")}</p>
        <div className="grid gap-3">
          {WEEK.map((d) => {
            const row = hours[d];
            const errStart = s.fields[`hours.${d}.start`];
            const errEnd = s.fields[`hours.${d}.end`];
            // The server reports errors by array index; map the index of the enabled days back to the weekday.
            const idx = WEEK.filter((x) => hours[x].on).indexOf(d);
            const eStart = errStart ?? s.fields[`hours.${idx}.start`];
            const eEnd = errEnd ?? s.fields[`hours.${idx}.end`] ?? s.fields[`hours.${idx}.weekday`];
            return (
              <div key={d} className="grid items-start gap-2 sm:grid-cols-[11rem_auto_auto]">
                <CheckField id={`dn-day-${d}`} label={`${t(`days.${d}`)}: ${td("works")}`} checked={row.on} onChange={(on) => setDay(d, { on })} />
                <div>
                  <label htmlFor={`dn-day-${d}-start`} className={labelCls}>{td("start")}</label>
                  <input id={`dn-day-${d}-start`} type="time" value={row.start} disabled={!row.on} onChange={(e) => setDay(d, { start: e.target.value })}
                    aria-invalid={row.on && eStart ? true : undefined} aria-describedby={row.on && eStart ? `dn-day-${d}-err` : undefined} className={`${field} max-w-[9rem]`} />
                </div>
                <div>
                  <label htmlFor={`dn-day-${d}-end`} className={labelCls}>{td("end")}</label>
                  <input id={`dn-day-${d}-end`} type="time" value={row.end} disabled={!row.on} onChange={(e) => setDay(d, { end: e.target.value })}
                    aria-invalid={row.on && eEnd ? true : undefined} aria-describedby={row.on && eEnd ? `dn-day-${d}-err` : undefined} className={`${field} max-w-[9rem]`} />
                </div>
                {row.on && (eStart || eEnd) && (
                  <p id={`dn-day-${d}-err`} className="text-[13px] font-semibold text-[#8a1c14] sm:col-span-3">{eStart ?? eEnd}</p>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>
      <FormFooter
        demo={demo}
        pending={s.pending}
        alert={s.alert}
        status={s.status}
        note={note}
        alertExtra={
          s.appointments.length > 0 && (
            <ul data-testid="dentist-appointments" className="mt-2 grid gap-1">
              {s.appointments.map((a) => {
                const start = new Date(a.start);
                const date = istanbulDateOf(start);
                return (
                  <li key={a.id}>
                    <Link
                      href={`/staff/calendar?view=day&date=${date}&open=${a.id}`}
                      className="font-semibold text-brand underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                    >
                      {td("appointmentItem", { name: a.patientName, when: `${formatLongDate(date, locale)}, ${istanbulTimeOf(start)}` })}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )
        }
      />
    </form>
  );
}
