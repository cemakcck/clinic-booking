import { getTranslations } from "next-intl/server";

/** Shown next to a disabled Save in demo mode; the server refuses the same writes. */
export default async function DemoDisabledNote() {
  const t = await getTranslations("staff.settings");
  return (
    <p data-testid="demo-note" id="demo-note" className="rounded-card border border-line bg-soft px-3.5 py-2.5 text-sm text-ink">
      {t("demoNote")}
    </p>
  );
}
