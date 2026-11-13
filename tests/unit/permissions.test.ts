import { describe, expect, it } from "vitest";
import { ACTIONS, can, type Action } from "@/lib/auth/permissions";
import type { Actor, Role } from "@/lib/auth/actor";

const actor = (role: Role, dentistId: number | null = null): Actor => ({
  userId: `u-${role}`,
  name: role,
  role,
  dentistId,
});

const receptionist = actor("receptionist");
const admin = actor("admin");
const dentist = actor("dentist", 1);
const own = { dentistId: 1 };
const other = { dentistId: 2 };

// Spec §7.1. "own" = the dentist's own calendar/patients; "other" = another dentist's.
// Columns: receptionist, admin, dentist (no target), dentist own, dentist other.
const TABLE: Record<Action, [boolean, boolean, boolean, boolean, boolean]> = {
  "calendar.viewAll": [true, true, true, true, true],
  "appointment.manage": [true, true, false, true, false],
  "appointment.status": [true, true, false, true, false],
  "block.manage": [true, true, false, true, false],
  "requests.view": [true, true, false, false, false],
  "reminders.view": [true, true, false, false, false],
  "patients.view": [true, true, true, true, true],
  "settings.view": [false, true, false, false, false],
  "settings.edit": [false, true, false, false, false],
};

describe("can (spec §7.1)", () => {
  it("the table covers every action", () => {
    expect(Object.keys(TABLE).sort()).toEqual([...ACTIONS].sort());
  });

  for (const action of ACTIONS) {
    const [rec, adm, den, denOwn, denOther] = TABLE[action];
    it(`${action}: receptionist ${rec}, admin ${adm}, dentist ${den}/${denOwn}/${denOther}`, () => {
      expect(can(receptionist, action)).toBe(rec);
      expect(can(receptionist, action, other)).toBe(rec);
      expect(can(admin, action)).toBe(adm);
      expect(can(admin, action, other)).toBe(adm);
      expect(can(dentist, action)).toBe(den);
      expect(can(dentist, action, own)).toBe(denOwn);
      expect(can(dentist, action, other)).toBe(denOther);
    });
  }

  it("dentist cannot manage another dentist's block", () => {
    expect(can(dentist, "block.manage", other)).toBe(false);
  });

  it("dentist can set status on own appointment", () => {
    expect(can(dentist, "appointment.status", own)).toBe(true);
  });

  it("reminders.view is allowed for receptionist and admin, not dentist", () => {
    expect(can(receptionist, "reminders.view")).toBe(true);
    expect(can(admin, "reminders.view")).toBe(true);
    expect(can(dentist, "reminders.view")).toBe(false);
    expect(can(dentist, "reminders.view", own)).toBe(false);
  });

  it("receptionist cannot edit settings", () => {
    expect(can(receptionist, "settings.edit")).toBe(false);
  });

  it("a dentist login without a linked profile owns nothing", () => {
    const unlinked = actor("dentist", null);
    expect(can(unlinked, "block.manage", { dentistId: undefined })).toBe(false);
    expect(can(unlinked, "appointment.manage", {})).toBe(false);
  });

  it("an unknown role gets nothing", () => {
    const weird = { ...receptionist, role: "intern" as Role };
    for (const a of ACTIONS) expect(can(weird, a)).toBe(false);
  });
});
