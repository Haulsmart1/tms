import type { LatLng, RouteResult } from "./types";

export const MAX_TOMTOM_ROUTE_POINTS = 50;
export const MAX_PLANNING_ROUTE_JOBS = 350;

export function wouldExceedPlanningRouteJobLimit(
  existingJobIds: readonly string[],
  incomingJobIds: readonly string[]
): boolean {
  const jobIds = new Set(existingJobIds);

  for (const jobId of incomingJobIds) {
    jobIds.add(jobId);
  }

  return jobIds.size > MAX_PLANNING_ROUTE_JOBS;
}

function samePoint(left: LatLng, right: LatLng): boolean {
  return left.lat === right.lat && left.lng === right.lng;
}

/**
 * Splits an ordered route into overlapping TomTom requests.
 *
 * Each chunk after the first starts at the preceding chunk's final waypoint.
 * This preserves the road leg between every consecutive pair of input points.
 */
export function splitRoutePoints(
  points: readonly LatLng[],
  maxPoints = MAX_TOMTOM_ROUTE_POINTS
): LatLng[][] {
  if (!Number.isInteger(maxPoints) || maxPoints < 2) {
    throw new RangeError("maxPoints must be an integer of at least 2.");
  }

  if (points.length < 2) {
    return [];
  }

  const chunks: LatLng[][] = [];
  let start = 0;

  while (start < points.length - 1) {
    const endExclusive = Math.min(start + maxPoints, points.length);
    chunks.push(
      points
        .slice(start, endExclusive)
        .map((point) => ({ lat: point.lat, lng: point.lng }))
    );

    if (endExclusive === points.length) {
      break;
    }

    start = endExclusive - 1;
  }

  return chunks;
}

/**
 * Combines independently calculated, contiguous route chunks into the same
 * RouteResult shape consumed by Planning.
 *
 * TomTom's parsed geometry can repeat the shared waypoint at a chunk boundary.
 * Only that exact boundary duplicate is removed; internal geometry is retained.
 */
export function mergeRouteResults(
  results: readonly RouteResult[]
): RouteResult | null {
  if (results.length === 0) {
    return null;
  }

  const points: LatLng[] = [];
  const legs: RouteResult["legs"] = [];
  let totalDistanceMeters = 0;
  let totalTravelTimeSeconds = 0;

  for (const result of results) {
    totalDistanceMeters += result.totalDistanceMeters;
    totalTravelTimeSeconds += result.totalTravelTimeSeconds;

    for (const leg of result.legs) {
      legs.push({
        distanceMeters: leg.distanceMeters,
        travelTimeSeconds: leg.travelTimeSeconds,
      });
    }

    const boundaryIsDuplicated =
      points.length > 0 &&
      result.points.length > 0 &&
      samePoint(points[points.length - 1], result.points[0]);

    const firstPointIndex = boundaryIsDuplicated ? 1 : 0;

    for (
      let pointIndex = firstPointIndex;
      pointIndex < result.points.length;
      pointIndex += 1
    ) {
      const point = result.points[pointIndex];
      points.push({ lat: point.lat, lng: point.lng });
    }
  }

  return {
    points,
    legs,
    totalDistanceMeters,
    totalTravelTimeSeconds,
  };
}
