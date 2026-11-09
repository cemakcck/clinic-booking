/**
 * The visitor's IP for rate limiting. X-Forwarded-For is client-controlled unless a trusted
 * reverse proxy overwrites it, so in production the site must run behind one (see README).
 */
export function clientIp(headers: Headers): string {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim();
  if (ip) return ip;
  console.warn("[rate-limit] No client IP header; all visitors share one rate-limit bucket. Run behind a proxy that sets X-Forwarded-For.");
  return "unknown";
}
