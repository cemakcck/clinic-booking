import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { Resend } from "resend";
import type { DbOrTx } from "@/lib/db/client";
import { emailLog } from "@/lib/db/schema";
import { EMAIL_CAP_PER_ADDRESS_PER_DAY, EMAIL_CAP_PER_IP_PER_DAY } from "@/config/booking";
import { clinic } from "@/config/clinic";
import { isDemo } from "@/lib/demo/mode";
import type { Locale } from "@/i18n/routing";
import type { EmailKind } from "./templates";

export type EmailStatus = "sent" | "logged" | "suppressed" | "capped" | "failed";

export type EmailMessage = {
  kind: EmailKind;
  to: string | null;
  locale: Locale;
  subject: string;
  html: string;
  text: string;
  trigger: "patient" | "staff";
  ipHash?: string;
  appointmentId?: string;
  attachments?: { filename: string; content: string }[];
  now: Date;
};

export type EmailDeps = { resend?: { send(args: unknown): Promise<unknown> } };

const DAY_MS = 86_400_000;

/** Addresses are logged and capped case-insensitively: "A@x.com" and "a@x.com" are one inbox. */
const normalizeAddress = (to: string | null) => (to ?? "").trim().toLowerCase();

function isSuppressed(to: string | null): boolean {
  if (!to) return true;
  const a = to.trim().toLowerCase();
  return a === "" || a.endsWith("@example.com") || a.endsWith(".example");
}

async function decide(db: DbOrTx, m: EmailMessage, deps: EmailDeps): Promise<EmailStatus> {
  if (isSuppressed(m.to)) return "suppressed";
  if (isDemo() && m.trigger === "staff") return "logged";

  const since = new Date(m.now.getTime() - DAY_MS);
  const counted = inArray(emailLog.status, ["sent", "logged"]);
  const [addr] = await db
    .select({ n: count() })
    .from(emailLog)
    // lower() also catches rows logged before addresses were normalised.
    .where(and(eq(sql`lower(${emailLog.toAddress})`, normalizeAddress(m.to)), counted, gte(emailLog.createdAt, since)));
  if (addr.n >= EMAIL_CAP_PER_ADDRESS_PER_DAY) return "capped";
  if (m.ipHash) {
    const [ip] = await db
      .select({ n: count() })
      .from(emailLog)
      .where(and(eq(emailLog.ipHash, m.ipHash), counted, gte(emailLog.createdAt, since)));
    if (ip.n >= EMAIL_CAP_PER_IP_PER_DAY) return "capped";
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email] logged (no RESEND_API_KEY): ${m.kind} -> ${m.to} "${m.subject}"`);
    return "logged";
  }
  try {
    const client = deps.resend ?? (new Resend(key).emails as { send(args: unknown): Promise<unknown> });
    const res = (await client.send({
      from: process.env.EMAIL_FROM ?? `${clinic.name} <${clinic.email}>`,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      attachments: m.attachments,
    })) as { error?: unknown } | undefined;
    if (res && typeof res === "object" && res.error) throw new Error("resend error");
    return "sent";
  } catch (e) {
    console.error(`[email] send failed: ${e instanceof Error ? e.message : "unknown"}`);
    return "failed";
  }
}

/** Never throws; always records exactly one email_log row with the final status. */
export async function sendEmail(
  db: DbOrTx,
  m: EmailMessage,
  deps: EmailDeps = {},
): Promise<EmailStatus> {
  let status: EmailStatus;
  try {
    status = await decide(db, m, deps);
  } catch (e) {
    console.error(`[email] error: ${e instanceof Error ? e.message : "unknown"}`);
    status = "failed";
  }
  try {
    await db.insert(emailLog).values({
      kind: m.kind,
      toAddress: normalizeAddress(m.to),
      locale: m.locale,
      subject: m.subject.replace(/[\r\n]+/g, " "),
      status,
      trigger: m.trigger,
      ipHash: m.ipHash ?? null,
      appointmentId: m.appointmentId ?? null,
      createdAt: m.now,
    });
  } catch (e) {
    console.error(`[email] log insert failed: ${e instanceof Error ? e.message : "unknown"}`);
  }
  return status;
}
