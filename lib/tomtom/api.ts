/* THE TOMTOM WIRE FORMAT, in one place.

   Pure builders and parsers only: the route handlers under app/api/tomtom/
   own fetch, auth and the database, this module owns URLs and response
   shapes. Splitting it this way is what lets the response-shape assumptions
   (the part of an API integration that actually breaks) be unit tested.

   countrySet=GB and travelMode=car are deliberate v1 constraints: this is a
   UK haulage console (en-GB currency and Europe/London throughout the app),
   and truck-specific routing (vehicle dimensions, restrictions) needs
   per-vehicle data the schema does not hold yet. */

import type { LatLng, RouteResult } from "../planning/types";

const BASE = "https://api.tomtom.com";

export function geocodeUrl(query: string, key: string): string {
  return `${BASE}/search/2/geocode/${encodeURIComponent(query)}.json?key=${encodeURIComponent(key)}&limit=1&countrySet=GB`;
}

export function parseGeocode(json: any): LatLng | null {
  const pos = json?.results?.[0]?.position;
  if (typeof pos?.lat !== "number" || typeof pos?.lon !== "number") return null;
  return { lat: pos.lat, lng: pos.lon };
}

export function routeUrl(points: LatLng[], key: string): string {
  const locations = points.map((p) => `${p.lat},${p.lng}`).join(":");
  return `${BASE}/routing/1/calculateRoute/${locations}/json?key=${encodeURIComponent(key)}&travelMode=car&traffic=false&routeRepresentation=polyline`;
}

export function parseRoute(json: any): RouteResult | null {
  const route = json?.routes?.[0];
  const summary = route?.summary;
  if (
    !Array.isArray(route?.legs) ||
    route.legs.length === 0 ||
    typeof summary?.lengthInMeters !== "number" ||
    typeof summary?.travelTimeInSeconds !== "number"
  ) {
    return null;
  }

  const legs: RouteResult["legs"] = [];
  const points: LatLng[] = [];
  for (const leg of route.legs) {
    const s = leg?.summary;
    if (typeof s?.lengthInMeters !== "number" || typeof s?.travelTimeInSeconds !== "number") {
      return null;
    }
    legs.push({ distanceMeters: s.lengthInMeters, travelTimeSeconds: s.travelTimeInSeconds });
    for (const p of leg.points ?? []) {
      if (typeof p?.latitude === "number" && typeof p?.longitude === "number") {
        points.push({ lat: p.latitude, lng: p.longitude });
      }
    }
  }

  return {
    points,
    legs,
    totalDistanceMeters: summary.lengthInMeters,
    totalTravelTimeSeconds: summary.travelTimeInSeconds,
  };
}

export function matrixUrl(key: string): string {
  return `${BASE}/routing/matrix/2?key=${encodeURIComponent(key)}`;
}

export function matrixBody(points: LatLng[]): object {
  const list = points.map((p) => ({ point: { latitude: p.lat, longitude: p.lng } }));
  return { origins: list, destinations: list, options: { travelMode: "car" } };
}

/** Unreported cells stay Infinity rather than 0: a zero would tell the
    optimizer an unreachable hop is free, which is exactly backwards. */
export function parseMatrix(json: any, n: number): number[][] | null {
  const data = json?.data;
  if (!Array.isArray(data)) return null;
  const matrix = Array.from({ length: n }, () =>
    Array<number>(n).fill(Number.POSITIVE_INFINITY)
  );
  for (let i = 0; i < n; i++) matrix[i][i] = 0;
  for (const cell of data) {
    const i = cell?.originIndex;
    const j = cell?.destinationIndex;
    const t = cell?.routeSummary?.travelTimeInSeconds;
    if (
      Number.isInteger(i) && Number.isInteger(j) &&
      i >= 0 && i < n && j >= 0 && j < n &&
      typeof t === "number"
    ) {
      matrix[i][j] = t;
    }
  }
  return matrix;
}
