import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetTables, testDb } from "./helpers/db";
import { emailLog } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";

const db = testDb();
const now = new Date("2026-11-08T10:00:00Z");
const msg = (over: Record<string, unknown> = {}) => ({
  kind: "booking_confirmation" as const,
  to: "ayse@gmail.test",
  locale: "en" as const,
  subject: "Hi",
  html: "<p>Hi</p>",
  text: "Hi",
  trigger: "patient" as const,
  now,
  ...over,
});
const fake = () => {
  const send = vi.fn(async (...args: unknown[]) => ({ id: "1", n: args.length }));
  return { send };
};

beforeEach(async () => {
  await resetTables(db);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.RESEND_API_KEY;
  delete process.env.DEMO_MODE;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(closeTestDb);

describe("sendEmail", () => {
  it("example.com is suppressed", async () => {
    process.env.RESEND_API_KEY = "k";
    const r = fake();
    expect(await sendEmail(db, msg({ to: "x@example.com" }), { resend: r })).toBe("suppressed");
    expect(await sendEmail(db, msg({ to: null }), { resend: r })).toBe("suppressed");
    expect(await sendEmail(db, msg({ to: "x@clinic.example" }), { resend: r })).toBe("suppressed");
    expect(r.send).not.toHaveBeenCalled();
    const rows = await db.select().from(emailLog);
    expect(rows.map((x) => x.status)).toEqual(["suppressed", "suppressed", "suppressed"]);
  });

  it("staff trigger in demo is logged", async () => {
    process.env.DEMO_MODE = "1";
    process.env.RESEND_API_KEY = "k";
    const r = fake();
    expect(await sendEmail(db, msg({ trigger: "staff" }), { resend: r })).toBe("logged");
    expect(r.send).not.toHaveBeenCalled();
  });

  it("no API key logs", async () => {
    expect(await sendEmail(db, msg(), { resend: fake() })).toBe("logged");
    const [row] = await db.select().from(emailLog);
    expect(row.status).toBe("logged");
    expect(row.subject).toBe("Hi");
  });

  it("cap per address: the 6th in 24h is capped", async () => {
    const out: string[] = [];
    for (let i = 0; i < 6; i++) out.push(await sendEmail(db, msg()));
    expect(out).toEqual(["logged", "logged", "logged", "logged", "logged", "capped"]);
  });

  it("cap per ip hash", async () => {
    const out: string[] = [];
    for (let i = 0; i < 11; i++) out.push(await sendEmail(db, msg({ to: `p${i}@gmail.test`, ipHash: "h" })));
    expect(out.slice(0, 10).every((s) => s === "logged")).toBe(true);
    expect(out[10]).toBe("capped");
  });

  it("sends via resend when configured", async () => {
    process.env.RESEND_API_KEY = "k";
    const r = fake();
    const att = [{ filename: "a.ics", content: "BEGIN" }];
    expect(await sendEmail(db, msg({ attachments: att }), { resend: r })).toBe("sent");
    expect(r.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r.send.mock.calls[0][0])).toContain("a.ics");
    const rows = await db.select().from(emailLog).where(eq(emailLog.status, "sent"));
    expect(rows).toHaveLength(1);
  });

  it("resend throwing gives failed", async () => {
    process.env.RESEND_API_KEY = "k";
    const r = { send: vi.fn(async () => { throw new Error("boom"); }) };
    expect(await sendEmail(db, msg(), { resend: r })).toBe("failed");
    const [row] = await db.select().from(emailLog);
    expect(row.status).toBe("failed");
  });
});
