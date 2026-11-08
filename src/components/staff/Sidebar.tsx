"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { LogoMark } from "@/components/site/Logo";
import { signOut } from "@/app/[locale]/staff/login/actions";

export type SidebarItem = { href: string; label: string };

/** Staff sidebar (mockup screen 3). Items arrive already filtered by `can`. */
export default function Sidebar({
  brand,
  navLabel,
  items,
  signedInAs,
  who,
  signOutLabel,
}: {
  brand: string;
  navLabel: string;
  items: SidebarItem[];
  signedInAs: string;
  who: string;
  signOutLabel: string;
}) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-4 border-b border-line bg-soft px-4 py-5 text-sm md:min-h-full md:border-r md:border-b-0">
      <Link href="/" className="flex items-center gap-2 px-2.5 text-brand">
        <LogoMark className="size-6" />
        <span className="text-[17px] font-bold tracking-tight">{brand}</span>
      </Link>
      <nav aria-label={navLabel}>
        <ul className="flex flex-wrap gap-0.5 md:block">
          {items.map((it) => {
            const on = pathname === it.href || pathname.startsWith(`${it.href}/`);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={on ? "page" : undefined}
                  className={`block rounded-card px-2.5 py-2 ${
                    on ? "bg-white font-semibold text-ink" : "text-mute hover:bg-white/70 hover:text-ink"
                  } focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand`}
                >
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-line px-2.5 pt-3.5 text-xs text-mute md:mt-4">
        <p data-testid="signed-in">
          {signedInAs}
          <br />
          <b className="text-[13px] text-ink">{who}</b>
        </p>
        <form action={signOut} className="mt-3">
          <button
            type="submit"
            className="cursor-pointer rounded-card border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
          >
            {signOutLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
