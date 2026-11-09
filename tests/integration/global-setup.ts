import postgres from "postgres";
import { createDb, migrateDb } from "@/lib/db/client";

const BASE = process.env.TEST_DATABASE_URL ?? "postgres://clinic:clinic@localhost:5433/clinic_test";
const DATABASES = ["clinic_test", "clinic_e2e", "clinic_e2e_live"];

function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export default async function setup() {
  const admin = postgres(withDb(BASE, "postgres"), { max: 1, onnotice: () => {} });
  try {
    for (const name of DATABASES) {
      const [row] = await admin`SELECT 1 AS ok FROM pg_database WHERE datname = ${name}`;
      if (!row) await admin.unsafe(`CREATE DATABASE ${name}`);
    }
  } finally {
    await admin.end();
  }
  for (const name of DATABASES) {
    const db = createDb(withDb(BASE, name));
    try {
      await migrateDb(db);
    } finally {
      await db.$client.end();
    }
  }
}
