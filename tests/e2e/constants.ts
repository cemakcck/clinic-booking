/** Shared by playwright.config (server env), globalSetup (seeding) and the specs (form logins). */
export const E2E_DEMO_PASSWORD = "demo-password";

/** Postgres server of the e2e databases: the server of TEST_DATABASE_URL, else the docker-compose default. */
export const E2E_DB_HOST = (() => {
  const u = new URL(process.env.TEST_DATABASE_URL ?? "postgres://clinic:clinic@localhost:5433/clinic_test");
  return `${u.protocol}//${u.username}:${u.password}@${u.host}`;
})();
