import { cache } from "react";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { db } from "@/lib/db/client";
import { getAuth } from "./auth";
import { isRole, type Actor } from "./roles";

export type { Actor, Role } from "./roles";

/** The signed-in staff member for this request, or null. Cached per request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  await db(); // make sure migrations ran before Better Auth touches its tables
  const session = await getAuth().api.getSession({ headers: await headers() });
  const u = session?.user;
  if (!u || !isRole(u.role)) return null;
  return { userId: u.id, name: u.name, role: u.role, dentistId: u.dentistId ?? null };
});

/** Like getActor, but sends signed-out visitors to /{locale}/staff/login. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) {
    const locale = await getLocale();
    return redirect({ href: "/staff/login", locale });
  }
  return actor;
}
