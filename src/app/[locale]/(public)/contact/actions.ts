"use server";

import { headers } from "next/headers";
import { db } from "@/lib/db/client";
import { createCallbackRequest } from "@/lib/public/callback";
import { clientIp } from "@/lib/security/client-ip";
import { hashIp } from "@/lib/security/hash-ip";

export type CallbackState = { status: "idle" } | { status: "success" } | { status: "error"; fieldErrors: Record<string, string> };

export async function submitCallback(_prev: CallbackState, formData: FormData): Promise<CallbackState> {
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };
  const input = {
    name: str("name"),
    phone: str("phone"),
    locale: str("locale"),
    treatmentSlug: str("treatmentSlug") || undefined,
    message: str("message") || undefined,
    website: str("website"),
  };
  const ipHash = hashIp(clientIp(await headers()));
  const r = await createCallbackRequest(await db(), input, { ipHash, now: new Date() });
  return r.ok ? { status: "success" } : { status: "error", fieldErrors: r.fieldErrors };
}
