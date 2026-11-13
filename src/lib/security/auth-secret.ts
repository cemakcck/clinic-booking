/** The value `.env.example` ships with, so a copied file runs locally without edits. */
export const EXAMPLE_AUTH_SECRET = "local-dev-only-secret-replace-in-production";

/**
 * The secret that signs sessions and the demo cookie. A production deploy on Vercel refuses the
 * public `.env.example` placeholder: anyone could forge cookies with it.
 */
export function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  if (secret === EXAMPLE_AUTH_SECRET && process.env.VERCEL_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is the .env.example placeholder; set a fresh secret for production");
  }
  return secret;
}
