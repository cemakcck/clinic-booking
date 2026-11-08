import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Rate limits are per IP bucket and every Playwright request shares one: this file places at most
// 7 holds (limit 20/h) and 2 confirms (limit 10/h) per run. globalSetup wipes rate_events.

const PRICE = /\d+\s?(₺|TL)\b|₺/;
const email = () => `e2e+${Math.random().toString(36).slice(2, 10)}@example.com`;

async function noSeriousAxe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Step 3: the first enabled day is preselected; returns its date and the first slot label. */
async function firstSlot(page: Page) {
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

async function toDetails(page: Page) {
  const s = await firstSlot(page);
  await s.slot.click();
  await expect(s.slot).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("summary").getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your details" })).toBeFocused();
  return s;
}

async function bookAnyCheckup(page: Page) {
  await page.goto("/en/book");
  await page.getByTestId("treatment-option").filter({ hasText: "Check-up and cleaning" }).click();
  await expect(page.getByRole("heading", { name: "Who would you like to see?" })).toBeFocused();
  await page.getByTestId("dentist-option").filter({ hasText: "Anyone available" }).click();
  const s = await toDetails(page);
  await expect(page.getByTestId("hold-countdown")).toContainText(/\d:\d{2}/);
  await page.getByLabel("Full name").fill("Ayşe Yılmaz");
  await page.getByLabel("Phone number").fill("0532 111 2233");
  await page.getByLabel("Email", { exact: true }).fill(email());
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page).toHaveURL(/\/en\/book\/done\?t=[\w-]{20,}/);
  return s;
}

