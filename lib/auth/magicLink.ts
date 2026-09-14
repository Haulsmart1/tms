import { safeAuthNextPath } from "./confirm";

/* Pure helpers for POST /api/auth/magic-link (AUTH-7, AUTH-12). Kept free of
   next/server and Supabase imports so vitest can cover them. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Lowercased and trimmed, so the per-email rate limit cannot be dodged by
   changing case, or null when the value is not plausibly an email. */
export function normalizeLoginEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 320) return null;
  return EMAIL_RE.test(email) ? email : null;
}

/* The emailRedirectTo for a sign-in link. The destination is run through the
   same origin check the callback applies, and encoded, so a `next` carrying
   its own query string survives the round trip intact. */
export function confirmRedirectUrl(origin: string, rawNext: unknown): string {
  const next = safeAuthNextPath(typeof rawNext === "string" ? rawNext : null, origin);
  return `${origin}/auth/confirm?next=${encodeURIComponent(next)}`;
}

/* The one body the route returns for every accepted request, whether or not
   the address has an account, so the response cannot be used to enumerate
   who uses the platform. */
export const MAGIC_LINK_SENT_MESSAGE =
  "If that email address has a TMS Wizzard account, a sign-in link is on its way. Check your inbox.";
