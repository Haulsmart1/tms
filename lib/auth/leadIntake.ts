import type { RateLimitRule } from "../rateLimit";

/* Pure guards for the public POST /api/request-access lead form (AUTH-8).
   Kept in lib/ so vitest covers them; the route stays thin. */

/* A second allowance, keyed on the lowercased email, so one address cannot
   be resubmitted from many IPs. Declared here rather than in lib/rateLimit.ts
   because only this route uses it. The per-IP rule stays RATE_LIMITS
   .requestAccessPerIp. */
export const REQUEST_ACCESS_PER_EMAIL: RateLimitRule = {
  bucket: "request-access:email",
  windowSeconds: 86400,
  max: 3,
};

/* A resubmission of the same email inside this window is answered ok but not
   stored or re-notified, so a double click or an impatient retry cannot flood
   the sales channel. */
export const REQUEST_ACCESS_DEDUPE_HOURS = 24;

/* registration_requests.vehicle_count is an int column. Without a ceiling,
   99999999999 passes validation and then 500s at the insert. No haulier on
   this platform runs anywhere near this many vehicles. */
export const MAX_REQUEST_ACCESS_VEHICLES = 100000;

export function normalizeLeadEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function vehicleCountError(vehicles: number): string | null {
  if (!Number.isFinite(vehicles) || vehicles > MAX_REQUEST_ACCESS_VEHICLES) {
    return `Enter a number up to ${MAX_REQUEST_ACCESS_VEHICLES.toLocaleString("en-GB")}.`;
  }
  return null;
}

/* Escapes the LIKE/ILIKE wildcards so an address containing "_" or "%" is
   matched literally when checking for a recent duplicate case-insensitively. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/* The rate-limit key for a caller. Prefers the header Vercel sets itself and a
   client cannot forge; x-real-ip is also platform-set there. Only then does it
   fall back to the leftmost x-forwarded-for, which Vercel overwrites rather
   than appends to. */
export function leadClientKey(headers: Headers, fallback: (headers: Headers) => string): string {
  const trusted = headers.get("x-vercel-forwarded-for") ?? headers.get("x-real-ip");
  const value = trusted?.split(",")[0]?.trim();
  return value ? value : fallback(headers);
}
