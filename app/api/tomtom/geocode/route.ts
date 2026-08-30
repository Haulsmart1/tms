import { NextResponse } from "next/server";
import {
  geocodeQuery,
  normalizeUkPostcode,
  selectGeocodePosition,
} from "../../../../lib/tomtom/geocoding";
import { geocodeUrl } from "../../../../lib/tomtom/api";
import {
  authClient,
  isRateLimited,
  requireOperator,
} from "../../../../lib/tomtom/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_STOPS = 100;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 5000;

function parseStopIds(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const { stopIds } = body as {
    stopIds?: unknown;
  };

  if (
    !Array.isArray(stopIds) ||
    stopIds.length === 0 ||
    stopIds.length > MAX_STOPS
  ) {
    return null;
  }

  for (const id of stopIds) {
    if (
      typeof id !== "string" ||
      !UUID.test(id)
    ) {
      return null;
    }
  }

  return Array.from(
    new Set(stopIds as string[]),
  );
}

type GeocodeCandidateDiagnostic = {
  postalCode: string | null;
  countryCode: string | null;
  hasPosition: boolean;
};

function candidateDiagnostics(
  json: unknown,
): GeocodeCandidateDiagnostic[] {
  if (
    typeof json !== "object" ||
    json === null ||
    !Array.isArray(
      (json as { results?: unknown }).results,
    )
  ) {
    return [];
  }

  return (
    json as { results: unknown[] }
  ).results.slice(0, 5).map((raw) => {
    if (
      typeof raw !== "object" ||
      raw === null
    ) {
      return {
        postalCode: null,
        countryCode: null,
        hasPosition: false,
      };
    }

    const candidate = raw as {
      position?: unknown;
      address?: {
        postalCode?: unknown;
        countryCode?: unknown;
      };
    };

    return {
      postalCode:
        typeof candidate.address?.postalCode ===
        "string"
          ? candidate.address.postalCode
          : null,
      countryCode:
        typeof candidate.address?.countryCode ===
        "string"
          ? candidate.address.countryCode
          : null,
      hasPosition:
        typeof candidate.position === "object" &&
        candidate.position !== null,
    };
  });
}

async function geocode(
  query: string,
  key: string,
  expectedPostcode: string | null,
) {
  const response = await fetch(
    geocodeUrl(query, key),
    {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    return {
      position: null,
      status: response.status,
      candidates: [] as GeocodeCandidateDiagnostic[],
    };
  }

  const json = await response.json();

  return {
    position: selectGeocodePosition(
      json,
      expectedPostcode,
    ),
    status: response.status,
    candidates:
      candidateDiagnostics(json),
  };
}

export async function POST(request: Request) {
  try {
    const client = await authClient();

    const operator =
      await requireOperator(client);

    if (!operator) {
      return NextResponse.json(
        {
          error: "You must be signed in.",
        },
        {
          status: 401,
        },
      );
    }

    if (!operator.companyId) {
      return NextResponse.json(
        {
          error:
            "You do not have console access.",
        },
        {
          status: 403,
        },
      );
    }

    if (
      isRateLimited(operator.userId)
    ) {
      return NextResponse.json(
        {
          error:
            "Too many requests. Please try again shortly.",
        },
        {
          status: 429,
        },
      );
    }

    const body =
      await request
        .json()
        .catch(() => null);

    const stopIds =
      parseStopIds(body);

    if (!stopIds) {
      return NextResponse.json(
        {
          error:
            `stopIds must be 1 to ${MAX_STOPS} stop ids.`,
        },
        {
          status: 400,
        },
      );
    }

    const key =
      process.env.TOMTOM_API_KEY;

    if (!key) {
      return NextResponse.json(
        {
          error:
            "TomTom is not configured.",
        },
        {
          status: 503,
        },
      );
    }

    const {
      data: stops,
      error,
    } = await client
      .from("job_stops")
      .select(
        "id, address_line, city, postcode, lat, lng",
      )
      .in("id", stopIds);

    if (error) {
      throw new Error(error.message);
    }

    const geocoded: {
      id: string;
      lat: number;
      lng: number;
    }[] = [];

    const deadline =
      Date.now() + 25_000;

    for (const stop of stops ?? []) {
      if (Date.now() > deadline) {
        break;
      }

      try {
        if (
          stop.lat !== null &&
          stop.lng !== null
        ) {
          geocoded.push({
            id: stop.id,
            lat: stop.lat,
            lng: stop.lng,
          });

          continue;
        }

        const query =
          geocodeQuery(stop);

        if (!query) {
          continue;
        }

        const expectedPostcode =
          normalizeUkPostcode(
            stop.postcode,
          );

        let result =
          await geocode(
            query,
            key,
            expectedPostcode,
          );

        console.info(
          "tomtom/geocode: full query result",
          {
            stopId: stop.id,
            expectedPostcode,
            status: result.status,
            matched: Boolean(result.position),
            candidates: result.candidates,
          },
        );

        if (
          result.status !== 200
        ) {
          console.error(
            "tomtom/geocode: upstream status",
            stop.id,
            result.status,
          );

          continue;
        }

        /*
         * If a valid postcode was supplied but the full free-text query
         * returned no candidate with that postcode, retry using the clean
         * postcode alone. This is safer than accepting a plausible result
         * hundreds of miles away.
         */
        if (
          !result.position &&
          expectedPostcode
        ) {
          result =
            await geocode(
              expectedPostcode,
              key,
              expectedPostcode,
            );

          console.info(
            "tomtom/geocode: postcode retry result",
            {
              stopId: stop.id,
              expectedPostcode,
              status: result.status,
              matched: Boolean(result.position),
              candidates: result.candidates,
            },
          );
        }

        const position =
          result.position;

        if (!position) {
          continue;
        }

        const {
          error: updateError,
        } = await client
          .from("job_stops")
          .update({
            lat: position.lat,
            lng: position.lng,
            geocoded_at:
              new Date().toISOString(),
          })
          .eq("id", stop.id);

        if (updateError) {
          throw new Error(
            updateError.message,
          );
        }

        geocoded.push({
          id: stop.id,
          ...position,
        });
      } catch (stopError) {
        console.error(
          "tomtom/geocode: stop failed",
          stop.id,
          stopError,
        );
      }
    }

    const resolved =
      new Set(
        geocoded.map(
          (item) => item.id,
        ),
      );

    const failed =
      stopIds.filter(
        (id) =>
          !resolved.has(id),
      );

    return NextResponse.json({
      geocoded,
      failed,
    });
  } catch (error) {
    console.error(
      "tomtom/geocode failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Geocoding failed.",
      },
      {
        status: 500,
      },
    );
  }
}