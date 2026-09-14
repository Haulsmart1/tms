import { NextResponse } from "next/server";
import {
  geocodeQuery,
  geocodeQueryVariants,
  normalizeUkPostcode,
  selectGeocodePosition,
  selectUkPostcodePosition,
} from "../../../../lib/tomtom/geocoding";
import { geocodeUrl } from "../../../../lib/tomtom/api";
import {
  authClient,
  isDurablyRateLimited,
  isRateLimited,
  requireOperator,
} from "../../../../lib/tomtom/server";
import { shouldRetryGeocode } from "../../../../lib/tomtom/geocodeRetry";
import { RATE_LIMITS } from "../../../../lib/rateLimit";

type StopRow = {
  id: string;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  geocode_failed_at?: string | null;
  geocode_attempts?: number | null;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_STOPS = 100;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 5000;
const UK_POSTCODE_API =
  "https://api.postcodes.io/postcodes";

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
  allowOutwardPostcodeMatch = false,
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
      allowOutwardPostcodeMatch,
    ),
    status: response.status,
    candidates:
      candidateDiagnostics(json),
  };
}

async function lookupUkPostcode(
  expectedPostcode: string,
) {
  const response = await fetch(
    `${UK_POSTCODE_API}/${encodeURIComponent(
      expectedPostcode,
    )}`,
    {
      signal:
        AbortSignal.timeout(
          TIMEOUT_MS,
        ),
    },
  );

  if (!response.ok) {
    return {
      position: null,
      status: response.status,
    };
  }

  const json =
    await response.json();

  return {
    position:
      selectUkPostcodePosition(
        json,
        expectedPostcode,
      ),
    status: response.status,
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
      isRateLimited(operator.userId) ||
      (await isDurablyRateLimited(operator.userId))
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

    /* The failure cache columns come from prodfix_73. Until that is applied
       the select answers 42703 and geocoding runs as before, uncached. */
    type StopsResult = {
      data: StopRow[] | null;
      error: { code?: string; message: string } | null;
    };

    let failureCacheAvailable = true;
    let stopsResult = (await client
      .from("job_stops")
      .select(
        "id, address_line, city, postcode, lat, lng, geocode_failed_at, geocode_attempts",
      )
      .in("id", stopIds)) as unknown as StopsResult;

    if (stopsResult.error?.code === "42703") {
      failureCacheAvailable = false;
      stopsResult = (await client
        .from("job_stops")
        .select(
          "id, address_line, city, postcode, lat, lng",
        )
        .in("id", stopIds)) as unknown as StopsResult;
    }

    if (stopsResult.error) {
      throw new Error(stopsResult.error.message);
    }

    const stops = stopsResult.data;

    /* A definite "not found" is remembered so tracking polls and planning
       loads stop paying for it again (review PLAN-13). Best effort: a failed
       write only costs a later retry. */
    async function recordGeocodeMiss(stop: StopRow) {
      if (!failureCacheAvailable) return;

      const { error: missError } = await client
        .from("job_stops")
        .update({
          geocode_failed_at: new Date().toISOString(),
          geocode_attempts: (stop.geocode_attempts ?? 0) + 1,
        })
        .eq("id", stop.id);

      if (missError) {
        console.error("tomtom/geocode: could not record miss", stop.id, missError.code);
      }
    }

    const geocoded: {
      id: string;
      lat: number;
      lng: number;
    }[] = [];

    const skipped: string[] = [];
    let upstreamBudgetExhausted = false;
    const requestStartedAt = new Date();

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

        if (
          failureCacheAvailable &&
          !shouldRetryGeocode(
            stop.geocode_failed_at,
            stop.geocode_attempts,
            requestStartedAt,
          )
        ) {
          skipped.push(stop.id);
          continue;
        }

        const query =
          geocodeQuery(stop);

        if (!query) {
          await recordGeocodeMiss(stop);
          continue;
        }

        /* Budget counts stops that need upstream calls, not requests: one
           request can carry 100 stops at up to five TomTom calls each. */
        if (
          await isDurablyRateLimited(
            operator.userId,
            RATE_LIMITS.tomtomGeocodeStopsPerUser,
          )
        ) {
          upstreamBudgetExhausted = true;
          break;
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
            true,
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

        const addressQueries =
          geocodeQueryVariants(stop);

        for (
          let index = 1;
          index < addressQueries.length &&
          !result.position;
          index += 1
        ) {
          result =
            await geocode(
              addressQueries[index],
              key,
              expectedPostcode,
              true,
            );

          console.info(
            "tomtom/geocode: address retry result",
            {
              stopId: stop.id,
              expectedPostcode,
              variant: index + 1,
              status: result.status,
              matched: Boolean(
                result.position,
              ),
              candidates:
                result.candidates,
            },
          );

          if (result.status !== 200) {
            console.error(
              "tomtom/geocode: upstream status",
              stop.id,
              result.status,
            );

            break;
          }
        }

        /*
         * If the address-bearing queries still produced no valid result,
         * retry using the clean postcode alone. Outward-code matching is
         * deliberately disabled for this postcode-only fallback.
         */
        if (
          result.status === 200 &&
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

        let position =
          result.position;

        /*
         * TomTom sometimes resolves only the outward postcode district
         * (for example CW5) even when the source contains a full postcode.
         * Do not weaken TomTom matching. Instead, use an exact UK-postcode
         * lookup as the final fallback and require that service to return
         * the same normalized full postcode before coordinates are trusted.
         */
        if (
          !position &&
          expectedPostcode
        ) {
          const postcodeFallback =
            await lookupUkPostcode(
              expectedPostcode,
            );

          console.info(
            "tomtom/geocode: UK postcode fallback result",
            {
              stopId: stop.id,
              expectedPostcode,
              status:
                postcodeFallback.status,
              matched: Boolean(
                postcodeFallback.position,
              ),
            },
          );

          position =
            postcodeFallback.position;
        }

        if (!position) {
          // Only a definite miss is cached; upstream errors stay retryable.
          if (result.status === 200) {
            await recordGeocodeMiss(stop);
          }
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
            ...(failureCacheAvailable
              ? { geocode_failed_at: null, geocode_attempts: 0 }
              : {}),
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
      /* Recently failed addresses not retried this time. */
      skipped,
      /* True when the per-user upstream budget stopped this batch early. */
      rateLimited: upstreamBudgetExhausted,
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