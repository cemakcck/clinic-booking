import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * "Mine" cookie: the ids of the last few appointments booked in this browser, so the staff
 * calendar can highlight the visitor's own booking (the demo's magic moment) and unmask its
 * contact details. Because it unmasks, it is HMAC-signed with BETTER_AUTH_SECRET: entry ids are
 * visible to staff, and an unsigned list would let a visitor claim someone else's booking.
 * Format: `<id>,<id>,….<base64url hmac>`.
 */
export const MINE_COOKIE = "demo_mine";
export const MINE_MAX = 5;

export const mineCookieOptions = {
  httpOnly: true,
  path: "/",
  maxAge: 7 * 24 * 3600,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(payload: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`demo_mine:${payload}`).digest("base64url");
}

/** The signed cookie value for a list of appointment ids (non-uuids dropped, capped at 5). */
export function encodeMine(list: string[]): string {
  const payload = list.filter((x) => UUID.test(x)).slice(0, MINE_MAX).join(",");
  return `${payload}.${sign(payload)}`;
}

/** Safe against anything: unsigned, tampered or malformed values all give []. */
export function parseMine(raw?: string): string[] {
  if (!raw) return [];
  try {
    const text = raw.includes("%") ? decodeURIComponent(raw) : raw;
    const dot = text.lastIndexOf(".");
    if (dot < 0) return [];
    const payload = text.slice(0, dot);
    const got = Buffer.from(text.slice(dot + 1));
    const want = Buffer.from(sign(payload));
    if (got.length !== want.length || !timingSafeEqual(got, want)) return [];
    return payload
      .split(",")
      .filter((x) => UUID.test(x))
      .slice(0, MINE_MAX);
  } catch {
    return [];
  }
}

export function withMine(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MINE_MAX);
}
