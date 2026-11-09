import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import type { DbOrTx } from "@/lib/db/client";
import { account, dentists, user } from "@/lib/db/schema";
import type { Role } from "@/lib/auth/roles";

export const STAFF_USERS = [
  { role: "receptionist", email: "zeynep@staff.example", name: "Zeynep Arslan", dentistSlug: null },
  { role: "dentist", email: "elif@staff.example", name: "Dr. Elif Aydın", dentistSlug: "elif-aydin" },
  { role: "admin", email: "admin@staff.example", name: "Deniz Kaplan", dentistSlug: null },
] as const satisfies readonly { role: Role; email: string; name: string; dentistSlug: string | null }[];

export type DemoStaffRole = (typeof STAFF_USERS)[number]["role"];

export function staffEmail(role: DemoStaffRole): string {
  return STAFF_USERS.find((u) => u.role === role)!.email;
}

/** The shared password of the seeded demo accounts; never defaulted, so a deploy can't forget it. */
export function demoPassword(): string {
  const pw = process.env.DEMO_PASSWORD;
  if (!pw) throw new Error("DEMO_PASSWORD is not set");
  return pw;
}

/**
 * Creates one credential-backed user, the same rows Better Auth's sign-up writes, hashed with
 * Better Auth's own hasher so `signInEmail` accepts the password. Works inside a transaction.
 */
export async function insertStaffUser(
  db: DbOrTx,
  input: { email: string; name: string; role: Role; dentistId: number | null; password: string },
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(user).values({
    id,
    email: input.email.toLowerCase(),
    name: input.name,
    role: input.role,
    dentistId: input.dentistId,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(account).values({
    id: randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function dentistIdBySlug(db: DbOrTx, slug: string): Promise<number> {
  const [row] = await db.select({ id: dentists.id }).from(dentists).where(eq(dentists.slug, slug));
  if (!row) throw new Error(`No dentist with slug "${slug}"`);
  return row.id;
}

/** Seeds the three demo staff accounts (dentists must be seeded first). */
export async function seedStaffUsers(db: DbOrTx): Promise<Record<DemoStaffRole, string>> {
  const password = demoPassword();
  const ids = {} as Record<DemoStaffRole, string>;
  for (const u of STAFF_USERS) {
    const dentistId = u.dentistSlug ? await dentistIdBySlug(db, u.dentistSlug) : null;
    ids[u.role] = await insertStaffUser(db, { ...u, dentistId, password });
  }
  return ids;
}
