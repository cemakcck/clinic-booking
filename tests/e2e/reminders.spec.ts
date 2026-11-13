import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { bookAnyCheckup } from "./helpers";

// Own X-Forwarded-For bucket per run, so the reminders rate budget (5 an hour) and the booking
// budget the other specs count on stay untouched.
test.use({ extraHTTPHeaders: { "X-Forwarded-For": `203.0.113.${100 + Math.floor(Math.random() * 150)}` } });

const rand = () => Math.random().toString(36).slice(2, 8);

async function serious(page: Page) {
  return (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

test("a visitor books, switches to Receptionist and sends their own reminders now", async ({ page }) => {
  const id = rand();
  const name = `Reminder Visitor ${id}`;
  // A real-looking address: with RESEND_API_KEY unset the email is only logged, never sent.
  const email = `e2e-reminder+${id}@nova-test.dev`;
  await bookAnyCheckup(page, { name, email });

  await page.getByRole("complementary", { name: "Demo notice" }).getByRole("button", { name: "Receptionist" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/calendar/);
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Reminders" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Reminders" })).toBeVisible();

  await page.getByRole("button", { name: "Send my reminders now" }).click();
  await expect(page.getByTestId("send-now-status")).toHaveText("Done: 2 new reminders in the log below.");

  const mine = page.getByTestId("reminder").filter({ hasText: name });
  await expect(mine).toHaveCount(2);
  const sms = mine.and(page.locator('[data-channel="sms"]'));
  const mail = mine.and(page.locator('[data-channel="email"]'));
  await expect(sms.getByTestId("reminder-channel")).toHaveText("SMS");
  await expect(sms.getByTestId("reminder-message")).toContainText("Lindenya");
  await expect(mail.getByTestId("reminder-channel")).toHaveText("Email");
  // This visitor's own booking: their contact details are shown in full.
  await expect(sms.getByTestId("reminder-contact")).toHaveText("+905321112233");
  await expect(mail.getByTestId("reminder-contact")).toHaveText(email);
  await expect(sms.getByRole("link")).toHaveAttribute("href", /\/en\/staff\/calendar\?view=day&date=\d{4}-\d{2}-\d{2}&open=[0-9a-f-]{36}$/);
  // Every row that isn't this visitor's own (seeded online and staff-created bookings alike) is masked.
  const others = page.getByTestId("reminder").filter({ hasNotText: name }).getByTestId("reminder-contact");
  expect(await others.count()).toBeGreaterThan(0);
  const unmasked = (await others.allTextContents()).filter((c) => /\d{4}|@/.test(c) && !c.includes("•"));
  expect(unmasked).toEqual([]);

  expect(await serious(page)).toEqual([]);

  // Exactly once: pressing again adds nothing.
  await page.getByRole("button", { name: "Send my reminders now" }).click();
  await expect(page.getByTestId("send-now-status")).toHaveText("Nothing new to send: your bookings already have their reminders.");
  await expect(mine).toHaveCount(2);

  // Turkish staff UI.
  await page.goto("/tr/staff/reminders");
  await expect(page.getByRole("heading", { level: 1, name: "Hatırlatmalar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hatırlatmalarımı şimdi gönder" })).toBeVisible();
  await expect(page.getByTestId("reminder").filter({ hasText: name })).toHaveCount(2);
});

test("without a booking of their own, the button points to booking", async ({ page }) => {
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: "Sign in as Receptionist" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/calendar/);
  await page.goto("/en/staff/reminders?channel=sms");
  await expect(page.getByLabel("Channel")).toHaveValue("sms");
  await page.getByRole("button", { name: "Send my reminders now" }).click();
  const status = page.getByTestId("send-now-status");
  await expect(status).toContainText("Book an appointment first, then come back.");
  await expect(status.getByRole("link", { name: "Book an appointment" })).toHaveAttribute("href", "/en/book");
});

test("dentists have no reminders page", async ({ page }) => {
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: "Sign in as Dentist" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/today/);
  const res = await page.goto("/en/staff/reminders");
  expect(res?.status()).toBe(404);
});
