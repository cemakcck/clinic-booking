import { db } from "@/lib/db/client";
import { resetDemo } from "@/lib/demo/reset";
import { isDemo } from "@/lib/demo/mode";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  if (!isDemo()) return Response.json({ ok: false }, { status: 403 });
  await resetDemo(await db(), new Date());
  return Response.json({ ok: true });
}
