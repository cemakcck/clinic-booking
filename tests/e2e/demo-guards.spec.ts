import { expect, test, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { clinicHours, dentists, entries } from "@/lib/db/schema";
import { snapshotCapacity } from "@/lib/demo/floor";
import { atIstanbul, istanbulTimeOf, weekdayOf } from "@/lib/time";
import { bookAnyCheckup } from "./helpers";
import { deleteBlocksByNote, withDb } from "./calendar-db";

// The demo capacity floor (spec §10): a receptionist trying to block out the next few days is
// eventually refused, and a visitor can still book on each of those days.

const FLOOR_MESSAGE = "The demo keeps a few free times for other visitors";

type Gap = { dentistId: number; from: string; to: string };

/** Floor days that still have public capacity right now (today drops out once it's closed). */
async function floorDaysWithCapacity(): Promise<string[]> {
  return withDb(async (db) => {
    const snap = await snapshotCapacity(db, new Date());
    return Object.entries(snap)
      .filter(([, n]) => n > 0)
      .map(([d]) => d)
      .sort();
  });
}

/** Every free stretch inside clinic hours on `date`, per active dentist, biggest first. */
async function freeGaps(date: string): Promise<Gap[]> {
  return withDb(async (db) => {
    const [hours] = await db.select().from(clinicHours).where(eq(clinicHours.weekday, weekdayOf(date)));
    if (!hours?.open || !hours.close) return [];
    const open = atIstanbul(date, hours.open);
    const close = atIstanbul(date, hours.close);
    const ds = await db.select({ id: dentists.id }).from(dentists).where(eq(dentists.active, true));
    const busy = await db
      .select({ dentistId: entries.dentistId, during: entries.during })
      .from(entries)
      .where(and(eq(entries.active, true), inArray(entries.dentistId, ds.map((d) => d.id))));
    const out: (Gap & { minutes: number })[] = [];
    for (const d of ds) {
      const mine = busy
        .filter((b) => b.dentistId === d.id && b.during.start < close && open < b.during.end)
        .sort((a, b) => a.during.start.getTime() - b.during.start.getTime());
      let cursor = open;
      const push = (end: Date) => {
        const minutes = (end.getTime() - cursor.getTime()) / 60_000;
        if (minutes >= 15) out.push({ dentistId: d.id, from: istanbulTimeOf(cursor), to: istanbulTimeOf(end), minutes });
      };
      for (const b of mine) {
        if (b.during.start > cursor) push(b.during.start);
        if (b.during.end > cursor) cursor = b.during.end;
      }
      if (cursor < close) push(close);
    }
    return out.sort((a, b) => b.minutes - a.minutes);
  });
}

/** Tries one block through the receptionist's dialog; "ok", the floor refusal, or another error. */
async function tryBlock(page: Page, date: string, g: Gap, note: string): Promise<"ok" | "floor" | string> {
  await page.getByRole("button", { name: "Block time" }).click();
  const dialog = page.getByRole("dialog", { name: "Block time" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Dentist").selectOption(String(g.dentistId));
  await dialog.getByLabel("Start date").fill(date);
  await dialog.getByLabel("Start time").fill(g.from);
  await dialog.getByLabel("End date").fill(date);
  await dialog.getByLabel("End time").fill(g.to);
  await dialog.getByLabel("Reason").selectOption("other");
  await dialog.getByLabel("Note (optional)").fill(note);
  await dialog.getByRole("button", { name: "Save block" }).click();
  const alert = dialog.getByRole("alert");
  await expect.poll(async () => (await dialog.isHidden()) || (await alert.isVisible())).toBe(true);
  if (await dialog.isHidden()) return "ok";
  const text = (await alert.innerText()).trim();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return text.includes(FLOOR_MESSAGE) ? "floor" : text;
}

test("blocking out the next days is refused by the capacity floor; visitors can still book", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const note = `floor-e2e-${Math.random().toString(36).slice(2, 8)}`;
  const days = await floorDaysWithCapacity();
  expect(days.length).toBeGreaterThan(0);
  try {
    await page.goto("/en/staff/login");
    await page.getByRole("button", { name: "Sign in as Receptionist" }).click();
    await expect(page).toHaveURL(/\/en\/staff\/calendar/);

    const refusedOn: string[] = [];
    for (const date of days) {
      await page.goto(`/en/staff/calendar?date=${date}`);
      await expect(page.getByTestId("calendar")).toHaveAttribute("data-date", date);
      for (const g of await freeGaps(date)) {
        const r = await tryBlock(page, date, g, note);
        if (r === "floor") {
          refusedOn.push(date);
          break;
        }
        // A hold placed meanwhile can take part of a gap; anything else is a real failure.
        expect(r === "ok" || /just taken|already taken/i.test(r), r).toBe(true);
      }
    }
    // Every day that had capacity was eventually refused rather than drained to zero.
    expect(refusedOn).toEqual(days);

    // A fresh visitor (own browser, own rate-limit bucket) can still book on each of those days.
    const visitor = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": "203.0.113.77" } });
    try {
      const p = await visitor.newPage();
      for (const date of days) {
        const booked = await bookAnyCheckup(p, { date });
        expect(booked.date).toBe(date);
      }
    } finally {
      await visitor.close();
    }
  } finally {
    await deleteBlocksByNote(note);
  }
});

