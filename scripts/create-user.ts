/**
 * Creates a staff login (spec §7.1: accounts come from the seed and this script only).
 *
 *   npm run user:create -- --email x@clinic.example --name "Dr. X" --role dentist --dentist elif-aydin --password '…'
 *
 * Every dentist login is linked to exactly one dentist profile (--dentist <slug>); other roles
 * must not pass --dentist.
 */
import { parseArgs } from "node:util";
import { createDb, migrateDb } from "@/lib/db/client";
import { isRole, ROLES } from "@/lib/auth/roles";
import { dentistIdBySlug, insertStaffUser } from "@/lib/demo/staff-users";

const USAGE = `Usage: npm run user:create -- --email <email> --name <name> --role <${ROLES.join("|")}> [--dentist <slug>] --password <password>`;

function fail(msg: string): never {
  console.error(`${msg}\n${USAGE}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      dentist: { type: "string" },
      password: { type: "string" },
    },
    strict: true,
  });
  const { email, name, role, dentist, password } = values;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("A valid --email is required.");
  if (!name?.trim()) fail("--name is required.");
  if (!isRole(role)) fail(`--role must be one of: ${ROLES.join(", ")}.`);
  if (role === "dentist" && !dentist) fail("A dentist login needs --dentist <slug>.");
  if (role !== "dentist" && dentist) fail("--dentist only applies to --role dentist.");
  if (!password || password.length < 8) fail("--password must be at least 8 characters.");

  const db = createDb();
  try {
    await migrateDb(db);
    const id = await db.transaction(async (tx) => {
      const dentistId = dentist ? await dentistIdBySlug(tx, dentist) : null;
      return insertStaffUser(tx, { email, name: name.trim(), role, dentistId, password });
    });
    console.log(`Created ${role} ${email.toLowerCase()} (${id}).`);
  } finally {
    await db.$client.end();
  }
}

function pgCode(e: unknown): string | undefined {
  const c = e as { code?: unknown; cause?: { code?: unknown } };
  return [c?.code, c?.cause?.code].find((x): x is string => typeof x === "string");
}

main().catch((e) => {
  if (pgCode(e) === "23505") console.error("A user with that email already exists.");
  else console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
