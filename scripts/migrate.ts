import { createDb, migrateDb } from "@/lib/db/client";

async function main() {
  const db = createDb();
  try {
    await migrateDb(db);
    console.log("Migrated.");
  } finally {
    await db.$client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
