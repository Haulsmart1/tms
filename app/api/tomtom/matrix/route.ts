import { NextResponse } from "next/server";
import {
  matrixBody,
  matrixBodyBetween,
  matrixUrl,
  parseMatrix,
} from "../../../../lib/tomtom/api";
import {
  authClient,
  isRateLimited,
  parsePoints,
  requireOperator,
} from "../../../../lib/tomtom/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* The synchronous Matrix v2 endpoint caps at 100 cells, so 10 jobs is the
   ceiling (10 x 10). The page never optimizes more than one vehicle's day at
   a time, so hitting this limit means a single van with 11+ jobs in one day;
   the handler rejects rather than silently truncating.

   Like the routing endpoint, this spends the premium key on every call, so it
   is gated on being console staff rather than merely signed in. */

const MAX_MATRIX_CELLS = 100;
const MAX_JOBS = 10;
const TIMEOUT_MS = 10000;

function pointList(value: unknown) {
  return parsePoints({ points: value });
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

    const legacyPoints = parsePoints(body);
    const origins = legacyPoints ?? pointList(body?.origins);
    const destinations = legacyPoints ?? pointList(body?.destinations);

    if (!origins || !destinations) {
      return NextResponse.json(
        { error: "Provide points, or valid origins and destinations." },
        { status: 400 }
      );
    }

    if (legacyPoints) {
      if (
        origins.length < 2 ||
        origins.length > MAX_JOBS
      ) {
        return NextResponse.json(
          {
            error:
              `Smart Optimize requires 2 to ${MAX_JOBS} matching origins and destinations.`,
          },
          { status: 400 }
        );
      }
    } else if (
      origins.length < 1 ||
      destinations.length < 1 ||
      origins.length * destinations.length > MAX_MATRIX_CELLS
    ) {
      return NextResponse.json(
        {
          error:
            `Matrix requests require at least one origin and destination and at most ${MAX_MATRIX_CELLS} cells.`,
        },
        { status: 400 }
      );
    }

    const key = process.env.TOMTOM_API_KEY;
    if (!key) {
      return NextResponse.json({ error: "TomTom is not configured." }, { status: 503 });
    }

    const response = await fetch(matrixUrl(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        legacyPoints
          ? matrixBody(legacyPoints)
          : matrixBodyBetween(origins, destinations)
      ),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `TomTom matrix failed (${response.status}).` },
        { status: 502 }
      );
    }
    const travelSeconds = parseMatrix(
      await response.json(),
      origins.length,
      destinations.length
    );
    if (!travelSeconds) {
      return NextResponse.json({ error: "TomTom returned no matrix." }, { status: 502 });
    }
    return NextResponse.json({ travelSeconds });
  } catch (error) {
    // Constant message: a fetch failure can quote the request URL, which holds
    // the API key, and a Supabase error can describe internals.
    console.error("tomtom/matrix failed:", error);
    return NextResponse.json({ error: "Matrix routing failed." }, { status: 500 });
  }
}
