import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { DentistSummary } from "@/lib/public/queries";
import Avatar from "./Avatar";

export default async function DentistCard({
  dentist,
  index,
  variant = "full",
}: {
  dentist: DentistSummary;
  index: number;
  variant?: "full" | "compact";
}) {
  const t = await getTranslations("public.dentists");

  if (variant === "compact") {
    return (
      <article data-testid="dentist-card" className="flex items-center gap-4 rounded-card border border-line bg-white p-4">
        <Avatar name={dentist.name} index={index} />
        <div className="min-w-0">
          <h3 className="font-bold text-ink">{dentist.name}</h3>
          <p className="text-sm leading-snug text-mute">{dentist.title}</p>
        </div>
      </article>
    );
  }

  return (
    <article data-testid="dentist-card" className="flex flex-col rounded-card border border-line bg-white p-6">
      <div className="flex items-center gap-4">
        <Avatar name={dentist.name} index={index} size="lg" />
        <div>
          <h2 className="text-xl font-bold text-ink">{dentist.name}</h2>
          <p className="text-sm font-medium text-brand">{dentist.title}</p>
        </div>
      </div>
      <p className="mt-5 leading-relaxed text-mute">{dentist.bio}</p>
      <h3 className="mt-5 text-xs font-bold tracking-[0.12em] text-mute uppercase">{t("performs")}</h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {dentist.treatments.map((tr) => (
          <li key={tr.slug}>
            <Link
              href={`/treatments/${tr.slug}`}
              className="inline-flex rounded-full bg-soft px-3 py-1 text-[13px] font-medium text-ink hover:bg-line"
            >
              {tr.name}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-6">
        <Link
          href={`/book?dentist=${dentist.slug}`}
          className="inline-flex items-center rounded-card border-[1.5px] border-brand px-4 py-2.5 text-sm font-semibold text-brand hover:bg-soft"
        >
          {t("bookWith", { name: dentist.name })}
        </Link>
      </div>
    </article>
  );
}
