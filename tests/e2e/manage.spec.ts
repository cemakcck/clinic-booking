import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { hashToken } from "@/lib/security/tokens";
import { bookAnyCheckup } from "./helpers";
import { E2E_DB_HOST } from "./constants";

// Books 1 hold + 1 confirm per test (limits 20/h and 10/h per IP; globalSetup wipes rate_events).

const istanbulPlus = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(Date.now() + days * 86_400_000));

test("reschedule, then cancel", async ({ page }) => {
  const { token, label } = await bookAnyCheckup(page, { date: istanbulPlus(7) });
  await page.goto(`/en/booking/${token}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Manage your booking");
  const manage = page.getByTestId("manage");
  await expect(manage).toContainText(label);
  await expect(manage).toContainText("Check-up and cleaning");

  const bad = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => v.id)).toEqual([]);

  // Reschedule to the last free time of the day it opens on.
  await page.getByRole("button", { name: "Reschedule" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pick a new time");
  // Move to a day at least 2 days out, so the new time is past the 24-hour online-change cutoff
  // at any hour (the picker opens on the soonest day, whose last slot can be under 24 h away).
  const minDate = istanbulPlus(2);
  await expect(page.getByTestId("slot").first()).toBeVisible();
  const dates = await page.locator('[data-testid="day"]:not([disabled])').evaluateAll((els) => els.map((e) => e.getAttribute("data-date") ?? ""));
  const pick = dates.find((d) => d >= minDate);
  if (!pick) throw new Error(`no open day on or after ${minDate} in the strip: ${dates.join(", ")}`);
  await page.locator(`[data-testid="day"][data-date="${pick}"]`).click();
  await expect(page.locator(`[data-testid="day"][data-date="${pick}"]`)).toHaveAttribute("aria-pressed", "true");
  const slots = page.getByTestId("slot");
  await expect(slots.first()).toBeVisible();
  const target = (await slots.last().innerText()).trim();
  expect(target).not.toBe(label);
  await slots.last().click();
  await page.getByRole("button", { name: /^Move to / }).click();
  await expect(page.getByTestId("outcome")).toContainText("Your appointment is now on");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.getByTestId("manage-when")).toContainText(target);
  await expect(page.getByTestId("manage-when")).not.toContainText(label);

  // Cancel behind a confirm step.
  await page.getByRole("button", { name: "Cancel appointment" }).click();
  await expect(page.getByRole("heading", { name: "Cancel this appointment?" })).toBeFocused();
  await page.getByRole("button", { name: "Keep my appointment" }).click();
  await expect(page.getByRole("button", { name: "Cancel appointment" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel appointment" }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your appointment is cancelled");
  await expect(page.getByTestId("outcome")).toContainText("has been cancelled");
  await expect(page.getByRole("button", { name: "Reschedule" })).toHaveCount(0);

  // The same link and the confirmation page both show the cancelled state.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your appointment is cancelled");
  await page.goto(`/en/book/done?t=${token}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your appointment is cancelled");
  await expect(page.getByText("You're booked in")).toHaveCount(0);
});

test("the page is not indexable and sends no referrer", async ({ page }) => {
  const { token } = await bookAnyCheckup(page, { date: istanbulPlus(7) });
  await page.goto(`/en/booking/${token}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
});

test("within the cutoff the page asks to call the clinic", async ({ page }) => {
  const { token } = await bookAnyCheckup(page, { date: istanbulPlus(7) });
  // A visited appointment can't be changed online either.
  const db = createDb(`${E2E_DB_HOST}/clinic_e2e`);
  try {
    await db.execute(sql`UPDATE entries SET status = 'arrived' WHERE manage_token_hash = ${hashToken(token)}`);
  } finally {
    await db.$client.end();
  }
  await page.goto(`/en/booking/${token}`);
  const call = page.getByTestId("call-clinic");
  await expect(call).toContainText("Please call the clinic");
  await expect(call).toContainText("+90 216 000 00 00");
  await expect(page.getByRole("button", { name: "Reschedule" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel appointment" })).toHaveCount(0);
});

test("an unknown link shows the not-valid page; tr is Turkish", async ({ page }) => {
  await page.goto("/en/booking/this-token-does-not-exist-at-all");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This link is not valid");
  await page.goto("/tr/booking/this-token-does-not-exist-at-all");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bu bağlantı geçerli değil");
});
