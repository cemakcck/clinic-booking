import { createDb, migrateDb } from "@/lib/db/client";
import { resetDemo } from "@/lib/demo/reset";

const DB_HOST = "postgres://clinic:clinic@localhost:5433";

export default async function globalSetup() {
  const now = new Date();
  for (const name of ["clinic_e2e", "clinic_e2e_live"]) {
    const db = createDb(`${DB_HOST}/${name}`);
    try {
      await migrateDb(db);
      await resetDemo(db, now);
    } finally {
      await db.$client.end();
    }
  }
}
