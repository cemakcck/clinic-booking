/** A locale-less /book link; next-intl's Link adds the locale. */
export const bookHref = (q: { treatment?: string | null; dentist?: string | null; date?: string | null }) => {
  const p = new URLSearchParams();
  if (q.treatment) p.set("treatment", q.treatment);
  if (q.dentist) p.set("dentist", q.dentist);
  if (q.date) p.set("date", q.date);
  const s = p.toString();
  return s ? `/book?${s}` : "/book";
};
