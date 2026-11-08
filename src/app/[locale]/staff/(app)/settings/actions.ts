"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { BookingError, type BookingErrorCode } from "@/lib/booking/errors";
import {
  addClosedDate,
  removeClosedDate,
  saveClinicHours,
  saveDentist,
  saveTreatment,
  type FieldErrors,
} from "@/lib/staff/settings";

export type SettingsResult = { ok: true; id?: number } | { ok: false; code: BookingErrorCode; fields?: FieldErrors };

/** Public pages cache for 5 minutes; a save must show up at once, in both locales. */
function refreshPublic() {
  revalidatePath("/", "layout");
}

/**
 * Every action authenticates and checks `settings.edit` itself (the domain function checks again,
 * plus the demo guard), then maps domain errors to a result the forms can render.
 */
async function run(fn: (d: Awaited<ReturnType<typeof db>>, actor: Awaited<ReturnType<typeof requireActor>>) => Promise<number | void>): Promise<SettingsResult> {
  const actor = await requireActor();
  if (!can(actor, "settings.edit")) return { ok: false, code: "forbidden" };
  try {
    const id = await fn(await db(), actor);
    refreshPublic();
    return typeof id === "number" ? { ok: true, id } : { ok: true };
  } catch (e) {
    if (e instanceof BookingError) {
      const fields = (e.details as { fields?: FieldErrors } | undefined)?.fields;
      return { ok: false, code: e.code, fields };
    }
    throw e;
  }
}

export async function saveDentistAction(input: unknown) {
  return run((d, a) => saveDentist(d, a, input as Parameters<typeof saveDentist>[2]));
}
export async function saveTreatmentAction(input: unknown) {
  return run((d, a) => saveTreatment(d, a, input as Parameters<typeof saveTreatment>[2]));
}
export async function saveClinicHoursAction(input: unknown) {
  return run((d, a) => saveClinicHours(d, a, input as Parameters<typeof saveClinicHours>[2]));
}
export async function addClosedDateAction(input: unknown) {
  return run((d, a) => addClosedDate(d, a, input as Parameters<typeof addClosedDate>[2]));
}
export async function removeClosedDateAction(date: string) {
  return run((d, a) => removeClosedDate(d, a, String(date)));
}
