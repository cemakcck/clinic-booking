"use server";

import { z } from "zod";
import { db } from "@/lib/db/client";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { BookingError, type BookingErrorCode } from "@/lib/booking/errors";
import { setRequestStatus } from "@/lib/staff/requests";

export type RequestActionResult = { ok: true } | { ok: false; code: BookingErrorCode };

const Input = z.object({ id: z.uuid(), status: z.enum(["new", "contacted", "closed"]) });

/** Authenticates and checks `requests.view` itself; the domain function checks again. */
export async function setRequestStatusAction(id: string, status: string): Promise<RequestActionResult> {
  const actor = await requireActor();
  if (!can(actor, "requests.view")) return { ok: false, code: "forbidden" };
  const parsed = Input.safeParse({ id, status });
  if (!parsed.success) return { ok: false, code: "invalid" };
  try {
    await setRequestStatus(await db(), actor, parsed.data.id, parsed.data.status);
    return { ok: true };
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, code: e.code };
    throw e;
  }
}
