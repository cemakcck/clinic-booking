import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import DemoBanner from "@/components/site/DemoBanner";
import Logo from "@/components/site/Logo";
import LoginForm from "@/components/staff/LoginForm";
import { getActor } from "@/lib/auth/actor";
import { roleHome } from "@/lib/auth/redirects";
import { isDemo } from "@/lib/demo/mode";
import { STAFF_USERS } from "@/lib/demo/staff-users";
import { clinic } from "@/config/clinic";
import { demoSignIn } from "./actions";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.login" });
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function StaffLoginPage({ params }: Props) {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  setRequestLocale(locale);
  const actor = await getActor();
  if (actor) redirect(roleHome(actor.role, locale));

  const t = await getTranslations("staff.login");
  const tr = await getTranslations("staff.roles");

  return (
    <div className="flex min-h-screen flex-col bg-soft">
      <DemoBanner role={null} />
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-md">
          <Logo name={clinic.shortName} />
          <div className="mt-6 rounded-[18px] border border-line bg-white p-6 sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight text-ink">{t("title")}</h1>
            <p className="mt-1 text-mute">{t("lead")}</p>
            <LoginForm />
          </div>

          {isDemo() && (
            <section aria-labelledby="demo-accounts" className="mt-6 rounded-[18px] bg-ink p-6 text-white">
              <h2 id="demo-accounts" className="text-base font-bold">{t("demoTitle")}</h2>
              <p className="mt-1 text-sm text-white/80">{t("demoBody")}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {STAFF_USERS.map((u) => (
                  <form key={u.role} action={demoSignIn.bind(null, u.role, undefined)}>
                    <button
                      type="submit"
                      className="inline-flex cursor-pointer items-center rounded-full border border-white/40 px-3.5 py-2 text-sm font-semibold hover:border-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      {t("demoAs", { role: tr(u.role) })}
                    </button>
                  </form>
                ))}
              </div>
            </section>
          )}

          <Link href="/" className="mt-6 inline-flex text-sm font-semibold text-brand underline-offset-4 hover:underline">
            <span aria-hidden="true">←&nbsp;</span>
            {t("backToSite")}
          </Link>
        </div>
      </main>
    </div>
  );
}
