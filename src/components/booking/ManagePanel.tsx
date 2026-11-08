"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cancelAppointment, loadManageDay, rescheduleAppointment } from "@/app/[locale]/(public)/booking/[token]/actions";
import { Link } from "@/i18n/navigation";
import DayStrip from "./DayStrip";
import SlotGrid from "./SlotGrid";
import type { DayData } from "./types";

type Mode = "view" | "cancel" | "reschedule";

const btn =
  "inline-flex items-center justify-center rounded-card px-4 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-60";
const primary = `${btn} bg-brand text-white hover:bg-ink`;
const secondary = `${btn} border-[1.5px] border-brand bg-white text-brand hover:bg-soft`;
const danger = `${btn} bg-[#b3261e] text-white hover:bg-[#8c1d18]`;

export default function ManagePanel(props: {
  token: string;
  locale: string;
  status: string;
  canChange: boolean;
  when: string;
  treatment: string;
  dentist: string;
  where: string;
  phone: { display: string; e164: string };
}) {
  const t = useTranslations("booking.manage");
  const te = useTranslations("booking.errors");
  const tt = useTranslations("booking.time");
  const router = useRouter();
  const { token, locale } = props;

  const [mode, setMode] = useState<Mode>("view");
  const [day, setDay] = useState<DayData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [loadingDay, startDay] = useTransition();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancelRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const cancelled = props.status === "cancelled";

  // Focus follows the state: the page heading after a change, the confirm question when it opens.
  const focusTarget = useRef<"heading" | "cancel" | "alert" | null>(null);
  useEffect(() => {
    const which = focusTarget.current;
    focusTarget.current = null;
    if (which === "heading") headingRef.current?.focus();
    else if (which === "cancel") cancelRef.current?.focus();
    else if (which === "alert") alertRef.current?.focus();
  });
  const focus = (w: "heading" | "cancel" | "alert") => {
    focusTarget.current = w;
  };

  function pickDay(date?: string, focusDay = false) {
    startDay(async () => {
      const r = await loadManageDay({ locale, token, date });
      if (!r.ok) {
        setNotice(r.code === "too_late" || r.code === "not_found" ? t("tooLate") : te("generic"));
        focus("alert");
        if (r.code === "too_late" || r.code === "not_found") router.refresh();
        return;
      }
      setDay(r);
      setSelected(null);
      if (focusDay) {
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>(`[data-testid="day"][data-date="${r.date}"]`)?.focus(),
        );
      }
    });
  }

  function openReschedule() {
    setNotice(null);
    setOutcome(null);
    focus("heading");
    setMode("reschedule");
    pickDay();
  }

  function leave() {
    setNotice(null);
    setSelected(null);
    focus("heading");
    setMode("view");
  }

  function move() {
    if (!selected || busy) return;
    setNotice(null);
    startBusy(async () => {
      const r = await rescheduleAppointment({ locale, token, start: selected });
      if (r.ok) {
        setOutcome(t("rescheduled", { when: r.when }));
        focus("heading");
        setMode("view");
        router.refresh();
        return;
      }
      if (r.code === "slot_taken" || r.code === "outside_rules") {
        setNotice(te("slotGone"));
        focus("alert");
        pickDay(day?.date);
      } else if (r.code === "too_late" || r.code === "link_expired" || r.code === "not_found") {
        setNotice(t("tooLate"));
        setMode("view");
        focus("alert");
        router.refresh();
      } else {
        setNotice(te("generic"));
        focus("alert");
      }
    });
  }

  function doCancel() {
    if (busy) return;
    setNotice(null);
    startBusy(async () => {
      const r = await cancelAppointment({ token });
      if (r.ok) {
        setOutcome(t("cancelledLead", { when: props.when }));
        focus("heading");
        setMode("view");
        router.refresh();
        return;
      }
      setNotice(r.code === "too_late" || r.code === "link_expired" ? t("tooLate") : te("generic"));
      focus("alert");
      setMode("view");
      if (r.code === "too_late") router.refresh();
    });
  }

  const row = "grid gap-0.5 border-b border-line py-3 sm:grid-cols-[8rem_1fr] sm:gap-4";
  const alert = notice && (
    <p
      ref={alertRef}
      tabIndex={-1}
      role="alert"
      className="mt-4 rounded-card bg-[#fdf3dc] p-3 text-sm font-semibold text-ink ring-1 ring-mine outline-none"
    >
      {notice}
    </p>
  );
  const current = day?.strip.find((d) => d.date === day.date);
  const anyDay = day?.strip.some((d) => d.available) ?? false;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="text-sm font-semibold text-brand">{cancelled ? t("cancelledKicker") : t("kicker")}</p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-2 text-4xl font-bold tracking-tight text-ink outline-none sm:text-5xl">
        {mode === "reschedule" ? t("rescheduleTitle") : cancelled ? t("cancelledTitle") : t("title")}
      </h1>
      {/* Outcomes are announced; the heading focus alone would not read them. */}
      <p role="status" data-testid="outcome" className={outcome ? "mt-3 rounded-card bg-soft p-3 text-[15px] font-semibold text-ink" : "sr-only"}>
        {outcome ?? ""}
      </p>
      {alert}

      {mode !== "reschedule" && (
        <section data-testid="manage" aria-label={t("title")} className="mt-8 rounded-[18px] border border-line bg-white p-5 sm:p-6">
          {cancelled && !outcome && <p className="mb-2 text-[15px] text-mute">{t("cancelledLead", { when: props.when })}</p>}
          <dl className="text-[15px]">
            <div className={row}>
              <dt className="text-mute">{t("when")}</dt>
              <dd data-testid="manage-when" className={`font-semibold text-ink ${cancelled ? "line-through" : ""}`}>
                {props.when}
                <span className="ml-2 text-sm font-normal text-mute no-underline">{t("tz")}</span>
              </dd>
            </div>
            <div className={row}>
              <dt className="text-mute">{t("treatment")}</dt>
              <dd className="font-semibold text-ink">{props.treatment}</dd>
            </div>
            <div className={row}>
              <dt className="text-mute">{t("dentist")}</dt>
              <dd className="font-semibold text-ink">{props.dentist}</dd>
            </div>
            <div className={`${row} border-b-0`}>
              <dt className="text-mute">{t("where")}</dt>
              <dd className="text-ink">{props.where}</dd>
            </div>
          </dl>

          {cancelled ? (
            <Link href="/book" className={`${primary} mt-4`}>
              {t("bookAgain")}
            </Link>
          ) : props.canChange ? (
            mode === "cancel" ? (
              <div className="mt-4 rounded-card bg-soft p-4">
                <h2 ref={cancelRef} tabIndex={-1} className="text-lg font-bold text-ink outline-none">
                  {t("cancelConfirmTitle")}
                </h2>
                <p className="mt-1 text-sm text-mute">{t("cancelConfirmBody")}</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" className={danger} disabled={busy} onClick={doCancel}>
                    {busy ? t("cancelling") : t("cancelYes")}
                  </button>
                  <button type="button" className={secondary} disabled={busy} onClick={leave}>
                    {t("cancelKeep")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" className={primary} onClick={openReschedule}>
                    {t("reschedule")}
                  </button>
                  <button
                    type="button"
                    className={secondary}
                    onClick={() => {
                      setNotice(null);
                      setOutcome(null);
                      focus("cancel");
                      setMode("cancel");
                    }}
                  >
                    {t("cancel")}
                  </button>
                </div>
                <p className="mt-2 text-[13px] text-mute">{t("changeHint")}</p>
              </>
            )
          ) : (
            <div data-testid="call-clinic" className="mt-4 rounded-card bg-soft p-4">
              <h2 className="text-lg font-bold text-ink">{t("callTitle")}</h2>
              <p className="mt-1 text-sm text-ink">{t("callBody", { phone: props.phone.display })}</p>
              <a href={`tel:${props.phone.e164}`} className={`${primary} mt-3`}>
                {t("callCta", { phone: props.phone.display })}
              </a>
            </div>
          )}
        </section>
      )}

      {mode === "reschedule" && (
        <section className="mt-2">
          <p className="mt-1 text-[15px] text-mute">{t("rescheduleSub")}</p>
          <p className="mt-1 text-sm text-ink">
            {props.treatment} · {props.dentist}
          </p>
          {day && <DayStrip day={day} disabled={loadingDay || busy} onPick={pickDay} />}
          <div aria-busy={loadingDay} className={loadingDay ? "opacity-60 transition-opacity" : ""}>
            {day &&
              (day.slots.length > 0 ? (
                <SlotGrid
                  slots={day.slots}
                  dayLabel={current?.long ?? day.date}
                  selected={selected}
                  disabled={loadingDay || busy}
                  onPick={setSelected}
                />
              ) : (
                <p className="mt-6 rounded-card bg-soft p-4 text-sm text-ink">{anyDay ? tt("noSlots") : tt("noDays")}</p>
              ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={primary}
              disabled={!selected || busy || loadingDay}
              onClick={move}
            >
              {busy
                ? t("moving")
                : selected && day && current
                  ? t("move", { when: `${current.short}, ${day.slots.find((s) => s.start === selected)?.label ?? ""}` })
                  : t("moveIdle")}
            </button>
            <button type="button" className={secondary} disabled={busy} onClick={leave}>
              {t("back")}
            </button>
          </div>
          {!selected && <p className="mt-2 text-[13px] text-mute">{t("selectHint")}</p>}
        </section>
      )}
    </div>
  );
}
