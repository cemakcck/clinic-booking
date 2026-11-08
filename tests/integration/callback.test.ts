import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callbackRequests } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import { createCallbackRequest } from "@/lib/public/callback";

const db = testDb();
const now = new Date(NOW_ISO);
let fx: Fixture;

beforeEach(async () => {
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(closeTestDb);

const valid = { name: "Ayşe Yılmaz", phone: "0532 111 2233", locale: "en", treatmentSlug: "whitening", message: "Hi", website: "" };

describe("createCallbackRequest", () => {
  it("stores a request with normalized phone and status new", async () => {
    const r = await createCallbackRequest(db, valid, { ipHash: "ip-1", now });
    expect(r).toEqual({ ok: true });
    const rows = await db.select().from(callbackRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Ayşe Yılmaz",
      phoneE164: "+905321112233",
      status: "new",
      locale: "en",
      ipHash: "ip-1",
      treatmentId: fx.treatments.whitening,
    });
  });

  it("honeypot stores nothing but reports ok", async () => {
    const r = await createCallbackRequest(db, { ...valid, website: "http://spam" }, { ipHash: "ip-1", now });
    expect(r).toEqual({ ok: true });
    expect(await db.select().from(callbackRequests)).toHaveLength(0);
  });

  it("invalid phone gives a field error", async () => {
    const r = await createCallbackRequest(db, { ...valid, phone: "12" }, { ipHash: "ip-1", now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.phone).toBe("phone");
    expect(await db.select().from(callbackRequests)).toHaveLength(0);
  });

  it("6th request in an hour is rate limited", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await createCallbackRequest(db, valid, { ipHash: "ip-rl", now })).toEqual({ ok: true });
    }
    const r = await createCallbackRequest(db, valid, { ipHash: "ip-rl", now });
    expect(r).toEqual({ ok: false, fieldErrors: { form: "rate_limited" } });
    expect(await db.select().from(callbackRequests)).toHaveLength(5);
  });
});
