import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { entries, patients } from "@/lib/db/schema";
import { closeTestDb, resetTables, seedFixture, T, testDb, NOW_ISO } from "./helpers/db";
import type { Fixture } from "./helpers/fixture";
import type { Actor } from "@/lib/auth/roles";
import { BookingError } from "@/lib/booking/errors";
import { getDayStrip } from "@/lib/booking/availability";
import { placeHold } from "@/lib/booking/holds";
import { createBlock, deleteBlock, updateBlock } from "@/lib/staff/blocks";

const db = testDb();
const now = new Date(NOW_ISO); // Tue 2026-11-10 08:00
const D = "2026-11-10";
const WED = "2026-11-11";
let fx: Fixture;

const prevDemo = process.env.DEMO_MODE;
beforeEach(async () => {
  delete process.env.DEMO_MODE;
  await resetTables(db);
  fx = await seedFixture(db);
});
afterAll(async () => {
  if (prevDemo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = prevDemo;
  await closeTestDb();
});

const reception: Actor = { userId: "u-rec", name: "Rec", role: "receptionist", dentistId: null };
const drAyd = (): Actor => ({ userId: "u-ayd", name: "Dr. Ayd", role: "dentist", dentistId: fx.dentists.ayd });

async function caught(p: Promise<unknown>): Promise<BookingError | string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof BookingError) return e;
    throw e;
  }
  return "no error";
}
const code = async (p: Promise<unknown>) => {
  const e = await caught(p);
  return typeof e === "string" ? e : e.code;
};

let phoneSeq = 0;
async function appt(dentistId: number, date: string, from: string, to: string, name = "Ayşe Yılmaz"): Promise<string> {
  const [p] = await db
    .insert(patients)
    .values({ name, phoneE164: `+90532111${String(++phoneSeq).padStart(4, "0")}`, locale: "tr" })
    .returning({ id: patients.id });
  const [r] = await db
    .insert(entries)
    .values({
      dentistId,
      kind: "appointment",
      during: { start: T(date, from), end: T(date, to) },
      treatmentId: fx.treatments.checkup,
      patientId: p.id,
      status: "booked",
      source: "online",
    })
    .returning({ id: entries.id });
  return r.id;
}

const blocks = () => db.select().from(entries).where(eq(entries.kind, "block"));

