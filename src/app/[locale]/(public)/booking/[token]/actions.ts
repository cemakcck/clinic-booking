"use server";

import { headers } from "next/headers";
import { db } from "@/lib/db/client";
import { BookingError, type BookingErrorCode } from "@/lib/booking/errors";
import { cancelByPatient, getByManageToken, rescheduleByPatient } from "@/lib/booking/manage";
import { notifyPatient } from "@/lib/booking/notify";
import { loadDayData, type DayData } from "@/lib/booking/wizard";
import { clientIp } from "@/lib/security/client-ip";
import { hashIp } from "@/lib/security/hash-ip";
import { formatLongDate, formatSlotTime } from "@/lib/time";
import { routing, type Locale } from "@/i18n/routing";

export type Fail = { ok: false; code: BookingErrorCode };
export type ManageDayResult = ({ ok: true } & DayData) | Fail;
export type RescheduleResult = { ok: true; when: string } | Fail;
export type CancelResult = { ok: true } | Fail;

const fail = (code: BookingErrorCode): Fail => ({ ok: false, code });
const asLocale = (l: unknown): Locale =>
  typeof l === "string" && (routing.locales as readonly string[]).includes(l) ? (l as Locale) : routing.defaultLocale;

/** Known booking errors become a result; anything else is a bug and is rethrown. */
function toFail(e: unknown): Fail {
  if (e instanceof BookingError) return fail(e.code);
  throw e;
}

/** Free times for moving this appointment: same dentist and treatment, its own time counts as free. */
export async function loadManageDay(input: { locale: string; token: string; date?: string }): Promise<ManageDayResult> {
  const conn = await db();
  const now = new Date();
  const view = await getByManageToken(conn, String(input?.token), now);
  if (!view || !view.canChange) return fail(view ? "too_late" : "not_found");
  const day = await loadDayData(conn, {
    treatmentId: view.treatmentId,
    dentistId: view.dentistId,
    date: input.date,
    now,
    locale: asLocale(input.locale),
    ignoreEntryId: view.appointmentId,
  });
  return { ok: true, ...day };
}

export async function rescheduleAppointment(input: { locale: string; token: string; start: string }): Promise<RescheduleResult> {
  const locale = asLocale(input?.locale);
  const start = new Date(typeof input?.start === "string" ? input.start : NaN);
  if (Number.isNaN(start.getTime())) return fail("invalid");
  const conn = await db();
  const now = new Date();
  const token = String(input.token);
  let id: string;
  try {
    const view = await getByManageToken(conn, token, now);
    if (!view) return fail("not_found");
    id = view.appointmentId;
    await rescheduleByPatient(conn, token, start, now);
  } catch (e) {
    return toFail(e);
  }
  // After the commit: no email while a dentist lock is held.
  await notifyPatient(conn, "booking_rescheduled", id, {
    trigger: "patient",
    ipHash: hashIp(clientIp(await headers())),
    manageToken: token,
    now,
  });
  return { ok: true, when: `${formatLongDate(start, locale)}, ${formatSlotTime(start, locale)}` };
}

export async function cancelAppointment(input: { token: string }): Promise<CancelResult> {
  const conn = await db();
  const now = new Date();
  const token = String(input?.token);
  let id: string;
  let already: boolean;
  try {
    const view = await getByManageToken(conn, token, now);
    if (!view) return fail("not_found");
    id = view.appointmentId;
    already = view.status === "cancelled";
    await cancelByPatient(conn, token, now);
  } catch (e) {
    return toFail(e);
  }
  if (!already) {
    await notifyPatient(conn, "booking_cancelled", id, {
      trigger: "patient",
      ipHash: hashIp(clientIp(await headers())),
      now,
    });
  }
  return { ok: true };
}
