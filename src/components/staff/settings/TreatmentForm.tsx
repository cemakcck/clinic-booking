"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { saveTreatmentAction } from "@/app/[locale]/staff/(app)/settings/actions";
import { useRouter } from "@/i18n/navigation";
import { CheckField, FormFooter, TextField, useSaver } from "./form-kit";

export type TreatmentValues = {
  id?: number; slug: string; nameEn: string; nameTr: string; descEn: string; descTr: string;
  durationMin: number; sortOrder: number; active: boolean;
};

export default function TreatmentForm({ initial, demo, note }: { initial: TreatmentValues; demo: boolean; note: ReactNode }) {
  const t = useTranslations("staff.settings.treatments");
  const router = useRouter();
  const [formRef, s] = useSaver();
  const [v, setV] = useState({ ...initial, durationMin: String(initial.durationMin), sortOrder: String(initial.sortOrder) });
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((p) => ({ ...p, [k]: x }));
  const num = (x: string) => (x.trim() === "" ? Number.NaN : Number(x));

  return (
    <form
      ref={formRef}
      noValidate
      className="grid max-w-2xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void s.save(
          () => saveTreatmentAction({ ...v, durationMin: num(v.durationMin), sortOrder: num(v.sortOrder) }),
          (r) => {
            if (initial.id === undefined) router.push(`/staff/settings/treatments/${r.id}`);
            else router.refresh();
          },
        );
      }}
    >
      <TextField prefix="tr" name="slug" label={t("slug")} hint={t("slugHint")} value={v.slug} onChange={set("slug")} error={s.fields.slug} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField prefix="tr" name="nameEn" label={t("nameEn")} value={v.nameEn} onChange={set("nameEn")} error={s.fields.nameEn} />
        <TextField prefix="tr" name="nameTr" label={t("nameTr")} value={v.nameTr} onChange={set("nameTr")} error={s.fields.nameTr} />
      </div>
      <TextField prefix="tr" name="descEn" label={t("descEn")} multiline value={v.descEn} onChange={set("descEn")} error={s.fields.descEn} />
      <TextField prefix="tr" name="descTr" label={t("descTr")} multiline value={v.descTr} onChange={set("descTr")} error={s.fields.descTr} />
      <div className="flex flex-wrap gap-4">
        <TextField prefix="tr" name="durationMin" label={t("duration")} hint={t("durationHint")} inputMode="numeric" narrow value={v.durationMin} onChange={set("durationMin")} error={s.fields.durationMin} />
        <TextField prefix="tr" name="sortOrder" label={t("sortOrder")} inputMode="numeric" narrow value={v.sortOrder} onChange={set("sortOrder")} error={s.fields.sortOrder} />
      </div>
      <CheckField id="tr-active" label={t("active")} checked={v.active} onChange={set("active")} />
      <FormFooter demo={demo} pending={s.pending} alert={s.alert} status={s.status} note={note} />
    </form>
  );
}
