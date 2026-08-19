import { NextResponse } from "next/server";
import { geocodeQuery } from "../../../../lib/planning/geocoding";
import { geocodeUrl, parseGeocode } from "../../../../lib/tomtom/api";
import { authClient, isRateLimited, requireOperator } from "../../../../lib/tomtom/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Callers only send stops that are missing coordinates (see
   stopsNeedingGeocode), so every row this touches is a cache miss. Results
   are written straight back to job_stops through the RLS-scoped client:
   a user can only geocode, and only overwrite, their own tenant's stops. */

const MAX_STOPS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 5000;

/** Distinct, well-formed stop ids, or null if the body is not usable. */
function parseStopIds(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) return null;
  const { stopIds } = body as { stopIds?: unknown };
  if (!Array.isArray(stopIds) || stopIds.length === 0 || stopIds.length > MAX_STOPS) return null;
  for (const id of stopIds) {
    if (typeof id !== "string" || !UUID.test(id)) return null;
  }
  return Array.from(new Set(stopIds as string[]));
}

export async function POST(request: Request) {
  try {
    const client = await authClient();

    const operator = await requireOperator(client);
    if (!operator) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }
    if (!operator.companyId) {
      return NextResponse.json({ error: "You do not have console access." }, { status: 403 });
    }

    if (isRateLimited(operator.userId)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again shortly." },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => null);
    const stopIds = parseStopIds(body);
    if (!stopIds) {
      return NextResponse.json(
        { error: `stopIds must be 1 to ${MAX_STOPS} stop ids.` },
        { status: 400 }
      );
    }

    const key = process.env.TOMTOM_API_KEY;
    if (!key) {
      return NextResponse.json({ error: "TomTom is not configured." }, { status: 503 });
    }

    // RLS silently drops rows from other tenants, so a hostile id list simply
    // comes back shorter rather than erroring or leaking.
    const { data: stops, error } = await client
      .from("job_stops")
      .select("id, address_line, city, postcode, lat, lng")
      .in("id", stopIds);
    if (error) throw new Error(error.message);

    const geocoded: { id: string; lat: number; lng: number }[] = [];

    /* One try/catch per stop, so a single timeout or write error costs that
       stop and not the whole batch: without it, twenty successful geocodes
       are discarded because the twenty-first address was odd, and the next
       page load pays for all twenty again.

       Negative caching is deliberately deferred. A permanently unresolvable
       address is retried once per page load rather than stamped as a known
       miss, which needs a column and an invalidation story. At current volume
       (a van's day, a handful of bad addresses) that is a few wasted lookups,
       not a cost problem. Revisit if a tenant ever imports dirty addresses in
       bulk. */
    for (const stop of stops ?? []) {
      try {
        if (stop.lat !== null && stop.lng !== null) {
          geocoded.push({ id: stop.id, lat: stop.lat, lng: stop.lng });
          continue;
        }
        const query = geocodeQuery(stop);
        if (!query) continue;

        const response = await fetch(geocodeUrl(query, key), {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const position = response.ok ? parseGeocode(await response.json()) : null;
        if (!position) continue;

        const { error: updateError } = await client
          .from("job_stops")
          .update({ lat: position.lat, lng: position.lng, geocoded_at: new Date().toISOString() })
          .eq("id", stop.id);
        if (updateError) throw new Error(updateError.message);

        geocoded.push({ id: stop.id, ...position });
      } catch (stopError) {
        console.error("tomtom/geocode: stop failed", stop.id, stopError);
      }
    }

    /* `failed` is derived from the request, not from the loop: the client
       treats it as "this will not resolve, badge the job", so an id the
       RLS-filtered select never returned has to appear there too. Computing
       it by subtraction is the only way that stays true. */
    const resolved = new Set(geocoded.map((g) => g.id));
    const failed = stopIds.filter((id) => !resolved.has(id));

    return NextResponse.json({ geocoded, failed });
  } catch (error) {
    // Constant message: a DB or fetch error string can carry internal detail,
    // and a fetch failure can quote the URL, which holds the API key.
    console.error("tomtom/geocode failed:", error);
    return NextResponse.json({ error: "Geocoding failed." }, { status: 500 });
  }
}
