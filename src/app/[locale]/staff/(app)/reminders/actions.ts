"use server";

import { cookies, headers } from "next/headers";
import { db } from "@/lib/db/client";
import { requireActor } from "@/lib/auth/actor";
import { MINE_COOKIE, parseMine } from "@/lib/demo/mine";
import { sendRemindersNow, type SendNowResult } from "@/lib/reminders/send-now";
import { clientIp } from "@/lib/security/client-ip";
import { hashIp } from "@/lib/security/hash-ip";

export type SendNowActionResult =
  | { ok: true; considered: number; sent: number }
  | { ok: false; reason: Extract<SendNowResult, { ok: false }>["reason"] };

/**
 * "Send my reminders now" (demo only). The bookings come from the signed demo_mine cookie, never
 * from the client, so a visitor can only remind their own appointments. `locale` is accepted for
 * the plan's signature; reminder text always uses each patient's own language.
 */
export async function sendMyRemindersNow(locale: string): Promise<SendNowActionResult> {
  void locale;
  const actor = await requireActor();
  const r = await sendRemindersNow(await db(), actor, {
    mine: parseMine((await cookies()).get(MINE_COOKIE)?.value),
    ipHash: hashIp(clientIp(await headers())),
    now: new Date(),
  });
  if (!r.ok) return r;
  const { considered, sms, emails } = r.result;
  const sent = sms + Object.values(emails).reduce((n, x) => n + x, 0);
  return { ok: true, considered, sent };
}
