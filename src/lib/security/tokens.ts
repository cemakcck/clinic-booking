import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url (43 chars). Only its hash is ever stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

/** Deterministic manage token for a hold, so a repeated confirm returns the already-emailed link. */
export function deriveManageToken(holdToken: string): string {
  return createHash("sha256").update(`manage:${holdToken}`).digest("base64url");
}
