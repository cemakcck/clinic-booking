import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addAppointment,
  addMinutes,
  addTodayAppointment,
  blocksByNote,
  deleteBlocksByNote,
  deleteEntryAndPatient,
  elifId,
  entryRows,
  freeDay,
  minutesLeftToday,
  quietDate,
  weeklyFreeDay,
} from "./calendar-db";

const rand = () => Math.random().toString(36).slice(2, 8);
const entry = (page: Page, id: string) => page.locator(`[data-testid="entry"][data-entry-id="${id}"]`);
const toast = (page: Page) => page.getByTestId("toast");

async function asDentist(page: Page, path = "/en/staff/today") {
  await page.goto("/en/staff/login");
  await page.getByRole("button", { name: "Sign in as Dentist" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/today$/);
  if (path !== "/en/staff/today") await page.goto(path);
}

/** Today-only fixtures need room before midnight; skip them late at night so the suite passes at any hour. */
const skipLate = () => test.skip(minutesLeftToday() < 90, "less than 90 minutes left today for a today fixture");

const weekUrl = (date: string, dentistId: number) => `/en/staff/calendar?view=week&date=${date}&dentist=${dentistId}`;

async function fillBlock(page: Page, f: { date: string; from: string; to: string; reason: string; note: string }) {
  const dialog = page.getByRole("dialog", { name: "Block time" });
  await expect(dialog).toContainText("Your calendar");
  await dialog.getByLabel("Start date").fill(f.date);
  await dialog.getByLabel("Start time").fill(f.from);
  await dialog.getByLabel("End date").fill(f.date);
  await dialog.getByLabel("End time").fill(f.to);
  await dialog.getByLabel("Reason").selectOption(f.reason);
  await dialog.getByLabel("Note (optional)").fill(f.note);
  return dialog;
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("dentist lands on today with the next patient highlighted", async ({ page }) => {
    skipLate();
    const id = await elifId();
    const a = await addTodayAppointment(id, `Next Up ${rand()}`);
    try {
      await asDentist(page);
      await expect(page.getByTestId("today-greeting")).toContainText(/Good (morning|afternoon|evening)/);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Dr. Elif Aydın");
      await expect(page.getByTestId("today-count")).toContainText(/\d+ patients?/);
      const item = page.locator(`[data-testid="today-item"][data-id="${a.id}"]`);
      await expect(item).toBeVisible();
      await expect(item).toContainText(a.time);
      // Exactly one item is the next one, and it is the first not-yet-finished booked/arrived.
      const next = page.locator('[data-testid="today-item"][data-next="true"]');
      await expect(next).toHaveCount(1);
      await expect(next).toContainText("Next");
      const before = await page.locator('[data-testid="today-item"]').evaluateAll((els, nid) => {
        const i = els.findIndex((e) => e.getAttribute("data-id") === nid);
        return els.slice(0, i).map((e) => e.getAttribute("data-status"));
      }, await next.getAttribute("data-id"));
      expect(before.every((s) => s === "completed" || s === "no_show" || s === "booked" || s === "arrived")).toBe(true);
      // Phone-first: no sideways scrolling at 390px.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.getByRole("link", { name: "Open my calendar" })).toHaveAttribute(
        "href",
        new RegExp(`/en/staff/calendar\\?view=week&dentist=${id}$`),
      );
      await page.getByRole("link", { name: "Open my calendar" }).click();
      await expect(page.getByTestId("calendar")).toHaveAttribute("data-view", "week");
    } finally {
      await a.cleanup();
    }
  });

  test("dentist marks own patient arrived", async ({ page }) => {
    skipLate();
    const a = await addTodayAppointment(await elifId(), `Mark Arrived ${rand()}`);
    try {
      await asDentist(page);
      const item = page.locator(`[data-testid="today-item"][data-id="${a.id}"]`);
      await expect(item).toHaveAttribute("data-status", "booked");
      // Only the allowed transitions are offered.
      await expect(item.getByRole("button", { name: "Arrived" })).toBeVisible();
      await expect(item.getByRole("button", { name: "No-show" })).toBeVisible();
      await expect(item.getByRole("button", { name: "Completed" })).toHaveCount(0);
      await item.getByRole("button", { name: "Arrived" }).click();
      await expect(item).toHaveAttribute("data-status", "arrived");
      await expect(item.getByRole("button", { name: "Completed" })).toBeVisible();
      await expect(item.getByRole("button", { name: "Undo arrival" })).toBeVisible();
      await expect(item.getByRole("button", { name: "Arrived" })).toHaveCount(0);
      expect((await entryRows([a.id]))[0].status).toBe("arrived");
      await page.reload();
      await expect(item).toHaveAttribute("data-status", "arrived");
    } finally {
      await a.cleanup();
    }
  });

  test("dentist can block time from the phone view", async ({ page }) => {
    await asDentist(page);
    await page.getByRole("button", { name: "Block time" }).click();
    const dialog = page.getByRole("dialog", { name: "Block time" });
    await expect(dialog).toContainText("Your calendar");
    await expect(dialog.getByLabel("Dentist")).toHaveCount(0);
    // A refusal is announced and keeps what was typed.
    await dialog.getByLabel("Start time").fill("11:00");
    await dialog.getByLabel("End time").fill("10:00");
    await dialog.getByRole("button", { name: "Save block" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel("Start time")).toHaveValue("11:00");
  });

  test("axe on today", async ({ page }) => {
    skipLate();
    const a = await addTodayAppointment(await elifId(), `Axe ${rand()}`);
    try {
      await asDentist(page);
      await expect(page.getByTestId("today-item").first()).toBeVisible();
      const serious = async () =>
        (await new AxeBuilder({ page }).analyze()).violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
      expect(await serious()).toEqual([]);
      await page.getByRole("button", { name: "Block time" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await serious()).toEqual([]);
    } finally {
      await a.cleanup();
    }
  });
});

test.describe("own calendar", () => {
  test.use({ viewport: { width: 1400, height: 1000 } });

  test("a dentist's calendar opens on their own week", async ({ page }) => {
    await asDentist(page, "/en/staff/calendar");
    await expect(page.getByTestId("calendar")).toHaveAttribute("data-view", "week");
    await expect(page.getByRole("combobox", { name: "Dentist" })).toHaveValue(String(await elifId()));
  });

  test("dentist blocks surgery time on own calendar", async ({ page }) => {
    const id = await elifId();
    const { date, starts } = await freeDay(id);
    const from = starts[0];
    const note = `e2e-${rand()}`;
    try {
      await asDentist(page, weekUrl(date, id));
      await page.getByRole("button", { name: "Block time" }).click();
      const dialog = await fillBlock(page, { date, from, to: addMinutes(from, 30), reason: "surgery", note });
      await dialog.getByRole("button", { name: "Save block" }).click();
      await expect(dialog).toBeHidden();
      await expect(toast(page)).toContainText("Time blocked");
      const block = page.locator(`[data-testid="entry"][data-kind="block"][data-date="${date}"][data-start="${from}"]`).filter({ hasText: "Surgery" });
      await expect(block).toHaveCount(1);
      expect(await block.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("repeating-linear-gradient");
      expect(await blocksByNote(note)).toHaveLength(1);
    } finally {
      await deleteBlocksByNote(note);
    }
  });

  test("dentist block over a booked patient is refused with the conflict list", async ({ page }) => {
    const id = await elifId();
    const { date, starts } = await freeDay(id);
    const from = starts[0];
    const name = `Move Me ${rand()}`;
    const a = await addAppointment(id, date, from, name);
    const note = `e2e-${rand()}`;
    try {
      await asDentist(page, weekUrl(date, id));
      await page.getByRole("button", { name: "Block time" }).click();
      const dialog = await fillBlock(page, { date, from, to: addMinutes(from, 30), reason: "surgery", note });
      await dialog.getByRole("button", { name: "Save block" }).click();
      const alert = dialog.getByRole("alert");
      await expect(alert).toContainText("Move these first");
      await expect(alert).toContainText(name);
      await expect(alert).toBeFocused();
      await expect(dialog.getByLabel("Start time")).toHaveValue(from);
      await expect(dialog.getByLabel("Note (optional)")).toHaveValue(note);
      expect(await blocksByNote(note)).toHaveLength(0);
    } finally {
      await deleteBlocksByNote(note);
      await a.cleanup();
    }
  });

  test("dentist repeats a block weekly for 3 weeks", async ({ page }) => {
    const id = await elifId();
    const { date, from } = await weeklyFreeDay(id, 2);
    const note = `e2e-${rand()}`;
    try {
      await asDentist(page, weekUrl(date, id));
      await page.getByRole("button", { name: "Block time" }).click();
      const dialog = await fillBlock(page, { date, from, to: addMinutes(from, 30), reason: "meeting", note });
      await dialog.getByLabel("Weekly, for a number of weeks").check();
      await dialog.getByRole("spinbutton", { name: "Number of weeks" }).fill("3");
      await dialog.getByRole("button", { name: "Save block" }).click();
      await expect(dialog).toBeHidden();
      const rows = await blocksByNote(note);
      expect(rows).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        const d = new Date(`${date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 7 * i);
        const day = d.toISOString().slice(0, 10);
        expect(rows[i]).toEqual({ date: day, start: from });
        await page.goto(weekUrl(day, id));
        await expect(
          page.locator(`[data-testid="entry"][data-kind="block"][data-date="${day}"][data-start="${from}"]`).filter({ hasText: "Meeting" }),
        ).toHaveCount(1);
      }
    } finally {
      await deleteBlocksByNote(note);
    }
  });

  test("dentist deletes own block", async ({ page }) => {
    const id = await elifId();
    const { date, starts } = await freeDay(id);
    const from = starts[0];
    const note = `e2e-${rand()}`;
    try {
      await asDentist(page, weekUrl(date, id));
      await page.getByRole("button", { name: "Block time" }).click();
      const dialog = await fillBlock(page, { date, from, to: addMinutes(from, 30), reason: "leave", note });
      await dialog.getByRole("button", { name: "Save block" }).click();
      await expect(dialog).toBeHidden();
      const block = page.locator(`[data-testid="entry"][data-kind="block"][data-date="${date}"][data-start="${from}"]`);
      await expect(block).toHaveCount(1);
      await block.click();
      const edit = page.getByRole("dialog", { name: "Edit block" });
      await edit.getByRole("button", { name: "Delete block" }).click();
      await expect(edit).toBeHidden();
      await expect(block).toHaveCount(0);
      expect(await blocksByNote(note)).toHaveLength(0);
    } finally {
      await deleteBlocksByNote(note);
    }
  });

  test("dentist moves own appointment via the dialog", async ({ page }) => {
    const id = await elifId();
    const { date, starts } = await freeDay(id, (s) => s.length > 1 && s.some((x) => x >= addMinutes(s[0], 90)));
    const from = starts[0];
    const to = starts.find((s) => s >= addMinutes(from, 90))!;
    const a = await addAppointment(id, date, from, `Mover ${rand()}`);
    try {
      await asDentist(page, weekUrl(date, id));
      const e = entry(page, a.id);
      await expect(e).toHaveAttribute("data-start", from);
      await e.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Reschedule" }).click();
      await dialog.getByLabel("Time").selectOption(to);
      await dialog.getByRole("button", { name: "Save new time" }).click();
      await expect(dialog).toBeHidden();
      await expect(toast(page)).toContainText("Moved");
      await expect(e).toHaveAttribute("data-start", to);
      expect((await entryRows([a.id]))[0].start).toBe(to);
    } finally {
      await a.cleanup();
    }
  });

  test("dentist creates a follow-up appointment for own calendar", async ({ page }) => {
    const id = await elifId();
    const { date, starts } = await freeDay(id);
    const from = starts[0];
    const name = `Follow Up ${rand()}`;
    await asDentist(page, weekUrl(date, id));
    await page.getByRole("button", { name: "+ Walk-in" }).click();
    const dialog = page.getByRole("dialog", { name: "New appointment" });
    await expect(dialog.getByTestId("slots-state")).toHaveAttribute("data-state", "ready");
    await dialog.getByLabel("Date").fill(date);
    await expect(dialog.getByLabel("Time").locator(`option[value="${from}"]`)).toHaveCount(1);
    await dialog.getByLabel("Time").selectOption(from);
    await dialog.getByLabel("Patient name").fill(name);
    await dialog.getByLabel("Phone").fill(`0532 8${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`);
    await dialog.getByRole("button", { name: "Create appointment" }).click();
    await expect(dialog).toBeHidden();
    const created = page.locator('[data-testid="entry"]').filter({ hasText: name });
    await expect(created).toHaveCount(1);
    await expect(created).toHaveAttribute("data-start", from);
    await expect(created).toHaveAttribute("data-dentist", String(id));
    await expect(created).toHaveAttribute("data-draggable", "true");
    await deleteEntryAndPatient((await created.getAttribute("data-entry-id"))!);
  });

  test("other dentists' entries are visible but not editable", async ({ page }) => {
    const date = await quietDate();
    const own = await elifId();
    await asDentist(page, `/en/staff/calendar?view=day&date=${date}`);
    const others = page.locator(`[data-testid="column"]:not([data-dentist="${own}"]) [data-testid="entry"][data-kind="appointment"]`);
    expect(await others.count()).toBeGreaterThan(0);
    expect(await page.locator(`[data-testid="column"]:not([data-dentist="${own}"]) [data-draggable="true"]`).count()).toBe(0);
    await others.first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("View only");
    for (const n of ["Reschedule", "Mark arrived", "No-show", "Cancel appointment"]) {
      await expect(dialog.getByRole("button", { name: n })).toHaveCount(0);
    }
    await expect(dialog).not.toContainText("+90");
  });
});
