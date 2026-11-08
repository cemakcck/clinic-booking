"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { confirm, holdSlot, loadDay, releaseSlot } from "@/app/[locale]/(public)/book/actions";
import { Link } from "@/i18n/navigation";
import StepTreatment from "./StepTreatment";
import StepDentist from "./StepDentist";
import StepTime from "./StepTime";
import StepDetails from "./StepDetails";
import Summary from "./Summary";
import type { DayData, Details, Hold, WizardProps } from "./types";
import { bookHref } from "./href";


/**
 * The four-step booking flow. Steps 1-3 live in the URL (server-rendered from it); the hold and
 * step 4 live here. Focus moves to the new step's heading whenever the step changes.
 */
export default function Wizard(props: WizardProps) {
  const t = useTranslations("booking");
  const router = useRouter();
  const { locale, treatment, dentist } = props;

  const [day, setDay] = useState<DayData | null>(props.day);
  const [selected, setSelected] = useState<string | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [details, setDetails] = useState<Details>({
    name: "",
    phone: "",
    email: "",
    language: locale,
    privacy: false,
    website: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loadingDay, startDay] = useTransition();
  const [holding, startHold] = useTransition();
  const [submitting, startSubmit] = useTransition();

  // New server props (a different treatment, dentist or date in the URL) reset the client state.
  const [src, setSrc] = useState(props.day);
  if (src !== props.day) {
    setSrc(props.day);
    setDay(props.day);
    setSelected(null);
    setHold(null);
    setNotice(null);
  }

  const step = hold ? 4 : props.step;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevStep = useRef(step);
  useEffect(() => {
    if (prevStep.current !== step) headingRef.current?.focus();
    prevStep.current = step;
  }, [step]);

  const selectedSlot = day?.slots.find((s) => s.start === selected) ?? null;
  const selectedDay = day?.strip.find((d) => d.date === day.date) ?? null;

  function syncUrl(date: string) {
    window.history.replaceState(null, "", `/${locale}${bookHref({ treatment: treatment?.slug, dentist, date })}`);
  }

  function pickDay(date: string, focusSlots = false) {
    if (!treatment || !dentist) return;
    startDay(async () => {
      const r = await loadDay({ locale, treatment: treatment.slug, dentist, date });
      if (!r.ok) {
        setNotice(t("errors.generic"));
        return;
      }
      setDay(r);
      setSelected(null);
      syncUrl(r.date);
      if (focusSlots) {
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>(`[data-testid="day"][data-date="${r.date}"]`)?.focus(),
        );
      }
    });
  }

  function slotGone() {
    setHold(null);
    setSelected(null);
    setNotice(t("errors.slotGone"));
    if (day) pickDay(day.date);
  }

  function placeHold() {
    if (!treatment || !dentist || !selectedSlot) return;
    setNotice(null);
    startHold(async () => {
      const r = await holdSlot({ locale, treatment: treatment.slug, dentist, start: selectedSlot.start });
      if (!r.ok) {
        if (r.code === "slot_taken" || r.code === "outside_rules" || r.code === "hold_expired") slotGone();
        else setNotice(t(r.code === "rate_limited" ? "errors.rate_limited" : "errors.generic"));
        return;
      }
      setFieldErrors({});
      setHold({
        holdId: r.holdId,
        holdToken: r.holdToken,
        dentistName: r.dentistName,
        expiresAt: r.expiresAt,
        when: r.when,
        start: selectedSlot.start,
      });
    });
  }

  /**
   * Back from step 4: give the hold back, reload the day, and only then show step 3, so the same
   * time is offered (and holdable) again and no late reload can wipe a fresh selection.
   */
  function backToTime() {
    if (!hold || submitting || loadingDay || !treatment || !dentist) return;
    const h = hold;
    const date = day?.date ?? "";
    setNotice(null);
    startDay(async () => {
      await releaseSlot({ holdId: h.holdId, holdToken: h.holdToken });
      const r = await loadDay({ locale, treatment: treatment.slug, dentist, date });
      startDay(() => {
        if (r.ok) {
          setDay(r);
          syncUrl(r.date);
        }
        setSelected(null);
        setHold(null);
      });
    });
  }

  function submit() {
    if (!hold || submitting) return;
    startSubmit(async () => {
      const r = await confirm({ ...details, holdId: hold.holdId, holdToken: hold.holdToken, locale });
      if (r.ok) {
        router.push(r.redirectTo);
        return;
      }
      if (r.code === "hold_expired" || r.code === "slot_taken" || r.code === "outside_rules") {
        slotGone();
        return;
      }
      if (r.code === "rate_limited") setFieldErrors({ form: "rate_limited" });
      else if (r.code === "invalid" && r.fieldErrors) setFieldErrors(r.fieldErrors);
      else setFieldErrors({ form: "generic" });
    });
  }

  const titles = { 1: t("treatment.title"), 2: t("dentist.title"), 3: t("time.title"), 4: t("details.title") };
  const heading = (
    <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-ink outline-none sm:text-[26px]">
      {titles[step]}
    </h2>
  );

  const dentistLabel =
    hold?.dentistName ||
    (dentist === "any"
      ? t("summary.anyone")
      : (treatment?.dentists.find((d) => d.slug === dentist)?.name ?? props.preDentist?.name ?? null));

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
      <div className="min-w-0">
        <Steps step={step} treatment={treatment?.slug ?? null} dentist={dentist} onBackToTime={backToTime} />
        {heading}
        {step === 1 && <StepTreatment treatments={props.treatments} preDentist={props.preDentist} />}
        {step === 2 && treatment && <StepDentist treatment={treatment} notOffered={props.notOffered} />}
        {step === 3 && day && (
          <StepTime
            day={day}
            selected={selected}
            loading={loadingDay}
            notice={notice}
            onPickDay={pickDay}
            onPickSlot={(start) => !loadingDay && setSelected(start)}
          />
        )}
        {step === 4 && hold && (
          <StepDetails
            hold={hold}
            values={details}
            onChange={setDetails}
            errors={fieldErrors}
            submitting={submitting}
            onSubmit={submit}
            onBack={backToTime}
          />
        )}
      </div>
      <Summary
        step={step}
        treatment={treatment ? { name: treatment.name, durationMin: treatment.durationMin } : null}
        dentist={dentistLabel}
        when={hold?.when ?? (selectedSlot && selectedDay ? `${selectedDay.short}, ${selectedSlot.label}` : null)}
        canContinue={!!selectedSlot && !holding}
        holding={holding}
        onContinue={placeHold}
        pricing={props.pricing}
      />
    </div>
  );
}

