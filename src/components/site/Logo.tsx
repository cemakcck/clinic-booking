/** Tooth silhouette with a linden leaf: the Lindenya mark. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M9.6 4.5c-3.6 0-5.7 3.2-5 7.2.5 3.1 1.8 4.9 2.3 8.6.5 3.6 1.1 7.2 3.2 7.2 2 0 2.1-4.4 3.3-6.6.7-1.3 2.5-1.3 3.2 0 1.2 2.2 1.3 6.6 3.3 6.6 2.1 0 2.7-3.6 3.2-7.2.5-3.7 1.8-5.5 2.3-8.6.7-4-1.4-7.2-5-7.2-2.4 0-3.4 1.5-5.7 1.5S12 4.5 9.6 4.5Z"
      />
      <path fill="#7fd1c1" d="M20.5 1.6c3.9-.4 6.6 1.6 7.4 5.4-3.9.6-6.8-1.3-7.4-5.4Z" />
    </svg>
  );
}

export default function Logo({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2 text-brand">
      <LogoMark />
      <span className="text-xl font-bold tracking-tight">{name}</span>
    </span>
  );
}
