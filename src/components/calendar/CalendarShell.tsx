"use client";

import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { move } from "@/app/[locale]/staff/(app)/calendar/actions";
import { useRouter as useLocaleRouter } from "@/i18n/navigation";
import { PX_PER_MIN, minToTime, minutesToY, timeToMin, yToSnappedMinutes } from "@/lib/calendar/geometry";
import { formatLongDate, istanbulDateOf, istanbulTimeOf } from "@/lib/time";
import AppointmentDialog from "./AppointmentDialog";
import BlockDialog from "./BlockDialog";
import Counters from "./Counters";
import DayGrid from "./DayGrid";
import type { EntryDragData } from "./EntryBlock";
import Legend from "./Legend";
import NewAppointmentDialog from "./NewAppointmentDialog";
import Toolbar from "./Toolbar";
import WeekGrid from "./WeekGrid";
import { errorKey } from "./errors";
import { btnGhost } from "./ui";
import type { CalendarProps, Column, Override, ToastMsg } from "./types";

type DialogState =
  | { kind: "entry"; id: string }
  | { kind: "newAppt" }
  | { kind: "newBlock" }
  | null;

/**
 * The interactive calendar: toolbar, counters, the grid with drag-and-drop, the dialogs and the
 * toast. All times arrive as Istanbul clock minutes from the server; nothing here reads the
 * browser's time zone.
 */
