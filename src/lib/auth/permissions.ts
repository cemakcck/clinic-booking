import type { Actor } from "./roles";

export const ACTIONS = [
  "calendar.viewAll",
  "appointment.manage",
  "appointment.status",
  "block.manage",
  "requests.view",
  "patients.view",
  "settings.view",
  "settings.edit",
] as const;
export type Action = (typeof ACTIONS)[number];

/** "own" = allowed only when the target belongs to the dentist's own calendar. */
type Rule = boolean | "own";

/** Spec §7.1, one row per action. Pure: no I/O, no session lookups. */
const RULES: Record<Action, Record<Actor["role"], Rule>> = {
  "calendar.viewAll": { receptionist: true, admin: true, dentist: true },
  "appointment.manage": { receptionist: true, admin: true, dentist: "own" },
  "appointment.status": { receptionist: true, admin: true, dentist: "own" },
  "block.manage": { receptionist: true, admin: true, dentist: "own" },
  "requests.view": { receptionist: true, admin: true, dentist: false },
  // Dentists see the list, but the query filters it to their own patients.
  "patients.view": { receptionist: true, admin: true, dentist: true },
  "settings.view": { receptionist: false, admin: true, dentist: false },
  "settings.edit": { receptionist: false, admin: true, dentist: false },
};

export function can(actor: Actor, action: Action, target?: { dentistId?: number }): boolean {
  const rule = RULES[action]?.[actor.role];
  if (rule === "own") {
    return actor.dentistId != null && target?.dentistId != null && target.dentistId === actor.dentistId;
  }
  return rule === true;
}
