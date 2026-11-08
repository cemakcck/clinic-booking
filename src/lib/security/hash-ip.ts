import { createHmac } from "node:crypto";

/** Keyed hash of an IP so rate limiting works without storing raw IPs. */
export function hashIp(ip: string, secret: string | undefined = process.env.IP_HASH_SECRET): string {
  if (!secret && process.env.NODE_ENV === "production") {
    console.warn("[privacy] IP_HASH_SECRET is not set; stored IP hashes use a public default key.");
  }
  return createHmac("sha256", secret || "dev-secret").update(ip).digest("hex");
}
