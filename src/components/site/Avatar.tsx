const TONES = [
  "bg-accent text-ink",
  "bg-brand text-white",
  "bg-[#cfeee7] text-brand",
  "bg-ink text-accent",
] as const;

export function initials(name: string): string {
  return name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toLocaleUpperCase("tr-TR"))
    .slice(0, 2)
    .join("");
}

/** Initials on a mint/teal circle. Decorative: the name is always shown next to it. */
export default function Avatar({ name, index = 0, size = "md" }: { name: string; index?: number; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "size-10 text-sm", md: "size-14 text-lg", lg: "size-20 text-2xl" }[size];
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-wide ${dims} ${TONES[index % TONES.length]}`}
    >
      {initials(name)}
      <span className="absolute -right-0.5 -bottom-0.5 size-[30%] rounded-full border-2 border-white bg-accent/90" />
    </span>
  );
}
