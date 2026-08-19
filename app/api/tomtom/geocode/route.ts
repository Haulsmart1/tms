import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { geocodeQuery } from "../../../../lib/planning/geocoding";
import { geocodeUrl, parseGeocode } from "../../../../lib/tomtom/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Callers only send stops that are missing coordinates (see
   stopsNeedingGeocode), so every row this touches is a cache miss. Results
   are written straight back to job_stops through the RLS-scoped client:
   a user can only geocode, and only overwrite, their own tenant's stops. */

const MAX_STOPS = 100;

async function authClient() {
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

export async function POST(request: Request) {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "TomTom is not configured." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const stopIds: string[] = Array.isArray(body?.stopIds)
    ? body.stopIds.filter((id: unknown) => typeof id === "string").slice(0, MAX_STOPS)
    : [];
  if (stopIds.length === 0) {
    return NextResponse.json({ error: "stopIds is required." }, { status: 400 });
  }

  try {
    const client = await authClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    // RLS silently drops rows from other tenants, so a hostile id list simply
    // comes back shorter rather than erroring or leaking.
    const { data: stops, error } = await client
      .from("job_stops")
      .select("id, address_line, city, postcode, lat, lng")
      .in("id", stopIds);
    if (error) throw new Error(error.message);

    const geocoded: { id: string; lat: number; lng: number }[] = [];
    const failed: string[] = [];

    for (const stop of stops ?? []) {
      if (stop.lat !== null && stop.lng !== null) {
        geocoded.push({ id: stop.id, lat: stop.lat, lng: stop.lng });
        continue;
      }
      const query = geocodeQuery(stop);
      if (!query) {
        failed.push(stop.id);
        continue;
      }
      const response = await fetch(geocodeUrl(query, key));
      const position = response.ok ? parseGeocode(await response.json()) : null;
      if (!position) {
        failed.push(stop.id);
        continue;
      }
      const { error: updateError } = await client
        .from("job_stops")
        .update({ lat: position.lat, lng: position.lng, geocoded_at: new Date().toISOString() })
        .eq("id", stop.id);
      if (updateError) {
        failed.push(stop.id);
        continue;
      }
      geocoded.push({ id: stop.id, ...position });
    }

    return NextResponse.json({ geocoded, failed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Geocoding failed." },
      { status: 500 }
    );
  }
}
