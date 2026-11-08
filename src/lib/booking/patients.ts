import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { patients } from "@/lib/db/schema";
import type { Locale } from "@/i18n/routing";

/** E.164 for Turkish (+90, 0, bare 5xx) input; other `+` numbers keep their digits; junk is null. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) {
    if (digits.startsWith("90")) return digits.length === 12 ? `+${digits}` : null;
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 12 && digits.startsWith("90")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+90${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("5")) return `+90${digits}`;
  return null;
}

export async function upsertPatient(
  tx: DbOrTx,
  p: { name: string; phone: string; email?: string | null; locale: Locale },
): Promise<string> {
  const phoneE164 = normalizePhone(p.phone);
  if (!phoneE164) throw new Error("invalid phone");
  const [row] = await tx
    .insert(patients)
    .values({ name: p.name.trim(), phoneE164, email: p.email ?? null, locale: p.locale })
    .onConflictDoUpdate({
      target: patients.phoneE164,
      // A staff booking without an email keeps the one already on file.
      set: {
        name: sql`excluded.name`,
        email: sql`coalesce(excluded.email, ${patients.email})`,
        locale: sql`excluded.locale`,
      },
    })
    .returning({ id: patients.id });
  return row.id;
}
