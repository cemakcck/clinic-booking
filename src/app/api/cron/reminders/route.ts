import { db } from "@/lib/db/client";
import { runReminders } from "@/lib/reminders/run";

export const dynamic = "force-dynamic";
/** Seconds a pass may run on Vercel before it is cut off; matches the workflow's curl timeout. */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const result = await runReminders(await db(), new Date());
  return Response.json({ ok: true, ...result });
}
