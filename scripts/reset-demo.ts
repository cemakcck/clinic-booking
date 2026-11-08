import { createDb, migrateDb } from "@/lib/db/client";
import { resetDemo } from "@/lib/demo/reset";

async function main() {
  const db = createDb();
  try {
    await migrateDb(db);
    await resetDemo(db, new Date());
    console.log("Demo reset.");
  } finally {
    await db.$client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