test.describe("london visitor", () => {
  test.use({ timezoneId: "Europe/London" });

  test("books end to end and lands on confirmation", async ({ page, request }) => {
    const { label } = await bookAnyCheckup(page);
    const done = page.getByTestId("confirmation");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're booked in");
    // Same Istanbul clock time although the browser is in London (Review Focus 4).
    await expect(done).toContainText(label);
    await expect(done).toContainText("Check-up and cleaning");
    await expect(done).toContainText("We emailed you");
    const token = new URL(page.url()).searchParams.get("t")!;
    await expect(page.getByRole("link", { name: "Manage your booking" })).toHaveAttribute("href", `/en/booking/${token}`);
    const ics = page.getByRole("link", { name: "Add to calendar" });
    await expect(ics).toHaveAttribute("href", `/api/ics/${token}`);
    const res = await request.get(`/api/ics/${token}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    expect(res.headers()["content-disposition"]).toContain('filename="appointment.ics"');
    expect(await res.text()).toContain("BEGIN:VEVENT");
    expect((await request.get("/api/ics/not-a-real-token")).status()).toBe(404);
    // Demo callout pointing at the staff side.
    await expect(page.getByTestId("demo-callout")).toContainText("Now see it from the clinic's side");
    await expect(page.getByTestId("demo-callout")).toContainText("Try it as Receptionist");
    // The "mine" cookie remembers this booking for the staff calendar highlight.
    const mine = (await page.context().cookies()).find((c) => c.name === "demo_mine");
    expect(mine?.httpOnly).toBe(true);
    expect(mine?.sameSite).toBe("Lax");
  });
});

test("taken slot disappears for the next visitor", async ({ page, browser }) => {
  const { label, date } = await bookAnyCheckup(page);
  const dentist = (await page.getByTestId("confirmation-dentist").innerText()).trim();

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto("/en/book?treatment=checkup");
  await p2.getByTestId("dentist-option").filter({ hasText: dentist }).click();
  await expect(p2.getByRole("heading", { name: "Pick a time" })).toBeVisible();
  await expect(p2).toHaveURL(/dentist=[a-z-]+/);
  const url = new URL(p2.url());
  url.searchParams.set("date", date);
  await p2.goto(url.toString());
  await expect(p2.locator(`[data-testid="day"][data-date="${date}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(p2.getByTestId("slot-list")).toBeVisible();
  await expect(p2.getByTestId("slot").filter({ hasText: new RegExp(`^${label}$`) })).toHaveCount(0);
  await other.close();
});

test("dentist link preselects the dentist after a treatment they perform", async ({ page }) => {
  await page.goto("/en/book?dentist=murat-kaya");
  await page.getByTestId("treatment-option").filter({ hasText: "Implant consultation" }).click();
  await expect(page.getByRole("heading", { name: "Pick a time" })).toBeFocused();
  await expect(page.getByTestId("summary")).toContainText("Dr. Murat Kaya");
  // Whitening isn't done by Dr. Kaya, so the dentist step comes back.
  await page.goto("/en/book?dentist=murat-kaya");
  await page.getByTestId("treatment-option").filter({ hasText: "Teeth whitening" }).click();
  await expect(page.getByRole("heading", { name: "Who would you like to see?" })).toBeVisible();
  await expect(page.getByTestId("dentist-option").filter({ hasText: "Dr. Murat Kaya" })).toHaveCount(0);
});

test("required fields and privacy checkbox are validated", async ({ page }) => {
  await page.goto("/en/book?treatment=checkup&dentist=any");
  await toDetails(page);
  await page.getByLabel("Full name").fill("Zeynep Kaya");
  await page.getByLabel("Phone number").fill("12");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("Please enter a valid phone number")).toBeVisible();
  await expect(page.getByText("Please enter a valid email address")).toBeVisible();
  await expect(page.getByText("Please tick the box to continue")).toBeVisible();
  await expect(page.getByLabel("Phone number")).toBeFocused();
  await expect(page.getByLabel("Full name")).toHaveValue("Zeynep Kaya");
  await expect(page.getByLabel("Phone number")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/en\/book\?/);
});

test("booking flow never shows a price", async ({ page }) => {
  await page.goto("/en/book");
  expect(await page.locator("body").innerText()).not.toMatch(PRICE);
  await page.getByTestId("treatment-option").filter({ hasText: "Teeth whitening" }).click();
  expect(await page.locator("body").innerText()).not.toMatch(PRICE);
  await page.getByTestId("dentist-option").filter({ hasText: "Anyone available" }).click();
  await firstSlot(page);
  const summary = page.getByTestId("summary");
  await expect(summary.getByTestId("pricing-note")).toContainText("Pricing: contact the clinic for a quote");
  expect(await page.locator("body").innerText()).not.toMatch(PRICE);
  await toDetails(page);
  expect(await page.locator("body").innerText()).not.toMatch(PRICE);
});

test("tr booking flow is Turkish", async ({ page }) => {
  await page.goto("/tr/book");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await expect(page.getByRole("heading", { name: "Ne için randevu almak istersiniz?" })).toBeVisible();
  await page.getByTestId("treatment-option").filter({ hasText: "Muayene ve temizlik" }).click();
  await page.getByTestId("dentist-option").filter({ hasText: "Fark etmez" }).click();
  await expect(page.getByRole("heading", { name: "Saat seçin" })).toBeVisible();
  await expect(page.getByText("Sabah").or(page.getByText("Öğleden sonra")).first()).toBeVisible();
  await page.getByTestId("slot").first().click();
  await page.getByTestId("summary").getByRole("button", { name: "Devam" }).click();
  await expect(page.getByRole("heading", { name: "Bilgileriniz" })).toBeVisible();
  await expect(page.getByText("Bu bir demodur.")).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("Your details");
  expect(body).not.toContain("Pick a time");
});

test("axe on each step", async ({ page }) => {
  await page.goto("/en/book");
  await noSeriousAxe(page, "step 1");
  await page.getByTestId("treatment-option").filter({ hasText: "Filling" }).click();
  await expect(page.getByRole("heading", { name: "Who would you like to see?" })).toBeVisible();
  await noSeriousAxe(page, "step 2");
  await page.getByTestId("dentist-option").filter({ hasText: "Anyone available" }).click();
  await firstSlot(page);
  await noSeriousAxe(page, "step 3");
  await toDetails(page);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("Please tick the box to continue")).toBeVisible();
  await noSeriousAxe(page, "step 4 with errors");
});

test("step 4 privacy note is shown", async ({ page }) => {
  await page.goto("/en/book?treatment=checkup&dentist=any");
  await toDetails(page);
  await expect(
    page.getByText("This is a demo. Your details are only used for this booking and are wiped every night"),
  ).toBeVisible();
});