describe("createBlock", () => {
  it("dentist blocks own time", async () => {
    const r = await createBlock(db, drAyd(), {
      dentistId: fx.dentists.ayd,
      start: T(WED, "10:00"),
      end: T(WED, "11:00"),
      reason: "meeting",
      note: "Supplier",
      now,
    });
    expect(r.seriesId).toBeNull();
    expect(r.entryIds).toHaveLength(1);
    const [b] = await blocks();
    expect(b).toMatchObject({ dentistId: fx.dentists.ayd, blockReason: "meeting", blockNote: "Supplier", createdBy: "u-ayd" });
    expect(b.during).toEqual({ start: T(WED, "10:00"), end: T(WED, "11:00") });
  });

  it("dentist cannot block another dentist gives forbidden", async () => {
    expect(
      await code(
        createBlock(db, drAyd(), { dentistId: fx.dentists.kay, start: T(WED, "10:00"), end: T(WED, "11:00"), reason: "other", now }),
      ),
    ).toBe("forbidden");
    expect(await blocks()).toHaveLength(0);
  });

  it("rejects an empty or reversed range as invalid", async () => {
    const q = { dentistId: fx.dentists.ayd, reason: "other" as const, now };
    expect(await code(createBlock(db, reception, { ...q, start: T(WED, "11:00"), end: T(WED, "11:00") }))).toBe("invalid");
    expect(
      await code(createBlock(db, reception, { ...q, start: T(WED, "11:00"), end: T(WED, "12:00"), repeatWeekly: { count: 53 } })),
    ).toBe("invalid");
    expect(
      await code(createBlock(db, reception, { ...q, start: T(WED, "11:00"), end: T(WED, "12:00"), repeatWeekly: { until: "2027-12-01" } })),
    ).toBe("invalid");
  });

  it("block over an appointment gives block_conflict listing it, nothing inserted", async () => {
    const id = await appt(fx.dentists.ayd, WED, "10:30", "11:00", "Çağlar Öztürk");
    const e = await caught(
      createBlock(db, reception, { dentistId: fx.dentists.ayd, start: T(WED, "10:00"), end: T(WED, "12:00"), reason: "surgery", now }),
    );
    expect(e).toBeInstanceOf(BookingError);
    const err = e as BookingError;
    expect(err.code).toBe("block_conflict");
    expect(err.details).toEqual({
      conflicts: [
        {
          appointmentId: id,
          start: T(WED, "10:30").toISOString(),
          patientName: "Çağlar Öztürk",
          occurrenceStart: T(WED, "10:00").toISOString(),
        },
      ],
    });
    expect(await blocks()).toHaveLength(0);
  });

  it("an active hold or another block gives slot_taken; an expired hold is swept", async () => {
    await placeHold(db, { treatmentId: fx.treatments.checkup, dentistId: fx.dentists.ayd, start: T(D, "11:00"), now, ipHash: "ip-1" });
    const q = { dentistId: fx.dentists.ayd, start: T(D, "11:00"), end: T(D, "12:00"), reason: "other" as const };
    expect(await code(createBlock(db, reception, { ...q, now }))).toBe("slot_taken");
    await createBlock(db, reception, { ...q, now: new Date(now.getTime() + 6 * 60_000) });
    expect(await db.select().from(entries).where(eq(entries.kind, "hold"))).toHaveLength(0);
    expect(await code(createBlock(db, reception, { ...q, now }))).toBe("slot_taken");
  });

  it("weekly series of 4 inserts 4 entries sharing a seriesId", async () => {
    const r = await createBlock(db, drAyd(), {
      dentistId: fx.dentists.ayd,
      start: T(WED, "16:00"),
      end: T(WED, "17:00"),
      reason: "meeting",
      repeatWeekly: { count: 4 },
      now,
    });
    expect(r.seriesId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.entryIds).toHaveLength(4);
    const rows = (await blocks()).sort((a, b) => a.during.start.getTime() - b.during.start.getTime());
    expect(rows.map((b) => b.seriesId)).toEqual([r.seriesId, r.seriesId, r.seriesId, r.seriesId]);
    expect(rows.map((b) => b.during.start)).toEqual([
      T(WED, "16:00"),
      T("2026-11-18", "16:00"),
      T("2026-11-25", "16:00"),
      T("2026-12-02", "16:00"),
    ]);
  });

  it("weekly series until a date stops on that date", async () => {
    const r = await createBlock(db, reception, {
      dentistId: fx.dentists.kay,
      start: T(WED, "16:00"),
      end: T(WED, "17:00"),
      reason: "meeting",
      repeatWeekly: { until: "2026-11-25" },
      now,
    });
    expect(r.entryIds).toHaveLength(3);
  });

  it("series where week 3 conflicts inserts none and lists that occurrence", async () => {
    const id = await appt(fx.dentists.ayd, "2026-11-25", "16:30", "17:00");
    const e = (await caught(
      createBlock(db, drAyd(), {
        dentistId: fx.dentists.ayd,
        start: T(WED, "16:00"),
        end: T(WED, "17:00"),
        reason: "meeting",
        repeatWeekly: { count: 4 },
        now,
      }),
    )) as BookingError;
    expect(e.code).toBe("block_conflict");
    expect((e.details as { conflicts: unknown[] }).conflicts).toEqual([
      expect.objectContaining({ appointmentId: id, occurrenceStart: T("2026-11-25", "16:00").toISOString() }),
    ]);
    expect(await blocks()).toHaveLength(0);
  });

  it("block vs booking race: exactly one wins", async () => {
    for (let round = 0; round < 8; round++) {
      await resetTables(db);
      fx = await seedFixture(db);
      const results = await Promise.allSettled([
        createBlock(db, reception, { dentistId: fx.dentists.ayd, start: T(D, "11:00"), end: T(D, "12:00"), reason: "other", now }),
        placeHold(db, { treatmentId: fx.treatments.checkup, dentistId: fx.dentists.ayd, start: T(D, "11:00"), now, ipHash: `ip-r-${round}` }),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const bad = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect({ round, ok: ok.length }).toEqual({ round, ok: 1 });
      expect((bad[0].reason as BookingError).code).toBe("slot_taken");
      expect(await db.select().from(entries).where(eq(entries.active, true))).toHaveLength(1);
    }
  });

  it("multi-day leave block (Thu 00:00–Sat 00:00) removes those days from the strip", async () => {
    const strip = () =>
      getDayStrip(db, { treatmentId: fx.treatments.checkup, dentistId: fx.dentists.ayd, from: WED, days: 4, now, audience: "public" });
    expect((await strip()).map((d) => d.available)).toEqual([true, true, true, true]);
    await createBlock(db, drAyd(), {
      dentistId: fx.dentists.ayd,
      start: T("2026-11-12", "00:00"),
      end: T("2026-11-14", "00:00"),
      reason: "leave",
      now,
    });
    expect(await strip()).toEqual([
      { date: WED, available: true },
      { date: "2026-11-12", available: false },
      { date: "2026-11-13", available: false },
      { date: "2026-11-14", available: true },
    ]);
  });

  it("in demo, a block that drains today below the floor gives capacity_floor", async () => {
    // Leave Ayd and Kay with only 17:00-18:00 today: Ayd 3 starts + Kay 3 starts = 6.
    await createBlock(db, reception, { dentistId: fx.dentists.ayd, start: T(D, "09:00"), end: T(D, "17:00"), reason: "other", now });
    await createBlock(db, reception, { dentistId: fx.dentists.kay, start: T(D, "09:00"), end: T(D, "17:00"), reason: "other", now });
    process.env.DEMO_MODE = "1";
    // 6 -> 3 is refused; 6 -> 4 is fine.
    expect(
      await code(createBlock(db, reception, { dentistId: fx.dentists.ayd, start: T(D, "17:00"), end: T(D, "18:00"), reason: "other", now })),
    ).toBe("capacity_floor");
    await createBlock(db, reception, { dentistId: fx.dentists.ayd, start: T(D, "17:00"), end: T(D, "17:30"), reason: "other", now });
  });
});

describe("updateBlock and deleteBlock", () => {
  it("updates only that occurrence, with the same conflict rule", async () => {
    const r = await createBlock(db, drAyd(), {
      dentistId: fx.dentists.ayd,
      start: T(WED, "16:00"),
      end: T(WED, "17:00"),
      reason: "meeting",
      repeatWeekly: { count: 2 },
      now,
    });
    const [first, second] = r.entryIds;
    await updateBlock(db, drAyd(), { entryId: first, start: T(WED, "09:00"), end: T(WED, "10:00"), reason: "personal", note: "Dentist", now });
    const rows = await blocks();
    const a = rows.find((b) => b.id === first)!;
    const b = rows.find((x) => x.id === second)!;
    expect(a).toMatchObject({ blockReason: "personal", blockNote: "Dentist" });
    expect(a.during.start).toEqual(T(WED, "09:00"));
    expect(b).toMatchObject({ blockReason: "meeting" });
    expect(b.during.start).toEqual(T("2026-11-18", "16:00"));

    await appt(fx.dentists.ayd, WED, "11:00", "11:30");
    expect(
      await code(updateBlock(db, drAyd(), { entryId: first, start: T(WED, "10:30"), end: T(WED, "11:30"), reason: "personal", now })),
    ).toBe("block_conflict");
    const otherDentist = { ...drAyd(), dentistId: fx.dentists.kay };
    expect(
      await code(updateBlock(db, otherDentist, { entryId: first, start: T(WED, "09:00"), end: T(WED, "09:30"), reason: "other", now })),
    ).toBe("forbidden");
  });

  it("delete whole series", async () => {
    const r = await createBlock(db, drAyd(), {
      dentistId: fx.dentists.ayd,
      start: T(WED, "16:00"),
      end: T(WED, "17:00"),
      reason: "meeting",
      repeatWeekly: { count: 3 },
      now,
    });
    const single = await createBlock(db, drAyd(), { dentistId: fx.dentists.ayd, start: T(WED, "09:00"), end: T(WED, "09:30"), reason: "other", now });

    await deleteBlock(db, drAyd(), { entryId: r.entryIds[1] });
    expect(await blocks()).toHaveLength(3);
    await deleteBlock(db, drAyd(), { entryId: r.entryIds[0], wholeSeries: true });
    const left = await blocks();
    expect(left.map((b) => b.id)).toEqual(single.entryIds);

    expect(await code(deleteBlock(db, { ...drAyd(), dentistId: fx.dentists.kay }, { entryId: single.entryIds[0] }))).toBe("forbidden");
    // Not a block: refused.
    const apptId = await appt(fx.dentists.ayd, WED, "11:00", "11:30");
    expect(await code(deleteBlock(db, reception, { entryId: apptId }))).toBe("not_found");
    expect(await db.select().from(entries).where(and(eq(entries.id, apptId)))).toHaveLength(1);
  });
});
