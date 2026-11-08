const TOOTH =
  "M9.6 4.5c-3.6 0-5.7 3.2-5 7.2.5 3.1 1.8 4.9 2.3 8.6.5 3.6 1.1 7.2 3.2 7.2 2 0 2.1-4.4 3.3-6.6.7-1.3 2.5-1.3 3.2 0 1.2 2.2 1.3 6.6 3.3 6.6 2.1 0 2.7-3.6 3.2-7.2.5-3.7 1.8-5.5 2.3-8.6.7-4-1.4-7.2-5-7.2-2.4 0-3.4 1.5-5.7 1.5S12 4.5 9.6 4.5Z";
const LEAF = "M0 0C-15-5-24-21-14-32-7-39 0-35 0-28 0-35 7-39 14-32 24-21 15-5 0 0Z";
const SPARK = "M0-10C1-3 3-1 10 0 3 1 1 3 0 10-1 3-3 1-10 0-3-1-1-3 0-10Z";

/** Abstract hero illustration: a calm tooth, a linden sprig, soft mint light. Inline, no external assets. */
export default function HeroArt({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 520 440" role="img" aria-label={label} className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="ha-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4faf8" />
          <stop offset="1" stopColor="#dcece8" />
        </linearGradient>
        <radialGradient id="ha-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#7fd1c1" stopOpacity="0.85" />
          <stop offset="1" stopColor="#7fd1c1" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ha-tooth" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e6f3f0" />
        </linearGradient>
        <pattern id="ha-dots" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.6" fill="#bcd8d2" />
        </pattern>
      </defs>

      <rect width="520" height="440" fill="url(#ha-bg)" />
      <circle cx="400" cy="110" r="190" fill="url(#ha-glow)" />
      <rect x="34" y="34" width="128" height="96" fill="url(#ha-dots)" opacity="0.8" />

      {/* soft halo behind the tooth */}
      <circle cx="268" cy="214" r="132" fill="#ffffff" opacity="0.55" />
      <circle cx="268" cy="214" r="132" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="2 9" strokeLinecap="round" />

      {/* gentle shore lines */}
      <path d="M0 370c70-22 130-22 196 0s130 22 196 0 100-20 128-14V440H0Z" fill="#cfe7e1" opacity="0.7" />
      <path d="M0 396c80-18 150-16 220 2s140 16 210-2c40-10 70-10 90-6V440H0Z" fill="#b9ddd5" opacity="0.6" />

      {/* tooth */}
      <ellipse cx="268" cy="326" rx="78" ry="10" fill="#0f5e5a" opacity="0.1" />
      <g transform="translate(140 84) scale(8)">
        <path d={TOOTH} fill="url(#ha-tooth)" stroke="#bfe0d9" strokeWidth="0.28" strokeLinejoin="round" />
        <path d="M8.2 8.2c.6-1.4 1.8-2.1 3.1-2" fill="none" stroke="#ffffff" strokeWidth="0.9" strokeLinecap="round" />
        <path d="M12.6 14.2c1.9 1.6 4.9 1.6 6.8 0" fill="none" stroke="#1f8a7f" strokeWidth="0.55" strokeLinecap="round" opacity="0.55" />
      </g>

      {/* linden sprig */}
      <g>
        <path d="M402 360c-10-50-4-98 30-150" fill="none" stroke="#0f5e5a" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
        <g transform="translate(424 230) rotate(32) scale(1.5)">
          <path d={LEAF} fill="#1f8a7f" />
          <path d="M0-2V-28" stroke="#eef6f4" strokeWidth="1" opacity="0.6" />
        </g>
        <g transform="translate(404 292) rotate(-58) scale(1.25)">
          <path d={LEAF} fill="#7fd1c1" />
          <path d="M0-2V-28" stroke="#ffffff" strokeWidth="1" opacity="0.7" />
        </g>
        <g transform="translate(406 334) rotate(48) scale(1.05)">
          <path d={LEAF} fill="#0f5e5a" opacity="0.85" />
          <path d="M0-2V-28" stroke="#eef6f4" strokeWidth="1" opacity="0.5" />
        </g>
      </g>

      {/* sparkles */}
      <path d={SPARK} transform="translate(152 150) scale(1.4)" fill="#1f8a7f" opacity="0.8" />
      <path d={SPARK} transform="translate(372 150) scale(0.9)" fill="#0f5e5a" opacity="0.55" />
      <path d={SPARK} transform="translate(176 236) scale(0.7)" fill="#7fd1c1" />
      <circle cx="356" cy="104" r="4" fill="#ffffff" />
      <circle cx="120" cy="292" r="3" fill="#1f8a7f" opacity="0.4" />
    </svg>
  );
}
