import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import DemoBanner from "@/components/site/DemoBanner";
import Sidebar, { type SidebarItem } from "@/components/staff/Sidebar";
import { requireActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { clinic } from "@/config/clinic";
import { db } from "@/lib/db/client";
import { countNewRequests } from "@/lib/staff/requests";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function StaffLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await requireActor();
  const t = await getTranslations("staff");

  const newRequests = await countNewRequests(await db(), actor);

  const items: (SidebarItem & { show: boolean })[] = [
    { href: "/staff/today", label: t("nav.today"), show: actor.role === "dentist" },
    { href: "/staff/calendar", label: t("nav.calendar"), show: can(actor, "calendar.viewAll") },
    { href: "/staff/requests", label: t("nav.requests"), show: can(actor, "requests.view"), badge: newRequests },
    { href: "/staff/patients", label: t("nav.patients"), show: can(actor, "patients.view") },
    { href: "/staff/settings", label: t("nav.settings"), show: can(actor, "settings.view") },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-card bg-brand px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t("skip")}
      </a>
      <DemoBanner role={actor.role} />
      <div className="grid flex-1 md:grid-cols-[210px_1fr]">
        <Sidebar
          brand={clinic.shortName}
          navLabel={t("nav.label")}
          items={items.filter((i) => i.show).map(({ href, label, badge }) => ({ href, label, badge }))}
          signedInAs={t("signedInAs")}
          who={`${actor.name} (${t(`roles.${actor.role}`)})`}
          signOutLabel={t("signOut")}
        />
        <main id="main" tabIndex={-1} className="min-w-0 px-4 py-5 outline-none sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
