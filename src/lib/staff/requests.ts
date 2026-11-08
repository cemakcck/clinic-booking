import { count, desc, eq, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { callbackRequests, treatments } from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/roles";
import { BookingError } from "@/lib/booking/errors";

export type RequestStatus = "new" | "contacted" | "closed";
export type RequestFilter = RequestStatus | "all";
export const REQUEST_STATUSES: readonly RequestStatus[] = ["new", "contacted", "closed"];
export const REQUEST_LIMIT = 50;

export type RequestRow = {
  id: string;
  name: string;
  phone: string;
  locale: string;
  message: string | null;
  status: RequestStatus;
  createdAt: Date;
  treatmentEn: string | null;
  treatmentTr: string | null;
};

function guard(actor: Actor) {
  if (!can(actor, "requests.view")) throw new BookingError("forbidden");
}

/** Call-back requests, newest first (at most REQUEST_LIMIT). Receptionist and admin only. */
export async function listRequests(db: DbOrTx, actor: Actor, filter: RequestFilter): Promise<RequestRow[]> {
  guard(actor);
  const where: SQL | undefined = filter === "all" ? undefined : eq(callbackRequests.status, filter);
  return db
    .select({
      id: callbackRequests.id,
      name: callbackRequests.name,
      phone: callbackRequests.phoneE164,
      locale: callbackRequests.locale,
      message: callbackRequests.message,
      status: callbackRequests.status,
      createdAt: callbackRequests.createdAt,
      treatmentEn: treatments.nameEn,
      treatmentTr: treatments.nameTr,
    })
    .from(callbackRequests)
    .leftJoin(treatments, eq(treatments.id, callbackRequests.treatmentId))
    .where(where)
    .orderBy(desc(callbackRequests.createdAt), desc(callbackRequests.id))
    .limit(REQUEST_LIMIT);
}

/** How many requests are still new; 0 (not an error) for roles that can't see requests. */
export async function countNewRequests(db: DbOrTx, actor: Actor): Promise<number> {
  if (!can(actor, "requests.view")) return 0;
  const [r] = await db.select({ n: count() }).from(callbackRequests).where(eq(callbackRequests.status, "new"));
  return r?.n ?? 0;
}

export async function setRequestStatus(db: DbOrTx, actor: Actor, id: string, status: RequestStatus): Promise<void> {
  guard(actor);
  const rows = await db
    .update(callbackRequests)
    .set({ status })
    .where(eq(callbackRequests.id, id))
    .returning({ id: callbackRequests.id });
  if (rows.length === 0) throw new BookingError("not_found");
}
