/** Shared button and field styles for the calendar (light, AA, brand focus ring). */
const base =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-card px-3.5 py-2 text-[13px] font-semibold leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-60";
export const btnPrimary = `${base} bg-brand text-white hover:bg-ink`;
export const btnGhost = `${base} border border-line bg-white text-ink hover:border-brand`;
export const btnDanger = `${base} bg-[#b3261e] text-white hover:bg-[#8c1d18]`;
export const btnQuietDanger = `${base} text-[#8a1c14] hover:bg-[#fdf3f2]`;

export const field =
  "mt-1 block w-full rounded-[10px] border border-[#7a908d] bg-white px-3 py-2 text-[14px] text-ink focus:border-brand focus:outline-2 focus:outline-offset-1 focus:outline-brand aria-[invalid=true]:border-[#b3261e]";
export const label = "block text-[13px] font-semibold text-ink";

export const STATUS_STYLE: Record<string, string> = {
  booked: "bg-[#e7eefc] border-booked",
  arrived: "bg-[#e3f5ea] border-arrived",
  no_show: "bg-[#fbe7e5] border-noshow",
  completed: "bg-[#eef1f0] border-[#7d8f8c]",
};
export const MINE_STYLE = "bg-[#fff4d6] border-mine ring-2 ring-mine";
export const BLOCK_STYLE =
  "border-[#8a8a85] text-[#3f3f3c] [background-image:repeating-linear-gradient(45deg,#f1f1ef_0_6px,#e4e4e0_6px_12px)]";
