/**
 * "Mine" cookie: the ids of the last few appointments booked in this browser, so the staff
 * calendar can highlight the visitor's own booking (the demo's magic moment). Never trusted
 * for access, only for highlighting.
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

/** Safe against anything: bad JSON, wrong shapes and non-uuid strings all give []. */
export function parseMine(raw?: string): string[] {
  if (!raw) return [];
  let text = raw;
  try {
    if (text.startsWith("%")) text = decodeURIComponent(text);
    const v: unknown = JSON.parse(text);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, MINE_MAX);
  } catch {
    return [];
  }
}

export function withMine(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MINE_MAX);
}