function Steps({
  step,
  treatment,
  dentist,
  onBackToTime,
}: {
  step: 1 | 2 | 3 | 4;
  treatment: string | null;
  dentist: string | null;
  onBackToTime: () => void;
}) {
  const t = useTranslations("booking.steps");
  const items = [
    { n: 1, label: t("treatment"), href: bookHref({ dentist: dentist && dentist !== "any" ? dentist : null }) },
    { n: 2, label: t("dentist"), href: bookHref({ treatment }) },
    { n: 3, label: t("time"), href: null },
    { n: 4, label: t("details"), href: null },
  ] as const;
  const pill = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] leading-none";

  return (
    <nav aria-label={t("label")} className="mb-6">
      <p className="sr-only" aria-live="polite">
        {t("stepOf", { n: step })}
      </p>
      <ol className="flex flex-wrap gap-2">
        {items.map((it) => {
          const done = it.n < step;
          const current = it.n === step;
          const text = (
            <>
              {done ? <span aria-hidden="true">✓</span> : <span aria-hidden="true">{it.n} ·</span>}
              {it.label}
              {done && <span className="sr-only">({t("done")})</span>}
            </>
          );
          return (
            <li key={it.n}>
              {current ? (
                <span aria-current="step" className={`${pill} bg-brand font-semibold text-white`}>
                  {text}
                </span>
              ) : done && it.href ? (
                <Link href={it.href} className={`${pill} bg-soft font-medium text-brand hover:bg-[#dcefea]`}>
                  {text}
                </Link>
              ) : done && it.n === 3 ? (
                <button type="button" onClick={onBackToTime} className={`${pill} bg-soft font-medium text-brand hover:bg-[#dcefea]`}>
                  {text}
                </button>
              ) : (
                <span className={`${pill} bg-soft text-mute`}>{text}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
