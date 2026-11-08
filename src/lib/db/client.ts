import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const DEFAULT_URL = "postgres://clinic:clinic@localhost:5433/clinic";

export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_URL): Db {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  return drizzle(client, { schema });
}

export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

const g = globalThis as unknown as {
  __clinicDb?: Db;
  __clinicMigrate?: Promise<void>;
};

/** Shared client; migrates once per process, retrying if a migration attempt failed. */
export async function db(): Promise<Db> {
  g.__clinicDb ??= createDb();
  g.__clinicMigrate ??= migrateDb(g.__clinicDb).catch((e) => {
    g.__clinicMigrate = undefined;
    throw e;
  });
  await g.__clinicMigrate;
  return g.__clinicDb;
}
