import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_DEMO_PASSWORD } from "./constants";

async function serious(page: Page) {
  return (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

async function liveAdmin(page: Page) {
  await page.goto("/en/staff/login");
  await page.getByLabel("Email").fill("admin@staff.example");
  await page.getByLabel("Password").fill(E2E_DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/staff\/calendar$/);
}

test("admin one-click lands on settings: inputs enabled, Save disabled, note visible", async ({ page }) => {
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: "Sign in as Admin" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/calendar$/);
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  await page.getByRole("link", { name: /^Treatments/ }).click();
  await expect(page).toHaveURL(/\/en\/staff\/settings\/treatments$/);
  await page.locator("main ul a").first().click();
  await expect(page).toHaveURL(/\/en\/staff\/settings\/treatments\/\d+$/);
  const name = page.getByLabel("Name (English)");
  await expect(name).toBeEnabled();
  await name.fill("Typed but never saved");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByTestId("demo-note")).toHaveText(
    "Disabled in the demo, so the next visitor finds the clinic as you did.",
  );
  expect(await serious(page)).toEqual([]);

  for (const path of ["dentists", "hours"]) {
    await page.goto(`/en/staff/settings/${path}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  await page.goto("/en/staff/settings/dentists");
  await page.locator("main ul a").first().click();
  await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByTestId("demo-note")).toBeVisible();
  await page.goto("/en/staff/settings/hours");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add closed date" })).toBeDisabled();
  await expect(page.getByTestId("demo-note").first()).toBeVisible();
  expect(await serious(page)).toEqual([]);
});

test("receptionist has no Settings and the page 404s", async ({ page }) => {
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: "Sign in as Receptionist" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/calendar$/);
  const res = await page.goto("/en/staff/settings");
  expect(res?.status()).toBe(404);
});

test("@live: admin renames a treatment and the public page shows it", async ({ page }) => {
  await liveAdmin(page);
  await page.goto("/en/staff/settings/treatments");
  await page.locator("main ul a").first().click();
  const name = page.getByLabel("Name (English)");
  await expect(name).toBeVisible();
  const editUrl = page.url();
  const original = await name.inputValue();
  const duration = await page.getByLabel("Duration").inputValue();
  const renamed = `${original} (renamed)`;
  try {
    await name.fill(renamed);
    // Typed values survive a failed save.
    await page.getByLabel("Duration").fill("20");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Please fix the highlighted fields.")).toBeVisible();
    await expect(page.getByText("Pick a multiple of 15 minutes")).toBeVisible();
    await expect(page.getByLabel("Duration")).toBeFocused();
    await expect(page.getByLabel("Duration")).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveValue(renamed);
    await page.getByLabel("Duration").fill(duration);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("settings-status")).toHaveText("Saved.");

    await page.goto("/en/treatments");
    await expect(page.getByTestId("treatment-card").filter({ hasText: renamed })).toHaveCount(1);
  } finally {
    // Put the seeded name back (this also refreshes the cached public page).
    await page.goto(editUrl);
    await name.fill(original);
    await page.getByLabel("Duration").fill(duration);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("settings-status")).toHaveText("Saved.");
  }
});

test("@live: admin closes a date and the booking strip disables it", async ({ page }) => {
  await liveAdmin(page);
  // A Tuesday-to-Friday two to three weeks out, inside the 60-day public window.
  const d = new Date(Date.now() + 16 * 86_400_000);
  while ([0, 1, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  const date = d.toISOString().slice(0, 10);
  const day = page.locator(`[data-testid="day"][data-date="${date}"]`);

  await page.goto(`/en/book?treatment=checkup&dentist=any&date=${date}`);
  await expect(day).toBeEnabled();

  await page.goto("/en/staff/settings/hours");
  const dateInput = page.getByLabel("Date", { exact: true });
  await page.getByLabel("Label (English)").fill("Staff outing");
  await page.getByLabel("Label (Turkish)").fill("Personel gezisi");
  // Retry until the form has hydrated (a fill before that is overwritten by the initial state).
  await expect(async () => {
    await dateInput.fill(date);
    await expect(dateInput).toHaveValue(date, { timeout: 500 });
  }).toPass();
  await page.getByRole("button", { name: "Add closed date" }).click();
  await expect(page.getByTestId("closed-dates").locator(`[data-date="${date}"]`)).toBeVisible();
  try {
    await page.goto(`/en/book?treatment=checkup&dentist=any&date=${date}`);
    await expect(day).toBeDisabled();
  } finally {
    await page.goto("/en/staff/settings/hours");
    await page.getByTestId("closed-dates").locator(`[data-date="${date}"]`).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("closed-dates")).toHaveCount(0);
  }
});

test("@live: deactivating a dentist with upcoming appointments lists them to move first", async ({ page }) => {
  await liveAdmin(page);
  await page.goto("/en/staff/settings/dentists");
  await page.locator("main ul a").first().click();
  const active = page.getByLabel("Active (shown on the website and bookable)");
  await expect(active).toBeChecked();
  // The seeded dentists all have upcoming appointments, so the save is refused and nothing changes.
  await active.uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  const alert = page.locator("main form").getByRole("alert");
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("This dentist still has upcoming appointments. Move these first:");
  const first = alert.getByTestId("dentist-appointments").getByRole("link").first();
  await expect(first).toHaveAttribute("href", /\/en\/staff\/calendar\?view=day&date=\d{4}-\d{2}-\d{2}&open=[0-9a-f-]{36}$/);
  await expect(active).not.toBeChecked();
  await first.click();
  await expect(page.getByTestId("calendar")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await page.reload();
  await expect(page.getByLabel("Active (shown on the website and bookable)")).toBeChecked();
});
