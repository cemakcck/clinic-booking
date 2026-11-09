import { toNextJsHandler } from "better-auth/next-js";
import { db } from "@/lib/db/client";
import { getAuth } from "@/lib/auth/auth";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  await db(); // migrations first
  const h = toNextJsHandler(getAuth());
  return request.method === "POST" ? h.POST(request) : h.GET(request);
}

export { handle as GET, handle as POST };
