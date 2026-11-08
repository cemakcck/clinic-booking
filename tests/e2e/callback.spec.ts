import { expect, test } from "@playwright/test";

// Rate limit is 5/hour per IP bucket and every Playwright request shares one bucket: this file makes two successful submissions per server run (invalid ones are rejected before the limiter).

test("treatment page leads to the contact form with the treatment preselected, EN success", async ({ page }) => {
  await page.goto("/en/treatments/whitening");
  await page.getByTestId("pricing-note").getByRole("link", { name: "Request a call back" }).first().click();
  await expect(page).toHaveURL(/\/en\/contact\?treatment=whitening#callback/);
  await expect(page.getByLabel("Treatment (optional)")).toHaveValue("whitening");
  await expect(page.getByText("This is a public demo: other visitors trying it can see requests")).toBeVisible();
  await page.getByLabel("Your name").fill("Ayşe Yılmaz");
  await page.getByLabel("Phone number").fill("0532 111 22 33");
  await page.getByLabel("Preferred language").selectOption("tr");
  await expect(page.getByLabel("Preferred language")).toHaveValue("tr");
  await page.getByRole("button", { name: "Request a call back" }).click();
  await expect(page.getByTestId("callback-success")).toContainText("Thank you, we'll call you back");
  await expect(page.getByTestId("callback-success")).toBeFocused();
});

test("TR contact form shows Turkish success text", async ({ page }) => {
  await page.goto("/tr/contact?treatment=whitening#callback");
  await page.getByLabel("Adınız").fill("Mehmet Çelik");
  await page.getByLabel("Telefon numaranız").fill("5321112233");
  await page.getByRole("button", { name: "Sizi arayalım" }).click();
  await expect(page.getByTestId("callback-success")).toContainText("Teşekkürler, sizi arayacağız");
});

test("invalid phone keeps typed values and focuses the phone field", async ({ page }) => {
  await page.goto("/en/contact?treatment=checkup#callback");
  await page.getByLabel("Your name").fill("Zeynep Kaya");
  await page.getByLabel("Phone number").fill("12");
  await page.getByRole("button", { name: "Request a call back" }).click();
  await expect(page.getByText("Please enter a valid phone number")).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveValue("Zeynep Kaya");
  await expect(page.getByLabel("Treatment (optional)")).toHaveValue("checkup");
  await expect(page.getByLabel("Phone number")).toBeFocused();
});
