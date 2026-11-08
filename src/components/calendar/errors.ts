const CODES = new Set([
  "slot_taken",
  "outside_rules",
  "hold_expired",
  "too_late",
  "link_expired",
  "rate_limited",
  "block_conflict",
  "capacity_floor",
  "forbidden",
  "demo_disabled",
  "not_found",
  "invalid",
]);

/** The `staff.calendar` message key for a BookingErrorCode (anything unknown is generic). */
export function errorKey(code: string | undefined): string {
  return code && CODES.has(code) ? `errors.${code}` : "errors.generic";
}
