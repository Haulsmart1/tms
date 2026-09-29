/*
  The cab QR code a driver scans to confirm the vehicle. Client-safe.

  A scan shows the driver was probably at the truck; it does not prove it. A
  reissued code defeats old and copied stickers, not a photo of the current one.
  Only the token's hash is stored (vehicles.walkaround_qr_token_hash).
*/

export const WALKAROUND_QR_PREFIX = "TMSW1:";
const TOKEN_RE = /^[0-9A-HJKMNP-TV-Z]{16}$/;

export function encodeQrPayload(token: string): string {
  return `${WALKAROUND_QR_PREFIX}${token}`;
}

export function parseQrPayload(text: string): string | null {
  const value = text.trim();
  if (value.slice(0, WALKAROUND_QR_PREFIX.length).toUpperCase() !== WALKAROUND_QR_PREFIX) return null;
  const token = value.slice(WALKAROUND_QR_PREFIX.length).toUpperCase();
  return TOKEN_RE.test(token) ? token : null;
}

export function normalizeRegistration(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function registrationsMatch(a: string, b: string): boolean {
  const left = normalizeRegistration(a);
  return left.length > 0 && left === normalizeRegistration(b);
}
