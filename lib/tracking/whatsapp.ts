/*
  The number a wa.me link needs: international format, digits only, no "+"
  or "00". UK numbers written nationally ("07700 900123") become 44... because
  the office types them that way. Anything with fewer than 10 digits, more
  than 15 (the E.164 maximum) or letters in it is refused, so the dialog
  disables WhatsApp rather than opening a chat with the wrong person.

  Pure; used by app/jobs/SendTrackingLinkDialog.tsx.
*/

const MIN_DIGITS = 10;
const MAX_DIGITS = 15;

export function whatsappDigits(phone: string | null | undefined): string | null {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;
  // Only digits, a leading "+", and the separators people type.
  if (!/^\+?[\d\s\-().]+$/.test(raw)) return null;

  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = `44${digits.slice(1)}`;
  }

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  return digits;
}

export function whatsappTrackingUrl(phone: string | null | undefined, link: string): string | null {
  const digits = whatsappDigits(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Track your delivery: ${link}`)}`;
}
