import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addAppointment, addRequest, elifId, freeDay } from "./calendar-db";

const rand = () => Math.random().toString(36).slice(2, 8);

async function signIn(page: Page, role: "Receptionist" | "Dentist") {
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: `Sign in as ${role}` }).click();
  await expect(page).toHaveURL(/\/en\/staff\/(calendar|today)/);
}

/** Serious and critical axe violations (same bar as the calendar specs). */
async function serious(page: Page) {
  return (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

const badge = (page: Page) => page.getByRole("navigation", { name: "Staff" }).getByTestId("nav-badge");

test("receptionist marks a request contacted: it moves filters and the sidebar count drops", async ({ page }) => {
  const name = `Caller ${rand()}`;
  const req = await addRequest(name);
  try {
    await signIn(page, "Receptionist");
    await page.goto("/en/staff/requests");
    const card = page.locator(`[data-request-id="${req.id}"]`);
    await expect(card).toContainText(name);
    await expect(card.getByTestId("request-status")).toHaveText("New");
    // Public demo: other visitors' numbers and messages never reach the page.
    await expect(card).toContainText("+90 5•• ••• •• 23");
    await expect(card).toContainText("Hidden in the demo");
    await expect(card).not.toContainText("E2E request");
    const before = Number(await badge(page).textContent());
    expect(before).toBeGreaterThanOrEqual(1);

    expect(await serious(page)).toEqual([]);

    await card.getByRole("button", { name: "Mark contacted" }).click();
    await expect(page.getByTestId("requests-status")).toHaveText(`${name} is now Contacted.`);
    await expect(card).toHaveCount(0);
    if (before > 1) await expect(badge(page)).toHaveText(String(before - 1));
    else await expect(badge(page)).toHaveCount(0);

    await page.getByRole("link", { name: "Contacted", exact: true }).click();
    await expect(page).toHaveURL(/status=contacted/);
    await expect(card).toBeVisible();
    await expect(card.getByTestId("request-status")).toHaveText("Contacted");
  } finally {
    await req.cleanup();
  }
});

test("patient search shows their appointments with a calendar link", async ({ page }) => {
  const name = `İlker Şahin ${rand()}`;
  const id = await elifId();
  const { date, starts } = await freeDay(id);
  const a = await addAppointment(id, date, starts[0], name);
  try {
    await signIn(page, "Receptionist");
    await page.goto("/en/staff/patients");
    await page.getByLabel("Search patients").fill(name.toLowerCase().replace("i̇", "i"));
    await page.getByRole("button", { name: "Search" }).click();
    const row = page.getByTestId("patient-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("İlker Şahin");
    await row.getByRole("link").click();
    const detail = page.getByTestId("patient-detail");
    await expect(detail.getByTestId("patient-appointment")).toHaveCount(1);
    await expect(detail).toContainText(starts[0]);
    await expect(detail).toContainText("Booked");
    expect(await serious(page)).toEqual([]);
    await detail.getByRole("link", { name: "Open in calendar" }).click();
    await expect(page).toHaveURL(new RegExp(`/en/staff/calendar\\?.*open=${a.id}`));
  } finally {
    await a.cleanup();
  }
});

test("dentist: no requests, own patients only", async ({ page }) => {
  const own = `Own ${rand()}`;
  const id = await elifId();
  const { date, starts } = await freeDay(id);
  const a = await addAppointment(id, date, starts[0], own);
  try {
    await signIn(page, "Dentist");
    await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: /Requests/ })).toHaveCount(0);
    expect((await page.goto("/en/staff/requests"))?.status()).toBe(404);
    await page.goto("/en/staff/patients");
    await expect(page.getByTestId("patient-row").filter({ hasText: own })).toHaveCount(1);
    await page.getByLabel("Search patients").fill("Zzzzqq");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByTestId("patient-row")).toHaveCount(0);
  } finally {
    await a.cleanup();
  }
});
