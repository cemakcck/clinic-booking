import { expect, test } from "@playwright/test";

// Rate limit is 5/hour per IP bucket and every Playwright request shares one bucket: this file submits twice per server run.

test("treatment page leads to the contact form with the treatment preselected, EN success", async ({ page }) => {
  await page.goto("/en/treatments/whitening");
  await page.getByTestId("pricing-note").getByRole("link", { name: "Request a call back" }).first().click();
  await expect(page).toHaveURL(/\/en\/contact\?treatment=whitening#callback/);
  await expect(page.getByLabel("Treatment (optional)")).toHaveValue("whitening");
  await page.getByLabel("Your name").fill("Ayşe Yılmaz");
  await page.getByLabel("Phone number").fill("0532 111 22 33");
  await page.getByRole("button", { name: "Request a call back" }).click();
  await expect(page.getByTestId("callback-success")).toContainText("Thank you, we'll call you back");
});

test("TR contact form shows Turkish success text", async ({ page }) => {
  await page.goto("/tr/contact?treatment=whitening#callback");
  await page.getByLabel("Adınız").fill("Mehmet Çelik");
  await page.getByLabel("Telefon numaranız").fill("5321112233");
  await page.getByRole("button", { name: "Sizi arayalım" }).click();
  await expect(page.getByTestId("callback-success")).toContainText("Teşekkürler, sizi arayacağız");
});