export default function CalendarShell(p: CalendarProps) {
  const t = useTranslations("staff.calendar");
  const router = useRouter();
  const localeRouter = useLocaleRouter();
  const [, startRefresh] = useTransition();

  const [dialog, setDialog] = useState<DialogState>(p.openId ? { kind: "entry", id: p.openId } : null);
  // `?open=<id>` can change without a remount (a conflict link to another day): open it then too.
  const [seenOpenId, setSeenOpenId] = useState(p.openId);
  if (p.openId !== seenOpenId) {
    setSeenOpenId(p.openId);
    if (p.openId) setDialog({ kind: "entry", id: p.openId });
  }
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<EntryDragData | null>(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);

  const entries = useMemo(() => new Map(p.entries.map((e) => [e.id, e])), [p.entries]);
  const outside = useMemo(() => new Set(p.outsideHours), [p.outsideHours]);
  const treatmentDentists = useMemo(() => new Map(p.treatments.map((tr) => [tr.id, tr.dentistIds])), [p.treatments]);
  const columns = useMemo(() => new Map(p.columns.map((c) => [c.key, c])), [p.columns]);
  const openMin = timeToMin(p.bounds.open);
  const closeMin = timeToMin(p.bounds.close);

  // --- toast ------------------------------------------------------------------------------------
  const toastSeq = useRef(0);
  function say(kind: ToastMsg["kind"], text: string) {
    setToast({ kind, text, n: ++toastSeq.current });
  }
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast((cur) => (cur?.n === toast.n ? null : cur)), toast.kind === "error" ? 9000 : 6000);
    return () => clearTimeout(id);
  }, [toast]);

  // --- focus return -----------------------------------------------------------------------------
  // The entry that opened the dialog gets focus back on close; after a refresh it may have been
  // re-rendered (another column), so retry on the next renders until it is found.
  const pendingFocus = useRef<string | null>(null);
  /** Set when the open entry was cancelled or deleted: focus goes to the heading instead. */
  const entryGone = useRef(false);
  function focusEntry(id: string | null) {
    pendingFocus.current = id ?? "#title";
    tryFocus();
  }
  function tryFocus() {
    const id = pendingFocus.current;
    if (!id) return;
    const el =
      id === "#title"
        ? document.getElementById("cal-title")
        : document.querySelector<HTMLElement>(`[data-testid="entry"][data-entry-id="${CSS.escape(id)}"]`);
    if (el) {
      el.focus();
      pendingFocus.current = null;
    }
  }
  useEffect(() => {
    if (pendingFocus.current && (document.activeElement === document.body || !document.activeElement)) tryFocus();
  });

  function entryClosed(id: string) {
    focusEntry(entryGone.current ? null : id);
  }

  function refresh() {
    startRefresh(() => router.refresh());
  }

  // --- opening entries --------------------------------------------------------------------------
  const suppressClick = useRef(false);
  function openEntry(id: string) {
    if (suppressClick.current) return;
    entryGone.current = false;
    setDialog({ kind: "entry", id });
  }
  function closeDialog() {
    setDialog(null);
  }
  function done(text: string, gone = false) {
    entryGone.current = gone;
    setDialog(null);
    say("ok", text);
    refresh();
  }
  function openFromConflict(id: string, startIso: string) {
    if (entries.has(id)) {
      entryGone.current = false;
      setDialog({ kind: "entry", id });
      return;
    }
    const d = istanbulDateOf(new Date(startIso));
    localeRouter.push(`/staff/calendar?view=day&date=${d}&open=${id}`);
  }

  // --- drag and drop ----------------------------------------------------------------------------
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  /** The dragged block's top edge snaps to the 15-minute grid and stays inside the day. */
  const snapModifier: Modifier = ({ transform, active }) => {
    const d = active?.data.current as EntryDragData | undefined;
    if (!d) return transform;
    const top0 = minutesToY(d.startMin - openMin, PX_PER_MIN);
    const maxTop = minutesToY(closeMin - openMin, PX_PER_MIN) - d.height;
    const snapped = minutesToY(yToSnappedMinutes(Math.min(Math.max(top0 + transform.y, 0), maxTop), PX_PER_MIN), PX_PER_MIN);
    return { ...transform, y: snapped - top0 };
  };

  function onDragStart(e: DragStartEvent) {
    suppressClick.current = true;
    setDragging((e.active.data.current as EntryDragData) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const d = e.active.data.current as EntryDragData | undefined;
    const col = e.over ? columns.get(String(e.over.id)) : undefined;
    const entry = d ? entries.get(d.entryId) : undefined;
    if (!d || !col || !entry) return;
    const top = minutesToY(d.startMin - openMin, PX_PER_MIN) + e.delta.y;
    const startMin = openMin + yToSnappedMinutes(Math.max(top, 0), PX_PER_MIN);
    const from = istanbulDateOf(new Date(entry.start));
    if (col.dentistId === entry.dentistId && col.date === from && startMin === d.startMin) return;
    void save(entry.id, `${entry.dentistId}|${entry.start}`, col, startMin, entry.dentistId);
  }

  async function save(id: string, base: string, col: Column, startMin: number, fromDentist: number) {
    setOverrides((o) => ({ ...o, [id]: { base, dentistId: col.dentistId, date: col.date, startMin } }));
    setSavingId(id);
    const revert = () =>
      setOverrides((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
    try {
      const time = minToTime(startMin);
      const r = await move({
        appointmentId: id,
        date: col.date,
        time,
        dentistId: col.dentistId !== fromDentist ? col.dentistId : undefined,
      });
      if (r.ok) {
        say("ok", t("toast.moved", { when: `${formatLongDate(col.date, p.locale)}, ${time}` }));
        refresh();
      } else {
        revert();
        say("error", t(errorKey(r.code)));
        if (r.code === "not_found") refresh();
      }
    } catch {
      revert();
      say("error", t("errors.generic"));
    } finally {
      setSavingId((s) => (s === id ? null : s));
    }
  }

  const announcements = {
    onDragStart: ({ active }: { active: { data: { current?: unknown } } }) =>
      t("drag.picked", { name: (active.data.current as EntryDragData | undefined)?.name ?? "" }),
    onDragOver: ({ over }: { over: { id: string | number } | null }) =>
      over ? t("drag.over", { column: columns.get(String(over.id))?.title ?? "" }) : undefined,
    onDragEnd: ({ active }: { active: { data: { current?: unknown } } }) =>
      t("drag.dropped", { name: (active.data.current as EntryDragData | undefined)?.name ?? "" }),
    onDragCancel: ({ active }: { active: { data: { current?: unknown } } }) =>
      t("drag.cancelled", { name: (active.data.current as EntryDragData | undefined)?.name ?? "" }),
  };

  // --- render -----------------------------------------------------------------------------------
  const open = dialog?.kind === "entry" ? entries.get(dialog.id) : undefined;
  const nowMin = timeToMin(istanbulTimeOf(new Date(p.nowIso)));
  const gridProps = {
    columns: p.columns,
    bounds: p.bounds,
    items: p.items,
    entries,
    overrides,
    outside,
    nowIso: p.nowIso,
    dragging,
    treatmentDentists,
    savingId,
    label: `${t("region")}: ${p.title}`,
    onOpen: openEntry,
  };
  const attention = p.outsideHours.length;
  const mineItem = p.items.find((it) => entries.get(it.entryId)?.mine && p.columns.some((c) => c.key === `${it.dentistId}|${it.date}`));


  return (
    <section data-testid="calendar" data-view={p.view} data-date={p.date} aria-labelledby="cal-title">
      <Toolbar
        view={p.view}
        title={p.title}
        hrefs={p.hrefs}
        dentists={p.dentists}
        weekDentistId={p.weekDentistId}
        date={p.date}
        canBlock={p.blockable.length > 0}
        canCreate={p.manageable.length > 0}
        onBlock={() => setDialog({ kind: "newBlock" })}
        onWalkIn={() => setDialog({ kind: "newAppt" })}
      />
      {mineItem && (
        <div
          data-testid="mine-callout"
          className="mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-mine bg-[#fff8e6] px-3.5 py-2.5 text-[13px] text-ink"
        >
          <span aria-hidden="true" className="text-[15px] text-[#8a6100]">
            ★
          </span>
          <span>
            {t("mineCallout", {
              name: entries.get(mineItem.entryId)?.patientName ?? "",
              time: p.view === "day" ? mineItem.startTime : `${formatLongDate(mineItem.date, p.locale)}, ${mineItem.startTime}`,
              dentist: p.dentists.find((d) => d.id === mineItem.dentistId)?.name ?? "",
            })}
          </span>
          <button type="button" onClick={() => openEntry(mineItem.entryId)} className={`${btnGhost} sm:ml-auto`}>
            {t("mineOpen")}
          </button>
        </div>
      )}
      <Counters counters={p.counters} attention={attention} view={p.view} />
      <p id="cal-drag-help" hidden>
        {t("drag.instructions")}
      </p>
      <DndContext
        id="staff-calendar"
        sensors={sensors}
        collisionDetection={pointerWithin}
        modifiers={[snapModifier]}
        autoScroll={false}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragging(null);
          setTimeout(() => {
            suppressClick.current = false;
          }, 0);
        }}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t("drag.instructions") } }}
      >
        {p.view === "day" ? <DayGrid {...gridProps} /> : <WeekGrid {...gridProps} />}
      </DndContext>
      <Legend />

      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex max-w-sm flex-col items-end gap-2">
        <div role="status" aria-live="polite" className="flex flex-col items-end">
          {toast?.kind === "ok" && <Toast text={toast.text} kind="ok" onDismiss={() => setToast(null)} label={t("toast.dismiss")} />}
        </div>
        <div role="alert" className="flex flex-col items-end">
          {toast?.kind === "error" && <Toast text={toast.text} kind="error" onDismiss={() => setToast(null)} label={t("toast.dismiss")} />}
        </div>
      </div>

      {dialog?.kind === "entry" && open?.kind === "appointment" && (
        <AppointmentDialog
          key={open.id}
          entry={open}
          locale={p.locale}
          dentists={p.dentists}
          treatment={p.treatments.find((tr) => tr.id === open.treatmentId)}
          manageable={p.manageable}
          outside={outside.has(open.id)}
          onClose={closeDialog}
          onCloseFocus={() => entryClosed(open.id)}
          onDone={done}
        />
      )}
      {dialog?.kind === "entry" && open?.kind === "block" && (
        <BlockDialog
          key={open.id}
          locale={p.locale}
          entry={open}
          date={p.date}
          dentists={p.dentists}
          blockable={p.blockable}
          selfDentistId={p.selfDentistId}
          onClose={closeDialog}
          onCloseFocus={() => entryClosed(open.id)}
          onDone={(text) => done(text, true)}
          onOpenAppointment={openFromConflict}
        />
      )}
      {dialog?.kind === "newBlock" && (
        <BlockDialog
          locale={p.locale}
          date={p.date}
          dentists={p.dentists}
          blockable={p.blockable}
          selfDentistId={p.selfDentistId}
          onClose={closeDialog}
          onDone={(text) => done(text)}
          onOpenAppointment={openFromConflict}
        />
      )}
      {dialog?.kind === "newAppt" && (
        <NewAppointmentDialog
          locale={p.locale}
          date={p.date}
          today={p.today}
          nowMin={nowMin}
          treatments={p.treatments}
          dentists={p.dentists}
          manageable={p.manageable}
          onClose={closeDialog}
          onDone={(text, date) => {
            if (p.columns.some((c) => c.date === date)) return done(text);
            // Created on a day that isn't shown: go there so the new entry is visible.
            setDialog(null);
            say("ok", text);
            localeRouter.push(
              p.view === "week"
                ? `/staff/calendar?view=week&date=${date}&dentist=${p.weekDentistId}`
                : `/staff/calendar?view=day&date=${date}`,
            );
          }}
        />
      )}
    </section>
  );
}

function Toast({ text, kind, onDismiss, label }: { text: string; kind: "ok" | "error"; onDismiss: () => void; label: string }) {
  return (
    <div
      data-testid="toast"
      data-kind={kind}
      className={`pointer-events-auto flex items-start gap-3 rounded-card px-4 py-3 text-[14px] font-semibold shadow-[0_10px_30px_rgba(16,48,46,0.2)] ${
        kind === "ok" ? "bg-ink text-white" : "bg-[#8a1c14] text-white"
      }`}
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={label}
        className="-my-0.5 cursor-pointer rounded-full px-1.5 text-white/80 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
