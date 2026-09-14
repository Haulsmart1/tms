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
  loginPerEmail: { bucket: "login:email", windowSeconds: 900, max: 5 },
  loginPerIp: { bucket: "login:ip", windowSeconds: 900, max: 20 },
  quoteIntakePerToken: { bucket: "quote-intake:token", windowSeconds: 3600, max: 60 },
  quoteIntakePerIp: { bucket: "quote-intake:ip", windowSeconds: 3600, max: 20 },
  quoteSharePerIp: { bucket: "quote-share:ip", windowSeconds: 600, max: 60 },
  documentEmailPerUser: { bucket: "doc-email:user", windowSeconds: 3600, max: 60 },
  documentEmailPerTenant: { bucket: "doc-email:tenant", windowSeconds: 86400, max: 500 },
  invitePerUser: { bucket: "invite:user", windowSeconds: 3600, max: 30 },
  podSharePdfPerIp: { bucket: "pod-share-pdf:ip", windowSeconds: 600, max: 60 },
  tomtomPerUser: { bucket: "tomtom:user", windowSeconds: 60, max: 120 },
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
