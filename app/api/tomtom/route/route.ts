import { NextResponse } from "next/server";
import { parseRoute, routeUrl } from "../../../../lib/tomtom/api";
import {
  authClient,
  isRateLimited,
  parsePoints,
  requireOperator,
} from "../../../../lib/tomtom/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* No table access, but authorization is still required: without it this
   endpoint is an open proxy that spends the premium TomTom key for anyone on
   the internet. requireOperator, not just a session, because portal drivers
   and subcontractor users hold valid sessions too. */

const MAX_POINTS = 50;
const TIMEOUT_MS = 10000;

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
    const points = parsePoints(body);
    if (!points || points.length < 2 || points.length > MAX_POINTS) {
      return NextResponse.json(
        { error: `points must be 2 to ${MAX_POINTS} lat/lng pairs.` },
        { status: 400 }
      );
    }

    const key = process.env.TOMTOM_API_KEY;
    if (!key) {
      return NextResponse.json({ error: "TomTom is not configured." }, { status: 503 });
    }

    const response = await fetch(routeUrl(points, key), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `TomTom routing failed (${response.status}).` },
        { status: 502 }
      );
    }
    const route = parseRoute(await response.json());
    if (!route) {
      return NextResponse.json({ error: "TomTom returned no route." }, { status: 502 });
    }
    return NextResponse.json(route);
  } catch (error) {
    // Constant message: a fetch failure can quote the request URL, which holds
    // the API key, and a Supabase error can describe internals.
    console.error("tomtom/route failed:", error);
    return NextResponse.json({ error: "Routing failed." }, { status: 500 });
  }
}
