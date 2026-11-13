import type { Db } from "@/lib/db/client";
import { can } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/roles";
import { BookingError } from "@/lib/booking/errors";
import { isDemo } from "@/lib/demo/mode";
import type { EmailDeps } from "@/lib/email/send";
import { checkAndRecordRate } from "@/lib/security/rate-limit";
import { runReminders, type ReminderRunResult } from "./run";

export type SendNowResult =
  | { ok: true; result: ReminderRunResult }
  | { ok: false; reason: "not_found" | "forbidden" | "no_bookings" | "rate_limited" };

/**
 * "Send my reminders now" (spec §4.5): demo mode only. Reminds just the visitor's own bookings
 * (`mine`, from the signed demo_mine cookie) right away; runReminders still requires them to be
 * booked and in the future, and keeps every anti-abuse rule and the exactly-once claim.
 * Rate-limited per IP hash like phase 1's other demo actions.
 */
export async function sendRemindersNow(
  db: Db,
  actor: Actor,
  q: { mine: string[]; ipHash: string; now: Date; deps?: EmailDeps },
): Promise<SendNowResult> {
  if (!isDemo()) return { ok: false, reason: "not_found" };
  if (!can(actor, "reminders.view")) return { ok: false, reason: "forbidden" };
  if (q.mine.length === 0) return { ok: false, reason: "no_bookings" };
  try {
    await checkAndRecordRate(db, "reminders", q.ipHash, q.now);
  } catch (e) {
    if (e instanceof BookingError && e.code === "rate_limited") return { ok: false, reason: "rate_limited" };
    throw e;
  }
  const result = await runReminders(db, q.now, { onlyEntryIds: q.mine, ipHash: q.ipHash, deps: q.deps });
  return { ok: true, result };
}
