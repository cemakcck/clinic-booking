import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { bookAnyCheckup } from "./helpers";
import { E2E_DEMO_PASSWORD } from "./constants";

const banner = (page: Page) => page.getByRole("complementary", { name: "Demo notice" });

async function seriousAxe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

test("signed out, staff pages redirect to the login", async ({ page }) => {
  await page.goto("/en/staff/calendar");
  await expect(page).toHaveURL(/\/en\/staff\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Staff sign in");
  await page.goto("/tr/staff");
  await expect(page).toHaveURL(/\/tr\/staff\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Personel girişi");
});

test("Receptionist pill lands on the calendar, signed in as Zeynep", async ({ page }) => {
  await page.goto("/en");
  await banner(page).getByRole("button", { name: "Receptionist" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/calendar$/);
  await expect(page.getByTestId("signed-in")).toContainText("Signed in as");
  await expect(page.getByTestId("signed-in")).toContainText("Zeynep");
  await expect(page.getByTestId("signed-in")).toContainText("Receptionist");
  // The banner now marks Receptionist as current.
  await expect(banner(page).getByRole("button", { name: "Receptionist" })).toHaveAttribute("aria-current", "true");
  const nav = page.getByRole("navigation", { name: "Staff" });
  await expect(nav.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Requests" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Patients" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(await seriousAxe(page)).toEqual([]);
});

test("Dentist pill lands on today; the sidebar has no Requests or Settings", async ({ page }) => {
  await page.goto("/en");
  await banner(page).getByRole("button", { name: "Dentist" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/today$/);
  await expect(page.getByTestId("signed-in")).toContainText("Elif");
  const nav = page.getByRole("navigation", { name: "Staff" });
  await expect(nav.getByRole("link", { name: "Today" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Calendar" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Patients" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Requests" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
});

test("magic moment: after booking, Receptionist opens the calendar on the booking's day", async ({ page }) => {
  const { date } = await bookAnyCheckup(page);
  await page.getByTestId("demo-callout").getByRole("button", { name: /Try it as Receptionist/ }).click();
  await expect(page).toHaveURL(new RegExp(`/en/staff/calendar\\?date=${date}$`));
  await expect(page.getByTestId("signed-in")).toContainText("Zeynep");

  // The banner pill does the same, from any page.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/login$/);
  await page.goto("/en/treatments");
  await banner(page).getByRole("button", { name: "Receptionist" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/staff/calendar\\?date=${date}$`));
});

test("wrong password shows an error and keeps the email", async ({ page }) => {
  await page.goto("/en/staff/login");
  await page.getByLabel("Email").fill("zeynep@staff.example");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: /\S/ });
  await expect(alert).toHaveText("That email and password don't match.");
  await expect(alert).toBeFocused();
  await expect(page.getByLabel("Email")).toHaveValue("zeynep@staff.example");
  await expect(page).toHaveURL(/\/en\/staff\/login$/);
  expect(await seriousAxe(page)).toEqual([]);

  // Empty password: the alert explains, the empty field takes focus, the email survives.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(alert).toHaveText("Enter your email and password.");
  await expect(page.getByLabel("Password")).toBeFocused();
  await expect(page.getByLabel("Email")).toHaveValue("zeynep@staff.example");
});

test("admin one-click on the login page; sign out works", async ({ page }) => {
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: "Sign in as Admin" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/calendar$/);
  await expect(page.getByTestId("signed-in")).toContainText("Admin");
  await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Settings" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/login$/);
  await page.goto("/en/staff/calendar");
  await expect(page).toHaveURL(/\/en\/staff\/login$/);
});

test("a signed-in visitor opening the login goes to their home", async ({ page }) => {
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: "Sign in as Dentist" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/today$/);
  await page.goto("/en/staff");
  await expect(page).toHaveURL(/\/en\/staff\/today$/);
  await page.goto("/en/staff/login");
  await expect(page).toHaveURL(/\/en\/staff\/today$/);
});

test("the shared demo account can't be renamed, re-passworded or mass-signed-out over the API", async ({ page }) => {
  await page.goto("/en");
  await banner(page).getByRole("button", { name: "Receptionist" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/calendar/);
  const origin = "http://localhost:3200";
  const post = (path: string, data: object) =>
    page.request.post(`/api/auth${path}`, { data, headers: { origin } });
  expect((await post("/update-user", { name: "Vandal" })).status()).toBe(404);
  expect(
    (await post("/change-password", { currentPassword: E2E_DEMO_PASSWORD, newPassword: "locked-you-out-123" })).status(),
  ).toBe(404);
  expect((await post("/revoke-sessions", {})).status()).toBe(404);
  expect((await page.request.get("/api/auth/get-session")).status()).toBe(200);

  await page.reload();
  await expect(page.getByTestId("signed-in")).toContainText("Zeynep Arslan");
  // The password still works for the next visitor.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill("zeynep@staff.example");
  await page.getByLabel("Password").fill(E2E_DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/staff\/calendar$/);
});

test("@live: no role pills; the form login with admin credentials works", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("complementary", { name: "Demo notice" })).toHaveCount(0);
  await page.goto("/en/staff/login");
  await expect(page.getByRole("button", { name: /Sign in as/ })).toHaveCount(0);
  await page.getByLabel("Email").fill("admin@staff.example");
  await page.getByLabel("Password").fill(E2E_DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/staff\/calendar$/);
  await expect(page.getByTestId("signed-in")).toContainText("Admin");
});
