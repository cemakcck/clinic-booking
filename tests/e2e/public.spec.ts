import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PRICE = /\d+\s?(₺|TL)\b|₺/;

test("home shows the demo banner, hero, next free slot and booking CTA", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByText("Demo, not a real clinic")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const card = page.getByTestId("next-free-slot");
  await expect(card).toContainText("Next free slot");
  await expect(card).toContainText(/\d{2}:\d{2}/);
  const cta = page.getByRole("main").getByRole("link", { name: "Book appointment" }).first();
  await expect(cta).toHaveAttribute("href", "/en/book");
  await expect(page.locator("body")).not.toContainText(PRICE);
});

test("treatments list durations and never prices", async ({ page }) => {
  await page.goto("/en/treatments");
  const cards = page.getByTestId("treatment-card");
  await expect(cards).toHaveCount(7);
  await expect(cards.first()).toContainText(/\d+ min/);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(PRICE);
  expect(text).toContain("Pricing: contact the clinic for a quote");
});

test("treatment detail shows PricingNote with call and call-back", async ({ page }) => {
  await page.goto("/en/treatments/whitening");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Teeth whitening");
  const note = page.getByTestId("pricing-note");
  await expect(note).toContainText("Pricing: contact the clinic for a quote");
  await expect(note.getByRole("link", { name: /call/i }).first()).toHaveAttribute("href", "tel:+902160000000");
  await expect(note.getByRole("link", { name: "Request a call back" })).toHaveAttribute(
    "href",
    "/en/contact?treatment=whitening#callback",
  );
  expect(await page.locator("body").innerText()).not.toMatch(PRICE);
});

test("unknown treatment and unknown path render the localized not-found page", async ({ page }) => {
  const r1 = await page.goto("/tr/treatments/nope");
  expect(r1?.status()).toBe(404);
  await expect(page.getByText("Sayfa bulunamadı")).toBeVisible();
  const r2 = await page.goto("/en/some/unknown/page");
  expect(r2?.status()).toBe(404);
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("dentists page lists 4 dentists", async ({ page }) => {
  await page.goto("/en/dentists");
  await expect(page.getByTestId("dentist-card")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Dr. Elif Aydın" })).toBeVisible();
});

test("international page exists in en and tr", async ({ page }) => {
  await page.goto("/en/international");
  const en = await page.getByRole("heading", { level: 1 }).innerText();
  expect(en.length).toBeGreaterThan(5);
  await page.goto("/tr/international");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  const tr = await page.getByRole("heading", { level: 1 }).innerText();
  expect(tr).not.toBe(en);
});

test("contact page shows address and hours", async ({ page }) => {
  await page.goto("/en/contact");
  await expect(page.getByText("Lindenya Sokağı No: 1", { exact: false }).first()).toBeVisible();
  await expect(page.locator("#callback")).toBeAttached();
  await expect(page.getByText("09:00–18:00").first()).toBeVisible();
});

test("mobile menu works at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Our dentists" })).toBeHidden();
  const toggle = page.getByRole("button", { name: "Menu" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByTestId("mobile-menu");
  await menu.getByRole("link", { name: "Our dentists" }).click();
  await expect(page).toHaveURL(/\/en\/dentists$/);
  await expect(page.getByTestId("mobile-menu")).toBeHidden();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test("axe: no serious violations on home, treatments, dentists", async ({ page }) => {
  for (const path of ["/en", "/en/treatments", "/en/dentists", "/en/international", "/en/contact", "/tr"]) {
    await page.goto(path);
    const res = await new AxeBuilder({ page }).analyze();
    const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
});

test("tr home is Turkish", async ({ page }) => {
  await page.goto("/en");
  const en = await page.getByRole("heading", { level: 1 }).innerText();
  await page.goto("/tr");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  const tr = await page.getByRole("heading", { level: 1 }).innerText();
  expect(tr).not.toBe(en);
  await expect(page.getByText("Demo, gerçek bir klinik değil")).toBeVisible();
});
