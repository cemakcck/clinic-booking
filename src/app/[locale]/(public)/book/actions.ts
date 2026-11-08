"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { BookingError, type BookingErrorCode } from "@/lib/booking/errors";
import { confirmBooking, placeHold } from "@/lib/booking/holds";
import { normalizePhone } from "@/lib/booking/patients";
import { notifyPatient } from "@/lib/booking/notify";
import { loadDayData, resolveSelection, type DayData } from "@/lib/booking/wizard";
import { dentistName } from "@/lib/public/queries";
import { MINE_COOKIE, mineCookieOptions, parseMine, withMine } from "@/lib/demo/mine";
import { isDemo } from "@/lib/demo/mode";
import { clientIp } from "@/lib/security/client-ip";
import { hashIp } from "@/lib/security/hash-ip";
import { formatLongDate, formatSlotTime } from "@/lib/time";
import { routing, type Locale } from "@/i18n/routing";

export type Fail = { ok: false; code: BookingErrorCode; fieldErrors?: Record<string, string> };
export type LoadDayResult = ({ ok: true } & DayData) | Fail;
export type HoldResult =
  | { ok: true; holdId: string; holdToken: string; dentistId: number; dentistName: string; expiresAt: string; when: string }
  | Fail;
export type ConfirmResult = { ok: true; redirectTo: string } | Fail;

const fail = (code: BookingErrorCode, fieldErrors?: Record<string, string>): Fail => ({ ok: false, code, fieldErrors });
const asLocale = (l: unknown): Locale =>
  typeof l === "string" && (routing.locales as readonly string[]).includes(l) ? (l as Locale) : routing.defaultLocale;

async function ipHash() {
  return hashIp(clientIp(await headers()));
}

/** Known booking errors become a result; anything else is a bug and is rethrown. */
function toFail(e: unknown): Fail {
  if (e instanceof BookingError) return fail(e.code);
  throw e;
}

export async function loadDay(input: {
  locale: string;
  treatment: string;
  dentist: string;
  date: string;
}): Promise<LoadDayResult> {
  const locale = asLocale(input?.locale);
  const conn = await db();
  const sel = await resolveSelection(conn, locale, input?.treatment, input?.dentist);
  if (!sel || sel.dentistId === null) return fail("invalid");
  const day = await loadDayData(conn, {
    treatmentId: sel.treatment.id,
    dentistId: sel.dentistId,
    date: input.date,
    now: new Date(),
    locale,
  });
  return { ok: true, ...day };
}

export async function holdSlot(input: {
  locale: string;
  treatment: string;
  dentist: string;
  start: string;
}): Promise<HoldResult> {
  const locale = asLocale(input?.locale);
  const start = new Date(typeof input?.start === "string" ? input.start : NaN);
  if (Number.isNaN(start.getTime())) return fail("invalid");
  const conn = await db();
  const sel = await resolveSelection(conn, locale, input.treatment, input.dentist);
  if (!sel || sel.dentistId === null) return fail("invalid");
  try {
    const h = await placeHold(conn, {
      treatmentId: sel.treatment.id,
      dentistId: sel.dentistId,
      start,
      now: new Date(),
      ipHash: await ipHash(),
    });
    return {
      ok: true,
      holdId: h.holdId,
      holdToken: h.holdToken,
      dentistId: h.dentistId,
      dentistName: (await dentistName(conn, h.dentistId)) ?? "",
      expiresAt: h.expiresAt.toISOString(),
      when: `${formatLongDate(start, locale)}, ${formatSlotTime(start, locale)}`,
    };
  } catch (e) {
    return toFail(e);
  }
}

const detailsSchema = z.object({
  holdId: z.uuid("invalid"),
  holdToken: z.string().min(20, "invalid").max(200, "invalid"),
  // CR/LF and runs of whitespace collapse to one space; Turkish letters are kept as typed.
  name: z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(2, "name").max(80, "name")),
  phone: z
    .string()
    .trim()
    .max(40, "phone")
    .refine((v) => normalizePhone(v) !== null, "phone"),
  email: z.string().trim().max(254, "email").pipe(z.email("email")),
  language: z.enum(routing.locales),
  privacy: z.literal(true, "privacy"),
});

export async function confirm(input: {
  holdId: string;
  holdToken: string;
  name: string;
  phone: string;
  email: string;
  /** The page locale, for the redirect. */
  locale: string;
  /** The patient's language for emails. */
  language: string;
  privacy: boolean;
  website?: string;
}): Promise<ConfirmResult> {
  // A filled honeypot is a bot: nothing is stored and no rate budget is spent.
  if (typeof input?.website === "string" && input.website.length > 0) return fail("invalid", { form: "invalid" });

  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      const field = key === "holdId" || key === "holdToken" ? "form" : key;
      fieldErrors[field] ??= ["name", "phone", "email", "privacy"].includes(issue.message) ? issue.message : "invalid";
    }
    return fail("invalid", fieldErrors);
  }
  const v = parsed.data;
  const conn = await db();
  const now = new Date();
  const ip = await ipHash();

  let booked;
  try {
    booked = await confirmBooking(conn, {
      holdId: v.holdId,
      holdToken: v.holdToken,
      patient: { name: v.name, phone: v.phone, email: v.email, locale: v.language },
      now,
      ipHash: ip,
    });
  } catch (e) {
    return toFail(e);
  }

  // Only the first confirm emails; a double submit gets the same link without a second email.
  if (booked.created) {
    await notifyPatient(conn, "booking_confirmation", booked.appointmentId, {
      trigger: "patient",
      ipHash: ip,
      manageToken: booked.manageToken,
      now,
    });
  }

  if (isDemo()) {
    const jar = await cookies();
    const list = withMine(parseMine(jar.get(MINE_COOKIE)?.value), booked.appointmentId);
    jar.set(MINE_COOKIE, JSON.stringify(list), mineCookieOptions);
  }

  const pageLocale = asLocale(input.locale);
  return { ok: true, redirectTo: `/${pageLocale}/book/done?t=${encodeURIComponent(booked.manageToken)}` };
}
