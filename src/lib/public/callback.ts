import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { callbackRequests, treatments } from "@/lib/db/schema";
import { BookingError } from "@/lib/booking/errors";
import { normalizePhone } from "@/lib/booking/patients";
import { checkAndRecordRate } from "@/lib/security/rate-limit";

export const callbackSchema = z.object({
  name: z.string().trim().min(2, "name").max(80, "name"),
  phone: z.string().trim().refine((v) => normalizePhone(v) !== null, "phone"),
  locale: z.enum(["en", "tr"]),
  treatmentSlug: z.string().trim().max(80).optional(),
  message: z.string().trim().max(1000, "message").optional(),
  website: z.string().max(0).optional(),
});

export type CallbackResult = { ok: true } | { ok: false; fieldErrors: Record<string, string> };

export async function createCallbackRequest(
  db: Db,
  input: unknown,
  ctx: { ipHash: string; now: Date },
): Promise<CallbackResult> {
  const raw = (input ?? {}) as Record<string, unknown>;
  // A filled honeypot looks like success to the bot but stores nothing (and costs no rate budget).
  if (typeof raw.website === "string" && raw.website.length > 0) return { ok: true };

  const parsed = callbackSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message === "Invalid input" || issue.message.startsWith("Invalid") ? "invalid" : issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const v = parsed.data;

  try {
    await checkAndRecordRate(db, "callback", ctx.ipHash, ctx.now);
  } catch (e) {
    if (e instanceof BookingError && e.code === "rate_limited") return { ok: false, fieldErrors: { form: "rate_limited" } };
    throw e;
  }

  let treatmentId: number | null = null;
  if (v.treatmentSlug) {
    const [t] = await db.select({ id: treatments.id }).from(treatments).where(eq(treatments.slug, v.treatmentSlug)).limit(1);
    treatmentId = t?.id ?? null;
  }
  await db.insert(callbackRequests).values({
    name: v.name,
    phoneE164: normalizePhone(v.phone)!,
    locale: v.locale,
    treatmentId,
    message: v.message || null,
    ipHash: ctx.ipHash,
    createdAt: ctx.now,
  });
  return { ok: true };
}
