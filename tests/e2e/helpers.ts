import { expect, type Page } from "@playwright/test";

const email = () => `e2e+${Math.random().toString(36).slice(2, 10)}@example.com`;

/** Step 3: the first enabled day is preselected; returns its date and the first slot label. */
export async function firstSlot(page: Page) {
  await expect(page.getByRole("heading", { name: "Pick a time" })).toBeVisible();
  const day = page.locator('[data-testid="day"][aria-pressed="true"]');
  await expect(day).toBeEnabled();
  const date = (await day.getAttribute("data-date"))!;
  const slot = page.getByTestId("slot").first();
  await expect(slot).toBeVisible();
  const label = (await slot.innerText()).trim();
  expect(label).toMatch(/^\d{2}:\d{2}$/);
  return { date, label, slot };
}

export async function toDetails(page: Page) {
  const s = await firstSlot(page);
  await s.slot.click();
  await expect(s.slot).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("summary").getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your details" })).toBeFocused();
  return s;
}

/**
 * Books a check-up with anyone and lands on the confirmation. With `date` (YYYY-MM-DD) the day
 * picker opens there, e.g. a week out so the booking is still changeable online.
 */
export async function bookAnyCheckup(page: Page, opts: { date?: string } = {}) {
  if (opts.date) {
    await page.goto(`/en/book?treatment=checkup&dentist=any&date=${opts.date}`);
  } else {
    await page.goto("/en/book");
    await page.getByTestId("treatment-option").filter({ hasText: "Check-up and cleaning" }).click();
    await expect(page.getByRole("heading", { name: "Who would you like to see?" })).toBeFocused();
    await page.getByTestId("dentist-option").filter({ hasText: "Anyone available" }).click();
  }
  const s = await toDetails(page);
  await expect(page.getByTestId("hold-countdown")).toContainText(/\d:\d{2}/);
  await page.getByLabel("Full name").fill("Ayşe Yılmaz");
  await page.getByLabel("Phone number").fill("0532 111 2233");
  await page.getByLabel("Email", { exact: true }).fill(email());
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page).toHaveURL(/\/en\/book\/done\?t=[\w-]{20,}/);
  return { ...s, token: new URL(page.url()).searchParams.get("t")! };
}
