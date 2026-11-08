import { db } from "@/lib/db/client";
import { appointmentIcs, loadAppointment, manageUrl } from "@/lib/booking/notify";
import { hashToken } from "@/lib/security/tokens";

/** The appointment as an .ics file, found by its manage token. Unknown tokens are a 404. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!token || token.length < 20 || token.length > 200) return notFound();
  const appt = await loadAppointment(await db(), { manageTokenHash: hashToken(token) });
  if (!appt || appt.status === "cancelled") return notFound();
  const body = appointmentIcs(appt, appt.locale, new Date(), manageUrl(appt.locale, token));
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="appointment.ics"',
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
