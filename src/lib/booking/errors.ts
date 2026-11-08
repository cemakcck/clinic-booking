export type BookingErrorCode =
  | "slot_taken"
  | "outside_rules"
  | "hold_expired"
  | "too_late"
  | "link_expired"
  | "rate_limited"
  | "block_conflict"
  | "capacity_floor"
  | "forbidden"
  | "demo_disabled"
  | "not_found"
  | "invalid";

export class BookingError extends Error {
  constructor(
    public code: BookingErrorCode,
    public details?: unknown,
  ) {
    super(code);
    this.name = "BookingError";
  }
}
