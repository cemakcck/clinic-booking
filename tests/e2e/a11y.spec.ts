import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { bookAnyCheckup } from "./helpers";
import { quietDate } from "./calendar-db";

// The site-wide accessibility bar: no serious or critical axe violations on any public page (en
// and tr) or staff page. Books once, from its own X-Forwarded-For bucket so the rate budget the
// other specs count on stays untouched.

const LOCALES = ["en", "tr"] as const;

async function serious(page: Page, label: string): Promise<string[]> {
  return (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

async function sweep(page: Page, paths: string[]) {
  const bad: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator("main").first()).toBeVisible();
    bad.push(...(await serious(page, path)));
  }
  expect(bad).toEqual([]);
}

async function signIn(page: Page, role: "Receptionist" | "Dentist" | "Admin") {
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: `Sign in as ${role}` }).click();
  await expect(page).toHaveURL(/\/en\/staff\/(calendar|today)/);
}

test.describe("public pages", () => {
  test.use({ extraHTTPHeaders: { "X-Forwarded-For": "203.0.113.18" } });

  test("every public page, en and tr", async ({ page }) => {
    test.setTimeout(180_000);
    const { token } = await bookAnyCheckup(page);
    const paths = LOCALES.flatMap((l) => [
      `/${l}`,
      `/${l}/treatments`,
      `/${l}/treatments/checkup`,
      `/${l}/dentists`,
      `/${l}/international`,
      `/${l}/contact`,
      `/${l}/book`,
      `/${l}/book?treatment=checkup&dentist=any`,
      `/${l}/book/done?t=${token}`,
      `/${l}/booking/${token}`,
      `/${l}/no-such-page`,
    ]);
    await sweep(page, paths);
  });
});

test("staff login, en and tr", async ({ page }) => {
  await sweep(page, ["/en/staff/login", "/tr/staff/login"]);
});

test("receptionist pages: calendar, requests, reminders, patients", async ({ page }) => {
  const date = await quietDate();
  await signIn(page, "Receptionist");
  await sweep(
    page,
    LOCALES.flatMap((l) => [
      `/${l}/staff/calendar?date=${date}`,
      `/${l}/staff/calendar?view=week&date=${date}`,
      `/${l}/staff/requests`,
      `/${l}/staff/reminders`,
      `/${l}/staff/patients`,
    ]),
  );
});

test("dentist today", async ({ page }) => {
  await signIn(page, "Dentist");
  await sweep(page, ["/en/staff/today", "/tr/staff/today"]);
});

test("admin settings", async ({ page }) => {
  await signIn(page, "Admin");
  await sweep(
    page,
    LOCALES.flatMap((l) => [
      `/${l}/staff/settings`,
      `/${l}/staff/settings/hours`,
      `/${l}/staff/settings/dentists`,
      `/${l}/staff/settings/treatments`,
    ]),
  );
});
