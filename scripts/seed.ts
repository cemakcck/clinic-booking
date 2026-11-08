import { createDb, migrateDb } from "@/lib/db/client";
import { seedClinic } from "@/lib/demo/seed";

async function main() {
  const db = createDb();
  try {
    await migrateDb(db);
    await seedClinic(db, { now: new Date() });
    console.log("Seeded.");
  } finally {
    await db.$client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
