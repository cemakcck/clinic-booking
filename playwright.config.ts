import { defineConfig, devices } from "@playwright/test";
import { E2E_DB_HOST as DB_HOST, E2E_DEMO_PASSWORD } from "./tests/e2e/constants";

const server = (port: number, env: Record<string, string>) => ({
  command: `npx next dev -p ${port}`,
  url: `http://localhost:${port}/en`,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
  env: {
    BETTER_AUTH_SECRET: "e2e-auth-secret-e2e-auth-secret-0123",
    IP_HASH_SECRET: "e2e-ip-hash-secret",
    CRON_SECRET: "e2e-cron-secret",
    DEMO_PASSWORD: E2E_DEMO_PASSWORD,
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    ...env,
  },
});

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  // One retry on CI absorbs a cold dev-server compile; locally a flake should be seen.
  retries: process.env.CI ? 1 : 0,
  use: { ...devices["Desktop Chrome"] },
  // Two servers: demo mode (default) and live mode. Tests tagged @live run against the second one only.
  webServer: [
    server(3200, {
      DATABASE_URL: `${DB_HOST}/clinic_e2e`,
      DEMO_MODE: "1",
      BETTER_AUTH_URL: "http://localhost:3200",
      SITE_URL: "http://localhost:3200",
    }),
    server(3201, {
      DATABASE_URL: `${DB_HOST}/clinic_e2e_live`,
      DEMO_MODE: "",
      NEXT_DIST_DIR: ".next-live",
      BETTER_AUTH_URL: "http://localhost:3201",
      SITE_URL: "http://localhost:3201",
    }),
  ],
  projects: [
    { name: "demo", grepInvert: /@live/, use: { baseURL: "http://localhost:3200" } },
    { name: "live", grep: /@live/, use: { baseURL: "http://localhost:3201" } },
  ],
});
