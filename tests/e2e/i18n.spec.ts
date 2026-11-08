import { expect, test } from "@playwright/test";

test("/ redirects to /en", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("/tr renders html lang=tr", async ({ page }) => {
  await page.goto("/tr");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
});

test("language switch goes to /tr on the same path", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("link", { name: "Türkçe" }).click();
  await expect(page).toHaveURL(/\/tr$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
});
