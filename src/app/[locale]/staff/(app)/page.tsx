import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/actor";
import { roleHome } from "@/lib/auth/redirects";

/** /{locale}/staff: send each role to its home (signed-out visitors go to the login). */
export default async function StaffIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await requireActor();
  redirect(roleHome(actor.role, locale));
}
