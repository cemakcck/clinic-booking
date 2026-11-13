import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import tr from "../../../messages/tr.json";
import { clinic } from "@/config/clinic";
import { formatLongDate, formatSlotTime, isTomorrow } from "@/lib/time";
import type { Locale } from "@/i18n/routing";

export type EmailKind = "booking_confirmation" | "booking_rescheduled" | "booking_cancelled" | "appointment_reminder";

type Data = {
  patientName: string;
  treatmentName: string;
  dentistName: string;
  start: Date;
  manageUrl?: string;
  /** Reference clock for "tomorrow" in reminders; defaults to the current time. */
  now?: Date;
};

const messages = { en, tr };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const KEY = {
  booking_confirmation: "confirmation",
  booking_rescheduled: "rescheduled",
  booking_cancelled: "cancelled",
  appointment_reminder: "reminder",
} as const;

export function renderEmail(
  kind: EmailKind,
  locale: Locale,
  d: Data,
): { subject: string; html: string; text: string } {
  const t = createTranslator({ locale, messages: messages[locale], namespace: "email" });
  const k = KEY[kind];
  const when = `${formatLongDate(d.start, locale)}, ${formatSlotTime(d.start, locale)}`;
  const subjectRaw =
    kind === "appointment_reminder"
      ? isTomorrow(d.start, d.now ?? new Date())
        ? t("reminder.subjectTomorrow", { time: formatSlotTime(d.start, locale) })
        : t("reminder.subjectDate", {
            date: formatLongDate(d.start, locale),
            time: formatSlotTime(d.start, locale),
          })
      : t(`${KEY[kind]}.subject` as `${Exclude<(typeof KEY)[EmailKind], "reminder">}.subject`);
  const subject = subjectRaw.replace(/[\r\n]+/g, " ").trim();
  const greeting = t("greeting", { name: d.patientName });
  const intro = t(`${k}.intro`);
  const rows: [string, string][] = [
    [t("when"), when],
    [t("treatment"), d.treatmentName],
    [t("dentist"), d.dentistName],
    [t("where"), `${clinic.name}, ${clinic.address}`],
  ];
  // Reminders never carry a manage link: only the token hash is stored, so it cannot be rebuilt.
  const manage =
    d.manageUrl && kind !== "booking_cancelled" && kind !== "appointment_reminder" ? d.manageUrl : undefined;
  const note = kind === "appointment_reminder" ? t("reminder.manage", { phone: clinic.phoneDisplay }) : undefined;
  const footer = t("footer", { phone: clinic.phoneDisplay, email: clinic.email });

  const text = [
    greeting,
    "",
    intro,
    "",
    ...rows.map(([a, b]) => `${a}: ${b}`),
    ...(manage ? ["", `${t("manage")}: ${manage}`] : []),
    ...(note ? ["", note] : []),
    "",
    footer,
    clinic.name,
  ].join("\n");

  const html = `<!doctype html><html lang="${locale}"><body style="margin:0;background:#eef6f4;font-family:Arial,Helvetica,sans-serif;color:#10302e">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#ffffff;border:1px solid #d9e6e3;border-radius:14px;padding:24px">
<h1 style="font-size:20px;color:#0f5e5a;margin:0 0 16px">${esc(clinic.name)}</h1>
<p>${esc(greeting)}</p>
<p>${esc(intro)}</p>
<table style="border-collapse:collapse;width:100%">${rows
    .map(
      ([a, b]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#5d7472;vertical-align:top">${esc(a)}</td><td style="padding:6px 0"><strong>${esc(b)}</strong></td></tr>`,
    )
    .join("")}</table>
${manage ? `<p><a href="${esc(manage)}" style="display:inline-block;background:#0f5e5a;color:#ffffff;padding:10px 18px;border-radius:14px;text-decoration:none">${esc(t("manage"))}</a></p>` : ""}
${note ? `<p>${esc(note)}</p>` : ""}
<p style="color:#5d7472;font-size:13px">${esc(footer)}</p>
</div></div></body></html>`;

  return { subject, html, text };
}
