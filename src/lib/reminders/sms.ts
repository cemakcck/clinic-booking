import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import tr from "../../../messages/tr.json";
import { clinic } from "@/config/clinic";
import { formatShortDate, formatSlotTime, isTomorrow } from "@/lib/time";
import type { Locale } from "@/i18n/routing";

const messages = { en, tr };

/** The one-line reminder SMS (simulated; stored as the text that would have been sent). */
export function smsText(locale: Locale, a: { dentistName: string; start: Date }, now: Date): string {
  const t = createTranslator({ locale, messages: messages[locale], namespace: "sms" });
  const base = {
    clinic: clinic.shortName,
    dentist: a.dentistName,
    time: formatSlotTime(a.start, locale),
    phone: clinic.phoneDisplay,
  };
  return isTomorrow(a.start, now)
    ? t("reminderTomorrow", base)
    : t("reminderDate", { ...base, date: formatShortDate(a.start, locale) });
}
