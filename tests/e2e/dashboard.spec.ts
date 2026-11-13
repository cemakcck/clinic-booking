import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { asc } from "drizzle-orm";
import { dentists } from "@/lib/db/schema";
import { withDb } from "./calendar-db";

// Structure, not values: the numbers depend on the seeded history and the time of the run.

async function serious(page: Page) {
  return (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

async function signIn(page: Page, role: "Receptionist" | "Dentist") {
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: `Sign in as ${role}` }).click();
  await expect(page).toHaveURL(/\/en\/staff\/(calendar|today)/);
}

const allDentists = () =>
  withDb((db) =>
    db.select({ name: dentists.name, active: dentists.active }).from(dentists).orderBy(asc(dentists.sortOrder), asc(dentists.id)),
  );

test("receptionist sees the whole clinic and can switch periods", async ({ page }) => {
  const active = (await allDentists()).filter((d) => d.active).map((d) => d.name);
  expect(active.length).toBeGreaterThan(1);

  await signIn(page, "Receptionist");
  const nav = page.getByRole("navigation", { name: "Staff" });
  // Dashboard is the first item in the sidebar.
  await expect(nav.getByRole("link").first()).toHaveText("Dashboard");
  await nav.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

  // Four headline tiles, in order, each with a comparison against last week.
  const tiles = page.getByTestId("tile");
  await expect(tiles).toHaveCount(4);
  await expect(tiles.getByRole("heading", { level: 3 })).toHaveText(["Appointments", "No-show rate", "Online share", "Cancellations"]);
  for (const tile of await tiles.all()) {
    await expect(tile.getByTestId("tile-value")).toHaveText(/^(\d[\d,]*|\d+%|—)$/);
    await expect(tile.getByTestId("tile-compare")).toContainText("last week");
  }

  // Utilisation: one row per active dentist, each with its percentage written out.
  await expect(page.getByRole("heading", { level: 2, name: "Chair utilisation" })).toBeVisible();
  await expect(page.getByText("Includes appointments already booked for the rest of the week")).toBeVisible();
  const rows = page.getByTestId("util-row");
  await expect(rows).toHaveCount(active.length);
  await expect(rows.getByTestId("util-name")).toHaveText(active);
  for (const row of await rows.all()) await expect(row.getByTestId("util-pct")).toHaveText(/^(\d+%|—)$/);

  // Heatmap: printed counts plus a table with the same numbers.
  await expect(page.getByRole("heading", { level: 2, name: "Busiest hours" })).toBeVisible();
  const cells = page.getByTestId("heat-cell");
  expect(await cells.count()).toBeGreaterThan(20);
  await expect(cells.first()).toHaveText(/^\d+$/);
  const table = page.getByRole("table", { name: "Appointment starts by weekday and hour" });
  await expect(table).toBeAttached();
  await expect(table.getByRole("rowheader", { name: "Monday" })).toBeAttached();

  // The period picker is plain links; the active one is marked.
  const picker = page.getByRole("navigation", { name: "Period" });
  await expect(picker.getByRole("link", { name: "This week" })).toHaveAttribute("aria-current", "page");
  expect(await serious(page)).toEqual([]);

  await picker.getByRole("link", { name: "Last 4 weeks" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/dashboard\?period=4w$/);
  await expect(picker.getByRole("link", { name: "Last 4 weeks" })).toHaveAttribute("aria-current", "page");
  await expect(picker.getByRole("link", { name: "This week" })).not.toHaveAttribute("aria-current", "page");
  await expect(tiles.first().getByTestId("tile-compare")).toContainText("previous 4 weeks");
  await expect(page.getByText("Includes appointments already booked for the rest of the week")).toHaveCount(0);

  await page.goto("/en/staff/dashboard?period=3m");
  await expect(tiles.first().getByTestId("tile-compare")).toContainText("previous 3 months");

  // Unknown values fall back to this week.
  await page.goto("/en/staff/dashboard?period=decade");
  await expect(picker.getByRole("link", { name: "This week" })).toHaveAttribute("aria-current", "page");
  await expect(tiles.first().getByTestId("tile-compare")).toContainText("last week");

  // Turkish staff UI.
  await page.goto("/tr/staff/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Panel" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Koltuk doluluğu" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "En yoğun saatler" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dönem" }).getByRole("link", { name: "Bu hafta" })).toHaveAttribute("aria-current", "page");
  await expect(tiles.first().getByTestId("tile-compare")).toContainText(/geçen hafta/i);
  expect(await serious(page)).toEqual([]);
});

test("a dentist sees only their own numbers", async ({ page }) => {
  const all = await allDentists();
  const others = all.map((d) => d.name).filter((n) => n !== "Dr. Elif Aydın");
  expect(others.length).toBeGreaterThan(0);

  await signIn(page, "Dentist");
  const nav = page.getByRole("navigation", { name: "Staff" });
  await expect(nav.getByRole("link").first()).toHaveText("Dashboard");
  await nav.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByTestId("tile")).toHaveCount(4);
  await expect(page.getByTestId("util-row")).toHaveCount(1);
  await expect(page.getByTestId("util-name")).toHaveText("Dr. Elif Aydın");

  // Nowhere in what reached the browser: rendered HTML and the RSC payload inlined in it.
  const html = await page.content();
  for (const name of others) expect(html).not.toContain(name);
  expect(await serious(page)).toEqual([]);
});
