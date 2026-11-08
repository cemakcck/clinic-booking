import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { isDemo } from "@/lib/demo/mode";

export type DemoRole = "patient" | "receptionist" | "dentist" | "admin" | null;

const pill = "inline-flex items-center rounded-full border px-3 py-1.5 leading-none transition-colors";

/** Dark strip above everything, only in demo mode. Staff pills become sign-in forms in Task 12. */
export default async function DemoBanner({ role }: { role: DemoRole }) {
  if (!isDemo()) return null;
  const t = await getTranslations("public.demo");
  const staff = [
    { key: "receptionist", label: t("receptionist") },
    { key: "dentist", label: t("dentist") },
  ] as const;

  return (
    <aside aria-label={t("region")} className="bg-ink text-[13px] font-medium text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
          {t("label")}
        </span>
        <span aria-hidden="true" className="hidden text-white/50 sm:inline">
          ·
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <span>{t("tryAs")}</span>
          <Link
            href="/"
            aria-current={role === "patient" ? "true" : undefined}
            className={`${pill} ${
              role === "patient"
                ? "border-white bg-white font-bold text-ink"
                : "border-white/40 hover:border-white hover:bg-white/10"
            } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
          >
            {t("patient")}
          </Link>
          {staff.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled
              aria-disabled="true"
              title={t("soon")}
              className={`${pill} cursor-not-allowed border-white/25 text-white/60`}
            >
              {s.label}
            </button>
          ))}
        </span>
        <span className="text-white/75 sm:ml-auto">{t("resets")}</span>
      </div>
    </aside>
  );
}
