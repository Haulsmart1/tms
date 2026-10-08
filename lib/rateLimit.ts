/*
  Durable rate limiting backed by public.rate_limit_hit (docs/sql/prodfix_01_rate_limits.sql).

  Server-only: pass the service-role client. Keys should identify the abuser
  (user id, email, or client IP), never contain secrets.

  Failure policy: if the function does not exist yet (migration not applied,
  Postgres 42883 / PostgREST PGRST202) the hit is ALLOWED and a warning is
  logged, so deploying the code before the SQL does not take features down.
  Any other error is treated as over-limit (fail closed), because a limiter
  that opens whenever the database hiccups protects nothing.
*/

import type { SupabaseClient } from "@supabase/supabase-js";

export type RateLimitRule = {
  bucket: string;
  windowSeconds: number;
  max: number;
};

export const RATE_LIMITS = {
  requestAccessPerIp: { bucket: "request-access:ip", windowSeconds: 3600, max: 5 },
  /* Self-serve signup (POST /api/signup). Same level as the request-access
     lead form, not the login route: each accepted request mints an auth user
     and sends an email, so 5 an hour per IP and 3 a day per address (the
     request-access per-email rule in lib/auth/leadIntake.ts) is the bar. */
  signupPerIp: { bucket: "signup:ip", windowSeconds: 3600, max: 5 },
  signupPerEmail: { bucket: "signup:email", windowSeconds: 86400, max: 3 },
  loginPerEmail: { bucket: "login:email", windowSeconds: 900, max: 5 },
  loginPerIp: { bucket: "login:ip", windowSeconds: 900, max: 20 },
  quoteIntakePerToken: { bucket: "quote-intake:token", windowSeconds: 3600, max: 60 },
  quoteIntakePerIp: { bucket: "quote-intake:ip", windowSeconds: 3600, max: 20 },
  quoteSharePerIp: { bucket: "quote-share:ip", windowSeconds: 600, max: 60 },
  documentEmailPerUser: { bucket: "doc-email:user", windowSeconds: 3600, max: 60 },
  documentEmailPerTenant: { bucket: "doc-email:tenant", windowSeconds: 86400, max: 500 },
  invitePerUser: { bucket: "invite:user", windowSeconds: 3600, max: 30 },
  podSharePdfPerIp: { bucket: "pod-share-pdf:ip", windowSeconds: 600, max: 60 },
  /* Public tracking page JSON (GET /api/public/track/[token]). The page polls
     every 60 seconds, so 120 per 10 minutes per IP allows a dozen open tabs
     behind one office NAT while capping anonymous scraping. */
  trackingViewPerIp: { bucket: "tracking-view:ip", windowSeconds: 600, max: 120 },
  /* Minting tracking links (POST /api/tracking-links), per signed-in user.
     Each call stores a live link row; 120 an hour covers a busy dispatcher
     sending one per drop and stops a loop filling the table. */
  trackingMintPerUser: { bucket: "tracking-mint:user", windowSeconds: 3600, max: 120 },
  tomtomPerUser: { bucket: "tomtom:user", windowSeconds: 60, max: 120 },
  /* Added by review PLAN-13: counts stops that need upstream geocoding (each
     can cost several TomTom calls), not incoming requests. */
  tomtomGeocodeStopsPerUser: { bucket: "tomtom-geocode:user", windowSeconds: 3600, max: 600 },
  /* Driver shift/walkaround events (POST /api/driver/shift/events), one
     request per queued event: generous enough for a normal shift plus a
     backlog of offline events replaying at once. */
  driverShiftEvent: { bucket: "driver-shift-event:user", windowSeconds: 600, max: 120 },
  /* Walkaround defect photos, per signed-in user, shared by both steps (upload
     URL, then record), so 120 requests is 60 photos in ten minutes: a
     backlog of offline photos replays without tripping it, a loop does. */
  driverWalkaroundPhoto: { bucket: "driver-walkaround-photo:user", windowSeconds: 600, max: 120 },
  /* Driver phone GPS (POST /api/driver/location), per signed-in user. The
     phone sends at most one fix every 15 seconds (40 per ten minutes) and
     holds at most 40 while offline, so 120 lets a reconnect flush its backlog
     while stopping a script flooding telematics_positions (scan N-9). The
     tracker retries a 429 with backoff. */
  driverLocation: { bucket: "driver-location:user", windowSeconds: 600, max: 120 },
} as const satisfies Record<string, RateLimitRule>;

const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);

export async function checkRateLimit(
  admin: SupabaseClient,
  rule: RateLimitRule,
  key: string,
): Promise<{ allowed: boolean }> {
  const { data, error } = await admin.rpc("rate_limit_hit", {
    p_bucket: rule.bucket,
    p_key: key.slice(0, 256),
    p_window_seconds: rule.windowSeconds,
    p_max: rule.max,
  });

  if (error) {
    if (error.code && MISSING_FUNCTION_CODES.has(error.code)) {
      console.warn("[rateLimit] rate_limit_hit is not installed; allowing request. Apply docs/sql/prodfix_01_rate_limits.sql.");
      return { allowed: true };
    }
    console.error("[rateLimit] limiter error; failing closed", error.code);
    return { allowed: false };
  }

  return { allowed: data === true };
}

/** Best-effort client IP from Vercel's forwarding headers. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
