/**
 * Demo-mode masking of other visitors' contact details. Staff views in the public demo show who
 * booked, but not a phone number or email someone else typed. Applied in the data layer, so the
 * raw values never reach the page payload. Language-neutral: only digits and dots are shown.
 */

const DOT = "•";

/** "+905321112233" → "+90 5•• ••• •• 33"; other numbers keep their first and last two digits. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const last = digits.slice(-2);
  if (digits.startsWith("90") && digits.length === 12) return `+90 ${digits[2]}${DOT.repeat(2)} ${DOT.repeat(3)} ${DOT.repeat(2)} ${last}`;
  if (digits.length < 6) return `+${DOT.repeat(4)}`;
  return `+${digits.slice(0, 2)} ${DOT.repeat(3)} ${DOT.repeat(3)} ${last}`;
}

/** "ayla@example.com" → "a•••@example.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return DOT.repeat(3);
  return `${email[0]}${DOT.repeat(3)}${email.slice(at)}`;
}
