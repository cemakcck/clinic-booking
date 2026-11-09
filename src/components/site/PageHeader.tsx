/** Interior page intro: kicker, h1 and lead on a soft band with a faint leaf watermark. */
export default function PageHeader({
  kicker,
  title,
  lead,
  children,
}: {
  kicker: string;
  title: string;
  lead?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden border-b border-line bg-soft">
      <svg aria-hidden="true" viewBox="-30 -40 60 44" className="absolute -right-10 -bottom-16 w-72 rotate-[24deg] text-accent/40 sm:w-96">
        <path fill="currentColor" d="M0 0C-15-5-24-21-14-32-7-39 0-35 0-28 0-35 7-39 14-32 24-21 15-5 0 0Z" />
      </svg>
      <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-sm font-semibold text-brand">{kicker}</p>
        <h1 className="mt-3 max-w-3xl text-4xl leading-[1.1] font-bold tracking-tight text-balance text-ink sm:text-5xl">
          {title}
        </h1>
        {lead && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-mute">{lead}</p>}
        {children}
      </div>
    </div>
  );
}
