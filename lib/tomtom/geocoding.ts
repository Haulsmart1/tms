import type { LatLng } from "../planning/types";

type GeocodeStop = {
  address_line: string | null;
  city: string | null;
  postcode: string | null;
};

const UK_POSTCODE =
  /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

function cleanPart(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Extracts a UK postcode even when a locality has accidentally been stored
 * in the same field, e.g. "IGHTHAM TN15 9HZ" -> "TN15 9HZ".
 */
export function normalizeUkPostcode(
  value: string | null | undefined,
): string | null {
  const cleaned = cleanPart(value).toUpperCase();
  const match = cleaned.match(UK_POSTCODE);

  if (!match) {
    return null;
  }

  const compact = match[1].replace(/\s+/g, "");

  if (compact.length < 5) {
    return null;
  }

  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/**
 * Builds a clean UK geocode query. A valid postcode takes precedence over
 * noisy postcode-field text because postcode is the strongest location clue.
 */
export function geocodeQuery(stop: GeocodeStop): string {
  const address = cleanPart(stop.address_line);
  const city = cleanPart(stop.city);
  const postcode =
    normalizeUkPostcode(stop.postcode) ??
    cleanPart(stop.postcode);

  return [address, city, postcode]
    .filter((part) => part.length > 0)
    .join(", ");
}

function uniqueQueries(queries: string[]): string[] {
  return [
    ...new Set(
      queries
        .map((query) => cleanPart(query))
        .filter((query) => query.length > 0),
    ),
  ];
}

/**
 * Builds progressively simpler address-bearing queries.
 *
 * These remain address searches rather than postcode-only searches,
 * allowing the caller to safely use matching UK outward codes when
 * TomTom supplies only district-level structured postcode metadata.
 */
export function geocodeQueryVariants(
  stop: GeocodeStop,
): string[] {
  const address = cleanPart(stop.address_line);
  const city = cleanPart(stop.city);
  const postcode =
    normalizeUkPostcode(stop.postcode) ??
    cleanPart(stop.postcode);

  const addressParts = address
    .split(",")
    .map((part) => cleanPart(part))
    .filter((part) => part.length > 0);

  const queries = [geocodeQuery(stop)];

  if (addressParts.length > 1) {
    const withoutLeadingName =
      addressParts.slice(1).join(", ");

    queries.push(
      [withoutLeadingName, city, postcode]
        .filter((part) => part.length > 0)
        .join(", "),
    );

    const firstRemainingPart =
      addressParts[1];

    const withoutUnit =
      firstRemainingPart.replace(
        /^unit\s+[a-z0-9-]+\s+/i,
        "",
      );

    if (
      withoutUnit !== firstRemainingPart &&
      withoutUnit.length > 0
    ) {
      const simplifiedAddress = [
        withoutUnit,
        ...addressParts.slice(2),
      ].join(", ");

      queries.push(
        [simplifiedAddress, city, postcode]
          .filter((part) => part.length > 0)
          .join(", "),
      );
    }
  }

  return uniqueQueries(queries);
}

/**
 * Selects a valid TomTom result. When the source stop has a UK postcode,
 * candidates with a different postcode are rejected rather than cached.
 */
export function selectGeocodePosition(
  json: unknown,
  expectedPostcode: string | null,
  allowOutwardPostcodeMatch = false,
): LatLng | null {
  const results =
    typeof json === "object" &&
    json !== null &&
    Array.isArray((json as { results?: unknown }).results)
      ? (json as { results: unknown[] }).results
      : [];

  for (const rawResult of results) {
    if (typeof rawResult !== "object" || rawResult === null) {
      continue;
    }

    const result = rawResult as {
      position?: {
        lat?: unknown;
        lon?: unknown;
      };
      address?: {
        postalCode?: unknown;
        freeformAddress?: unknown;
        countryCode?: unknown;
      };
    };

    const lat = result.position?.lat;
    const lon = result.position?.lon;

    if (
      typeof lat !== "number" ||
      !Number.isFinite(lat) ||
      typeof lon !== "number" ||
      !Number.isFinite(lon)
    ) {
      continue;
    }

    if (expectedPostcode) {
      const structuredPostcode =
        typeof result.address?.postalCode === "string"
          ? normalizeUkPostcode(result.address.postalCode)
          : null;

      const freeformPostcode =
        typeof result.address?.freeformAddress === "string"
          ? normalizeUkPostcode(result.address.freeformAddress)
          : null;

      const exactPostcodeMatch =
        structuredPostcode === expectedPostcode ||
        freeformPostcode === expectedPostcode;

      const structuredOutwardCode =
        typeof result.address?.postalCode === "string"
          ? cleanPart(result.address.postalCode).toUpperCase()
          : null;

      const expectedOutwardCode =
        expectedPostcode.split(" ")[0];

      const countryCode =
        typeof result.address?.countryCode === "string"
          ? result.address.countryCode.toUpperCase()
          : null;

      const outwardPostcodeMatch =
        allowOutwardPostcodeMatch &&
        countryCode === "GB" &&
        structuredOutwardCode === expectedOutwardCode;

      if (
        !exactPostcodeMatch &&
        !outwardPostcodeMatch
      ) {
        continue;
      }
    }

    return {
      lat,
      lng: lon,
    };
  }

  return null;
}

/**
 * Validates a response from a UK postcode lookup service.
 *
 * The fallback is deliberately stricter than the TomTom address matcher:
 * the service must return the exact full UK postcode requested. An outward
 * code such as "CW5" is never accepted as a substitute for "CW5 8JT".
 */
export function selectUkPostcodePosition(
  json: unknown,
  expectedPostcode: string,
): LatLng | null {
  const normalizedExpected =
    normalizeUkPostcode(
      expectedPostcode,
    );

  if (
    !normalizedExpected ||
    typeof json !== "object" ||
    json === null
  ) {
    return null;
  }

  const result =
    (json as {
      result?: unknown;
    }).result;

  if (
    typeof result !== "object" ||
    result === null
  ) {
    return null;
  }

  const value =
    result as {
      postcode?: unknown;
      latitude?: unknown;
      longitude?: unknown;
    };

  const returnedPostcode =
    typeof value.postcode === "string"
      ? normalizeUkPostcode(
          value.postcode,
        )
      : null;

  if (
    returnedPostcode !==
    normalizedExpected
  ) {
    return null;
  }

  const latitude =
    value.latitude;
  const longitude =
    value.longitude;

  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  return {
    lat: latitude,
    lng: longitude,
  };
}
