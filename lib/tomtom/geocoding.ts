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

/**
 * Selects a valid TomTom result. When the source stop has a UK postcode,
 * candidates with a different postcode are rejected rather than cached.
 */
export function selectGeocodePosition(
  json: unknown,
  expectedPostcode: string | null,
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

      const postcodeMatches =
        structuredPostcode === expectedPostcode ||
        freeformPostcode === expectedPostcode;

      if (!postcodeMatches) {
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