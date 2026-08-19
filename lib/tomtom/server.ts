/* SERVER-SIDE PLUMBING SHARED BY THE THREE TOMTOM ROUTE HANDLERS.

   lib/tomtom/api.ts owns the TomTom wire format and stays pure so it can be
   unit tested. This module owns the things a route handler needs before it is
   allowed to spend the key: the Supabase client, who the caller is, whether
   they are allowed, how often, and whether the body is sane. Keeping one copy
   means an authorization fix lands on all three endpoints at once. */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { LatLng } from "../planning/types";

/** Cookie-backed, RLS-scoped Supabase client for the calling user.
    setAll persists refreshed auth cookies rather than discarding them: a
    no-op version silently drops rotated tokens and signs long sessions out.
    The try/catch is for the Server Component case, where the cookie store is
    read-only and set() throws. */
export async function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase public env vars.");
  const store = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {}
      },
    },
  });
}

export type TomTomClient = Awaited<ReturnType<typeof authClient>>;

/** The caller, once identified. companyId is null for a signed-in user who is
    not console staff, which the handlers turn into 403. */
export type Operator = { userId: string; companyId: string | null };

/* WHY AUTHENTICATION ALONE IS NOT ENOUGH.

   Every portal driver (driver_users) and every subcontractor user
   (subcontractor_users) holds a perfectly valid Supabase session, so a bare
   auth.getUser() check would let a few hundred phone-holding drivers, and
   anyone a subcontractor chooses to invite, spend the premium TomTom key at
   will. Only console staff have any business routing or geocoding.

   get_my_company_id() is the gate because it IS the tenancy predicate: it
   returns profiles.company_id for auth.uid(), and every tenant table's RLS
   policy is literally `tenant_id = get_my_company_id()`. Portal invites write
   users + driver_users/subcontractor_users and never a profiles row, so the
   function returns null for them. That makes the check exactly as strict as
   the database itself, with no service-role client needed: a caller this
   returns null for could not read a single job_stops row anyway. The
   memberships lookup that app/api/settings/users/invite/route.ts performs was
   the alternative, but it needs the service-role key and a tenant id the
   TomTom endpoints never receive. */
export async function requireOperator(client: TomTomClient): Promise<Operator | null> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data, error } = await client.rpc("get_my_company_id");
  if (error) throw new Error(error.message);
  return { userId: user.id, companyId: typeof data === "string" && data ? data : null };
}

/* RATE LIMIT, keyed by user id and shared across all three endpoints, because
   the budget being protected is one TomTom account. Modelled on the limiter in
   app/api/request-access/route.ts and inheriting its known limit: the map is
   per serverless instance and resets on redeploy, so this is a speed bump
   against a runaway client or a bored insider, not a hard quota. A real cap
   needs a shared store (Redis/Upstash) or TomTom-side alerting. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_MAX_KEYS = 10_000;
const OVERFLOW_KEY = "__overflow__";
const recentHits = new Map<string, number[]>();
let lastPrune = 0;

export function isRateLimited(userId: string): boolean {
  const now = Date.now();

  // Prune at most once per window: walking the whole map per request is
  // O(n^2) under a flood and turns the limiter into its own DoS vector.
  if (now - lastPrune > RATE_LIMIT_WINDOW_MS) {
    lastPrune = now;
    for (const [k, times] of recentHits) {
      if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) recentHits.delete(k);
    }
  }

  // Hard cap on distinct keys so memory cannot grow without bound. Once full,
  // new keys share one overflow bucket, so the worst case is a global 429.
  const effectiveKey =
    recentHits.has(userId) || recentHits.size < RATE_LIMIT_MAX_KEYS ? userId : OVERFLOW_KEY;

  const mine = (recentHits.get(effectiveKey) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  mine.push(now);
  recentHits.set(effectiveKey, mine);
  return mine.length > RATE_LIMIT_MAX;
}

/** Coordinates out of these ranges are not a real place, so they are a bug or
    a probe either way. Rejecting here keeps malformed values out of the
    TomTom URL rather than paying for a request that cannot succeed. */
function isLatLng(value: unknown): value is LatLng {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) return false;
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) return false;
  return true;
}

/** body.points as lat/lng pairs, or null if anything about it is wrong. The
    caller owns the length rules, which differ per endpoint. */
export function parsePoints(body: unknown): LatLng[] | null {
  if (typeof body !== "object" || body === null) return null;
  const { points } = body as { points?: unknown };
  if (!Array.isArray(points)) return null;
  const parsed: LatLng[] = [];
  for (const point of points) {
    if (!isLatLng(point)) return null;
    parsed.push({ lat: point.lat, lng: point.lng });
  }
  return parsed;
}
