import { createDb, migrateDb } from "@/lib/db/client";
import { resetDemo } from "@/lib/demo/reset";
import { E2E_DB_HOST as DB_HOST, E2E_DEMO_PASSWORD } from "./constants";

export default async function globalSetup() {
  // Same password the servers get in playwright.config, so seeded staff accounts can sign in.
  process.env.DEMO_PASSWORD = E2E_DEMO_PASSWORD;
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
