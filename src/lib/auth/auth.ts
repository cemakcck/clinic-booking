import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { sharedDb, type Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

function createAuth(database: Db) {
  return betterAuth({
    database: drizzleAdapter(database, { provider: "pg", schema }),
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
