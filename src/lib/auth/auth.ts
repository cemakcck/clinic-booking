import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { sharedDb, type Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { authSecret } from "@/lib/security/auth-secret";

/**
 * Endpoints the HTTP router refuses (404). The demo accounts are shared by every visitor, so
 * none may rename them, change their password/email, delete them or sign everyone out. Sign-in
 * and sign-up happen only through our server actions (which apply our own rate limit; direct
 * `auth.api` calls skip Better Auth's limiter), so the raw HTTP sign-in is closed too.
 * /get-session and /sign-out stay open.
 */
export const DISABLED_AUTH_PATHS = [
  "/update-user",
  "/change-password",
  "/change-email",
  "/delete-user",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/revoke-session",
  "/request-password-reset",
  "/reset-password",
  "/sign-up/email",
  "/sign-in/email",
  "/list-sessions",
];

function createAuth(database: Db) {
  return betterAuth({
    secret: authSecret(),
    database: drizzleAdapter(database, { provider: "pg", schema }),
    disabledPaths: DISABLED_AUTH_PATHS,
    databaseHooks: {
      session: {
        // Privacy rule: IPs are stored only as HMAC hashes, so never keep the raw session IP.
        create: { before: async (s) => ({ data: { ...s, ipAddress: null } }) },
        update: { before: async (s) => ({ data: "ipAddress" in s ? { ...s, ipAddress: null } : s }) },
      },
    },
    // Accounts come from the seed and `npm run user:create` only (spec §7.1).
    emailAndPassword: { enabled: true, disableSignUp: true },
    user: {
      additionalFields: {
        role: { type: "string", input: false },
        dentistId: { type: "number", required: false, input: false },
      },
    },
    // nextCookies must stay last: it lets server actions set the session cookie.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const g = globalThis as unknown as { __clinicAuth?: Auth };

/**
 * The Better Auth instance, built lazily on the process-wide db client. Lazy rather than a
 * module-level `auth` constant so importing this file never opens a connection, and anything
 * that sets DATABASE_URL first (scripts, tests) gets the right database. Callers should
 * `await db()` first so migrations have run (getActor, the route handler and the actions do).
 */
export function getAuth(): Auth {
  g.__clinicAuth ??= createAuth(sharedDb());
  return g.__clinicAuth;
}
