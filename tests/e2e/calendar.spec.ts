import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { bookAnyCheckup } from "./helpers";
import { entryRows, findClash, findMovable, freeWindow, insertOutsideHours, quietDate } from "./calendar-db";

test.use({ viewport: { width: 1400, height: 1000 } });

const entry = (page: Page, id: string) => page.locator(`[data-testid="entry"][data-entry-id="${id}"]`);
const toast = (page: Page) => page.getByTestId("toast");

async function asReceptionist(page: Page, path: string) {
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: "Sign in as Receptionist" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/calendar/);
  await page.goto(path);
  await expect(page.getByTestId("calendar")).toBeVisible();
}

/** Pointer drag: press, nudge past the activation distance, then glide to the target. */
async function drag(page: Page, from: Locator, dx: number, dy: number) {
  const box = (await from.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(10, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.move(x + dx, y + dy, { steps: 2 });
  await page.mouse.up();
}

test("magic moment: the visitor's booking is highlighted on the receptionist calendar", async ({ page }) => {
  const { date } = await bookAnyCheckup(page);
  await page.getByTestId("demo-callout").getByRole("button", { name: /Try it as Receptionist/ }).click();
  await expect(page).toHaveURL(new RegExp(`/en/staff/calendar\\?date=${date}$`));
  await expect(page.getByTestId("calendar")).toHaveAttribute("data-date", date);
  const mine = page.locator('[data-testid="entry"][data-mine="true"]');
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText("★ Your booking");
  await expect(mine).toContainText("Ayşe Yılmaz");
});

test("day view shows a column per dentist and counters", async ({ page }) => {
  const date = await quietDate();
  await asReceptionist(page, `/en/staff/calendar?date=${date}`);
  const heads = page.getByTestId("column-head");
  await expect(heads).toHaveCount(4);
  for (const name of ["Dr. Elif Aydın", "Dr. Murat Kaya", "Dr. Selin Demir", "Dr. Can Öztürk"]) {
    await expect(heads.filter({ hasText: name })).toHaveCount(1);
  }
  await expect(page.getByTestId("column")).toHaveCount(4);
  const counters = page.getByTestId("counters");
  await expect(counters).toContainText(/\d+\s*appointments?/);
  await expect(counters).toContainText(/\d+\s*arrived/);
  await expect(counters).toContainText(/\d+\s*no-shows?/);
  await expect(counters).toContainText(/\d+\s*free slots? left/);
  expect(await page.locator('[data-testid="entry"][data-kind="appointment"]').count()).toBeGreaterThan(3);
  await expect(page.getByTestId("legend")).toContainText("Booked");
  // Prev/next keep the view and move a day.
  await page.getByRole("link", { name: "Next day" }).click();
  await expect(page.getByTestId("calendar")).not.toHaveAttribute("data-date", date);
  await page.getByRole("link", { name: "Previous day" }).click();
  await expect(page.getByTestId("calendar")).toHaveAttribute("data-date", date);
});

test("drag moves an appointment", async ({ page }) => {
  const m = await findMovable(await quietDate(), 120);
  await asReceptionist(page, `/en/staff/calendar?date=${m.date}`);
  const e = entry(page, m.id);
  await expect(e).toHaveAttribute("data-start", m.from);
  await drag(page, e, 0, 104); // 2 hours at 52px per hour
  await expect(toast(page)).toContainText("Moved");
  await expect(e).toHaveAttribute("data-start", m.to);
  await page.reload();
  await expect(entry(page, m.id)).toHaveAttribute("data-start", m.to);
  expect((await entryRows([m.id]))[0].start).toBe(m.to);
});

test("drag onto an occupied time snaps back with a message", async ({ page }) => {
  const date = await quietDate();
  const c = await findClash(date);
  await asReceptionist(page, `/en/staff/calendar?date=${date}`);
  const e = entry(page, c.id);
  const before = (await e.boundingBox())!;
  const [h1, m1] = c.from.split(":").map(Number);
  const [h2, m2] = c.onto.split(":").map(Number);
  const dy = Math.round(((h2 * 60 + m2 - (h1 * 60 + m1)) * 52) / 60);
  await drag(page, e, 0, dy);
  await expect(page.getByRole("alert").filter({ hasText: /already taken/ })).toBeVisible();
  await expect(e).toHaveAttribute("data-start", c.from);
  await expect.poll(async () => Math.round((await e.boundingBox())!.y)).toBe(Math.round(before.y));
  expect((await entryRows([c.id]))[0].start).toBe(c.from);
});

test("keyboard reschedule through the appointment dialog", async ({ page }) => {
  const m = await findMovable(await quietDate(), 60);
  await asReceptionist(page, `/en/staff/calendar?date=${m.date}`);
  const e = entry(page, m.id);
  await e.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(e).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Reschedule" }).click();
  const time = dialog.getByLabel("Time");
  await expect(time.locator(`option[value="${m.to}"]`)).toHaveCount(1);
  await time.selectOption(m.to);
  await dialog.getByRole("button", { name: "Save new time" }).click();
  await expect(dialog).toBeHidden();
  await expect(toast(page)).toContainText("Moved");
  await expect(e).toHaveAttribute("data-start", m.to);
  // Focus comes back to the entry that opened the dialog.
  await expect(e).toBeFocused();
});

test("mark arrived changes the status", async ({ page }) => {
  const m = await findMovable(await quietDate(), 0);
  await asReceptionist(page, `/en/staff/calendar?date=${m.date}`);
  const e = entry(page, m.id);
  await expect(e).toHaveAttribute("data-status", "booked");
  await e.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Mark arrived" }).click();
  await expect(dialog).toBeHidden();
  await expect(e).toHaveAttribute("data-status", "arrived");
  await expect(e).toContainText("Arrived");
  await expect(e).not.toHaveAttribute("data-draggable", "true");
  expect((await entryRows([m.id]))[0].status).toBe("arrived");
});

test("cancel asks for confirmation inside the dialog", async ({ page }) => {
  const m = await findMovable(await quietDate(), 0);
  await asReceptionist(page, `/en/staff/calendar?date=${m.date}`);
  await entry(page, m.id).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancel appointment" }).click();
  await expect(dialog.getByText("Cancel this appointment?")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog.getByText("Cancel this appointment?")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel appointment" }).click();
  await dialog.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(dialog).toBeHidden();
  await expect(entry(page, m.id)).toHaveCount(0);
  expect((await entryRows([m.id]))[0].status).toBe("cancelled");
});

test("walk-in: a new appointment with phone and no email appears", async ({ page }) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  await asReceptionist(page, `/en/staff/calendar?date=${today}`);
  await page.getByRole("button", { name: "+ Walk-in" }).click();
  const dialog = page.getByRole("dialog", { name: "New appointment" });
  await expect(dialog).toBeVisible();
  const time = dialog.getByLabel("Time");
  await expect(dialog.getByTestId("slots-state")).toHaveAttribute("data-state", "ready");
  if ((await time.locator("option").count()) === 0) {
    // Clinic closed now (evening, Sunday): book the walk-in on a quiet day instead.
    await dialog.getByLabel("Date").fill(await quietDate());
    await expect(time).toHaveValue(/^\d{2}:\d{2}$/);
  }
  const chosen = await time.inputValue();
  const chosenDate = await dialog.getByLabel("Date").inputValue();
  expect(chosen).toMatch(/^\d{2}:\d{2}$/);
  const name = `Walk In ${Math.random().toString(36).slice(2, 7)}`;
  await dialog.getByLabel("Patient name").fill(name);
  // Patients are matched by phone, so a fresh number keeps repeated runs apart.
  await dialog.getByLabel("Phone").fill(`0532 9${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`);
  await dialog.getByRole("button", { name: "Create appointment" }).click();
  await expect(dialog).toBeHidden();
  const created = page.locator('[data-testid="entry"]').filter({ hasText: name });
  // A walk-in on another day takes the calendar there.
  await expect(page.getByTestId("calendar")).toHaveAttribute("data-date", chosenDate);
  await expect(created).toHaveCount(1);
  await expect(created).toHaveAttribute("data-start", chosen);
});

test("walk-in form keeps typed values and explains a bad phone", async ({ page }) => {
  const date = await quietDate();
  await asReceptionist(page, `/en/staff/calendar?date=${date}`);
  await page.getByRole("button", { name: "+ Walk-in" }).click();
  const dialog = page.getByRole("dialog", { name: "New appointment" });
  await expect(dialog.getByTestId("slots-state")).toHaveAttribute("data-state", "ready");
  await dialog.getByLabel("Patient name").fill("Keep Me");
  await dialog.getByLabel("Phone").fill("12");
  await dialog.getByRole("button", { name: "Create appointment" }).click();
  await expect(dialog.getByRole("alert")).toContainText("valid phone number");
  await expect(dialog.getByLabel("Patient name")).toHaveValue("Keep Me");
  await expect(dialog.getByLabel("Phone")).toHaveValue("12");
});

test("block time for a dentist appears hatched", async ({ page }) => {
  const date = await quietDate();
  const w = await freeWindow(date);
  await asReceptionist(page, `/en/staff/calendar?date=${date}`);
  await page.getByRole("button", { name: "Block time" }).click();
  const dialog = page.getByRole("dialog", { name: "Block time" });
  await dialog.getByLabel("Dentist").selectOption(String(w.dentistId));
  await dialog.getByLabel("Start date").fill(date);
  await dialog.getByLabel("Start time").fill(w.start);
  await dialog.getByLabel("End date").fill(date);
  await dialog.getByLabel("End time").fill(w.end);
  await dialog.getByLabel("Reason").selectOption("meeting");
  await dialog.getByLabel("Note (optional)").fill("Team huddle");
  await dialog.getByRole("button", { name: "Save block" }).click();
  await expect(dialog).toBeHidden();
  const block = page
    .locator(`[data-testid="column"][data-dentist="${w.dentistId}"] [data-testid="entry"][data-kind="block"]`)
    .filter({ hasText: "Meeting" });
  await expect(block).toHaveCount(1);
  await expect(block).toHaveAttribute("data-start", w.start);
  expect(await block.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("repeating-linear-gradient");

  // Remove it again through its dialog.
  await block.click();
  const edit = page.getByRole("dialog", { name: "Edit block" });
  await edit.getByRole("button", { name: "Delete block" }).click();
  await expect(edit).toBeHidden();
  await expect(block).toHaveCount(0);
});

test("a block over appointments is refused with a list to move first", async ({ page }) => {
  const m = await findMovable(await quietDate(), 0);
  await asReceptionist(page, `/en/staff/calendar?date=${m.date}`);
  await page.getByRole("button", { name: "Block time" }).click();
  const dialog = page.getByRole("dialog", { name: "Block time" });
  await dialog.getByLabel("Dentist").selectOption(String(m.dentistId));
  await dialog.getByLabel("Start date").fill(m.date);
  await dialog.getByLabel("Start time").fill(m.from);
  await dialog.getByLabel("End date").fill(m.date);
  const [h, mm] = m.from.split(":").map(Number);
  await dialog.getByLabel("End time").fill(`${String(h + 1).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  await dialog.getByLabel("Reason").selectOption("surgery");
  await dialog.getByRole("button", { name: "Save block" }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("Move these first");
  // The typed values survive the refusal.
  await expect(dialog.getByLabel("Start time")).toHaveValue(m.from);
  await alert.getByRole("button").first().click();
  const appt = page.getByRole("dialog");
  await expect(appt.getByRole("button", { name: "Reschedule" })).toBeVisible();
});

test("week view for one dentist", async ({ page }) => {
  const date = await quietDate();
  await asReceptionist(page, `/en/staff/calendar?date=${date}`);
  await page.getByRole("link", { name: "Week" }).click();
  await expect(page.getByTestId("calendar")).toHaveAttribute("data-view", "week");
  await expect(page.getByTestId("column")).toHaveCount(7);
  const select = page.getByLabel("Dentist");
  await select.selectOption({ label: "Dr. Murat Kaya" });
  await expect(page).toHaveURL(/view=week/);
  await expect(page).toHaveURL(/dentist=\d+/);
  const cols = page.getByTestId("column");
  await expect(cols).toHaveCount(7);
  const dentistIds = await cols.evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-dentist")))]);
  expect(dentistIds).toHaveLength(1);
  expect(await page.locator('[data-testid="entry"]').count()).toBeGreaterThan(3);
  await expect(page.getByRole("link", { name: "Next week" })).toBeVisible();
});

test("axe on the calendar page", async ({ page }) => {
  const date = await quietDate();
  await asReceptionist(page, `/en/staff/calendar?date=${date}`);
  const serious = async () =>
    (await new AxeBuilder({ page }).analyze()).violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(await serious()).toEqual([]);
  await page.locator('[data-testid="entry"][data-kind="appointment"]').first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await serious()).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Week" }).click();
  await expect(page.getByTestId("calendar")).toHaveAttribute("data-view", "week");
  expect(await serious()).toEqual([]);
});

test("tr calendar labels are Turkish", async ({ page }) => {
  const date = await quietDate();
  await page.goto("/tr");
  await page.getByRole("complementary", { name: "Demo bildirimi" }).getByRole("button", { name: "Resepsiyon" }).click();
  await expect(page).toHaveURL(/\/tr\/staff\/calendar/);
  await page.goto(`/tr/staff/calendar?date=${date}`);
  await expect(page.getByRole("button", { name: "Saat kapat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Randevusuz hasta" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bugün" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Gün", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hafta", exact: true })).toBeVisible();
  await expect(page.getByTestId("counters")).toContainText("randevu");
  await expect(page.getByTestId("legend")).toContainText("Geldi");
  await page.locator('[data-testid="entry"][data-kind="appointment"]').first().click();
  await expect(page.getByRole("dialog")).toContainText("Tedavi");
});

test("a dentist edits only their own column; others open read-only", async ({ page }) => {
  const date = await quietDate();
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: "Sign in as Dentist" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/today/);
  await page.goto(`/en/staff/calendar?view=day&date=${date}`);
  const cols = page.getByTestId("column");
  const own = cols.first(); // Dr. Elif Aydın, the demo dentist, sorts first
  await expect(page.getByTestId("column-head").first()).toContainText("Dr. Elif Aydın");
  expect(await own.locator('[data-testid="entry"][data-draggable="true"]').count()).toBeGreaterThan(0);
  expect(await page.locator('[data-testid="column"]').nth(1).locator('[data-draggable="true"]').count()).toBe(0);
  await page.getByTestId("column").nth(1).locator('[data-testid="entry"][data-kind="appointment"]').first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("View only");
  await expect(dialog.getByRole("button", { name: "Reschedule" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Mark arrived" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Block time" }).click();
  const block = page.getByRole("dialog", { name: "Block time" });
  await expect(block).toContainText("Your calendar");
  await expect(block.getByLabel("Dentist")).toHaveCount(0);
});

test("appointments outside the clinic hours stay visible, flagged and openable", async ({ page }) => {
  const date = await quietDate();
  const early = await insertOutsideHours(date, "08:00", "08:30");
  const late = await insertOutsideHours(date, "18:30", "19:00");
  try {
    await asReceptionist(page, `/en/staff/calendar?date=${date}`);
    for (const path of [`/en/staff/calendar?date=${date}`, `/en/staff/calendar?view=week&date=${date}&dentist=${early.dentistId}`]) {
      await page.goto(path);
      await expect(page.getByTestId("attention")).toContainText(/Needs attention: [2-9]/);
      for (const [a, start] of [[early, "08:00"], [late, "18:30"]] as const) {
        const e = entry(page, a.id);
        await expect(e).toBeVisible();
        await expect(e).toHaveAttribute("data-start", start);
        await expect(e).toContainText("Outside working hours");
        await expect(e.locator('[aria-hidden="true"]', { hasText: "⚠" })).toBeVisible();
      }
      await entry(page, early.id).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("Early Bird Kaya");
      await expect(dialog.getByRole("button", { name: "Cancel appointment" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  } finally {
    await early.cleanup();
    await late.cleanup();
  }
});
