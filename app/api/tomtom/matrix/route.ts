import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { LatLng } from "../../../../lib/planning/types";
import { matrixBody, matrixUrl, parseMatrix } from "../../../../lib/tomtom/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* The synchronous Matrix v2 endpoint caps at 100 cells, so 10 jobs is the
   ceiling (10 x 10). The page never optimizes more than one vehicle's day at
   a time, so hitting this limit means a single van with 11+ jobs in one day;
   the handler rejects rather than silently truncating. */

const MAX_JOBS = 10;

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
  if (!points || points.length < 2 || points.length > MAX_JOBS) {
    return NextResponse.json(
      { error: `points must be 2 to ${MAX_JOBS} lat/lng pairs.` },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(matrixUrl(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(matrixBody(points)),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `TomTom matrix failed (${response.status}).` }, { status: 502 });
    }
    const travelSeconds = parseMatrix(await response.json(), points.length);
    if (!travelSeconds) {
      return NextResponse.json({ error: "TomTom returned no matrix." }, { status: 502 });
    }
    return NextResponse.json({ travelSeconds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Matrix routing failed." },
      { status: 500 }
    );
  }
}
