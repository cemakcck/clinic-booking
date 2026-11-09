import type { Role } from "./roles";

export function roleHome(role: Role, locale: string): string {
  return role === "dentist" ? `/${locale}/staff/today` : `/${locale}/staff/calendar`;
}

// Path segments of letters, digits, - and _, then an optional plain query string.
const SAFE = /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\?[A-Za-z0-9_\-=&.:%]*)?$/;

/**
 * Only same-site paths inside the current locale's staff area pass; anything else gives null,
 * so a crafted `next` can never redirect off-site (no "//host", no "\", no "..", no CR/LF).
 */
export function safeStaffNext(next: string | undefined | null, locale: string): string | null {
  if (!next || next.length > 300 || !SAFE.test(next)) return null;
  const base = `/${locale}/staff`;
  const path = next.split("?")[0];
  if (path !== base && !path.startsWith(`${base}/`)) return null;
  return next;
}
