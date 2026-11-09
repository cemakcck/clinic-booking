"use server";

import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { hasLocale } from "next-intl";
import { getLocale } from "next-intl/server";
import { routing, type Locale } from "@/i18n/routing";
import { db } from "@/lib/db/client";
import { getAuth } from "@/lib/auth/auth";
import { roleHome, safeStaffNext } from "@/lib/auth/redirects";
import { isRole } from "@/lib/auth/roles";
import { isDemo } from "@/lib/demo/mode";
import { MINE_COOKIE, parseMine } from "@/lib/demo/mine";
import { newestMineDate } from "@/lib/demo/magic";
import { demoPassword, staffEmail, type DemoStaffRole } from "@/lib/demo/staff-users";
import { checkAndRecordRate } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client-ip";
import { hashIp } from "@/lib/security/hash-ip";
import { BookingError } from "@/lib/booking/errors";

export type SignInState = { error: "invalid" | "missing" | "rateLimited" | null; email: string };

async function currentLocale(): Promise<Locale> {
  const l = await getLocale();
  return hasLocale(routing.locales, l) ? l : routing.defaultLocale;
}

/** Email + password form. On failure, returns the typed email so the form keeps it. */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().slice(0, 200);
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "missing", email };

  const locale = await currentLocale();
  const database = await db();
  const h = await headers();
  // Better Auth rate-limits only its HTTP router; direct auth.api calls need our own limiter.
  try {
    await checkAndRecordRate(database, "signin", hashIp(clientIp(h)), new Date());
  } catch (e) {
    if (e instanceof BookingError && e.code === "rate_limited") return { error: "rateLimited", email };
    throw e;
  }
  let role: string | undefined;
  try {
    const res = await getAuth().api.signInEmail({ body: { email, password }, headers: h });
    role = (res.user as { role?: string }).role;
  } catch (e) {
    if (isAPIError(e)) return { error: "invalid", email };
    throw e;
  }
  redirect(isRole(role) ? roleHome(role, locale) : `/${locale}/staff`);
}

/**
 * Demo one-click sign-in as a seeded staff member. Refused (403) outside demo mode. Without a
 * valid `next`, the receptionist lands on the day of this browser's newest booking (the magic
 * moment), everyone else on their role's home.
 */
export async function demoSignIn(role: DemoStaffRole, next?: string): Promise<void> {
  if (!isDemo() || !isRole(role)) forbidden();
  const locale = await currentLocale();
  const database = await db();
  await getAuth().api.signInEmail({
    body: { email: staffEmail(role), password: demoPassword() },
    headers: await headers(),
  });

  let target = safeStaffNext(typeof next === "string" ? next : null, locale);
  if (!target && role === "receptionist") {
    const date = await newestMineDate(database, parseMine((await cookies()).get(MINE_COOKIE)?.value));
    if (date) target = `/${locale}/staff/calendar?date=${date}`;
  }
  redirect(target ?? roleHome(role, locale));
}

export async function signOut(): Promise<void> {
  const locale = await currentLocale();
  await db();
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch (e) {
    // Already signed out (no or expired session): nothing to undo.
    if (!isAPIError(e)) throw e;
  }
  redirect(`/${locale}/staff/login`);
}
