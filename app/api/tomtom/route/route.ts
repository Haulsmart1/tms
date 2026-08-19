import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { LatLng } from "../../../../lib/planning/types";
import { parseRoute, routeUrl } from "../../../../lib/tomtom/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* No table access, but auth is still required: without it this endpoint is an
   open proxy that spends the premium TomTom key for anyone on the internet. */

const MAX_POINTS = 50;

function parsePoints(body: any): LatLng[] | null {
  if (!Array.isArray(body?.points)) return null;
  const points: LatLng[] = [];
  for (const p of body.points) {
    if (typeof p?.lat !== "number" || typeof p?.lng !== "number") return null;
    points.push({ lat: p.lat, lng: p.lng });
  }
  return points;
}

async function requireUser(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const store = await cookies();
  const client = createServerClient(url, anon, {
    cookies: { getAll: () => store.getAll(), setAll() {} },
  });
  const { data: { user } } = await client.auth.getUser();
  return Boolean(user);
}

export async function POST(request: Request) {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "TomTom is not configured." }, { status: 503 });
  }
  if (!(await requireUser())) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const points = parsePoints(body);
  if (!points || points.length < 2 || points.length > MAX_POINTS) {
    return NextResponse.json({ error: "points must be 2 to 50 lat/lng pairs." }, { status: 400 });
  }

  try {
    const response = await fetch(routeUrl(points, key));
    if (!response.ok) {
      return NextResponse.json({ error: `TomTom routing failed (${response.status}).` }, { status: 502 });
    }
    const route = parseRoute(await response.json());
    if (!route) {
      return NextResponse.json({ error: "TomTom returned no route." }, { status: 502 });
    }
    return NextResponse.json(route);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Routing failed." },
      { status: 500 }
    );
  }
}
