import { createDb, migrateDb } from "@/lib/db/client";
import { resetDemo } from "@/lib/demo/reset";
import { isDemo } from "@/lib/demo/mode";

async function main() {
  // This TRUNCATEs every app table in whatever DATABASE_URL points at.
  if (!isDemo() && !process.argv.includes("--force")) {
    console.error("Refusing to reset: DEMO_MODE is not 1. Set DEMO_MODE=1 or pass --force to wipe this database.");
    process.exit(1);
  }
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
