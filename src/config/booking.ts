export const SLOT_STEP_MIN = 15;
export const HOLD_MINUTES = 5;
export const PUBLIC_MIN_LEAD_MIN = 120;
export const PUBLIC_HORIZON_DAYS = 60;
export const STAFF_MIN_LEAD_MIN = -60;
export const STAFF_HORIZON_DAYS = 365;
export const MANAGE_CUTOFF_HOURS = 24;
export const DEMO_FLOOR = { minSlots: 4, days: 3, probeDurationMin: 30 };
export const EMAIL_CAP_PER_ADDRESS_PER_DAY = 5;
export const EMAIL_CAP_PER_IP_PER_DAY = 10;
export const RATE = {
  hold: [20, 3_600_000],
  confirm: [10, 3_600_000],
  callback: [5, 3_600_000],
} as const;
