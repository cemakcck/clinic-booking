import type { CalEntry, ColumnHours, Counters, GridItem } from "@/lib/staff/calendar-data";

export type { CalEntry, ColumnHours, Counters, GridItem };

/** One droppable column of the grid: a dentist on a date (day view) or a date of one dentist (week). */
export type Column = {
  key: string;
  dentistId: number;
  date: string;
  title: string;
  sub?: string;
  hours: ColumnHours;
  isToday: boolean;
  /** The viewer may put appointments here (drag target, dialog dentist choice). */
  canManage: boolean;
};

export type TreatmentOpt = { id: number; name: string; durationMin: number; dentistIds: number[] };

export type Override = { base: string; dentistId: number; date: string; startMin: number };

export type CalendarProps = {
  locale: "en" | "tr";
  view: "day" | "week";
  date: string;
  today: string;
  nowIso: string;
  title: string;
  hrefs: { prev: string; next: string; today: string; day: string; week: string };
  bounds: { open: string; close: string };
  columns: Column[];
  entries: CalEntry[];
  items: GridItem[];
  counters: Counters;
  outsideHours: string[];
  dentists: { id: number; name: string }[];
  /** Dentists whose appointments / blocks the viewer may change (all for reception and admin). */
  manageable: number[];
  blockable: number[];
  selfDentistId: number | null;
  treatments: TreatmentOpt[];
  weekDentistId: number | null;
  openId: string | null;
};

export type ToastMsg = { kind: "ok" | "error"; text: string; n: number };
