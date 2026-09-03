import type { LatLng, PlanJob, PlanStop } from "./types";

/* A job is routable only when EVERY stop has cached coordinates. Routing
   around a missing stop would draw a route that looks shorter than the day
   really is, which is the worst kind of wrong: plausible. Unroutable jobs
   stay draggable on the board and are simply left out of the route. */
export function isRoutable(job: PlanJob): boolean {
  return job.stops.length > 0 && job.stops.every((s) => s.lat !== null && s.lng !== null);
}

export function sortedStops(job: PlanJob): PlanStop[] {
  return [...job.stops].sort((a, b) => a.stop_order - b.stop_order);
}

/** A routable job's stops as waypoints, in stop_order. [] when unroutable. */
export function jobWaypoints(job: PlanJob): LatLng[] {
  if (!isRoutable(job)) return [];
  return sortedStops(job).map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
}

/** The first ordered stop of a routable job. */
export function jobEntryPoint(job: PlanJob): LatLng | null {
  return jobWaypoints(job)[0] ?? null;
}

/** The final ordered stop of a routable job. */
export function jobExitPoint(job: PlanJob): LatLng | null {
  const points = jobWaypoints(job);
  return points.length > 0 ? points[points.length - 1] : null;
}

/** Kept for map markers and backwards compatibility. */
export function jobRepresentativePoint(job: PlanJob): LatLng | null {
  return jobEntryPoint(job);
}

function stopPoint(stop: PlanStop): LatLng | null {
  if (stop.lat === null || stop.lng === null) return null;
  return { lat: stop.lat, lng: stop.lng };
}

function pointKey(point: LatLng): string {
  return `${point.lat},${point.lng}`;
}

function uniquePoints(points: LatLng[]): LatLng[] {
  const seen = new Set<string>();
  const result: LatLng[] = [];

  for (const point of points) {
    const key = pointKey(point);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }

  return result;
}

export interface FastPlotPhases {
  collections: LatLng[];
  deliveries: LatLng[];
  other: LatLng[];
}

export type FastPlotOptimizationMode =
  | "anchored-delivery"
  | "anchored-collection"
  | "independent";

/** Select Fast Plot optimization semantics before applying matrix limits.

    Shared endpoints are special even when the anchored matrix would be too
    large. This prevents a 10+1 route from silently falling back to an
    unanchored 10-point optimization. */
export function fastPlotOptimizationMode(
  collectionCount: number,
  deliveryCount: number
): FastPlotOptimizationMode {
  if (collectionCount >= 2 && deliveryCount === 1) {
    return "anchored-delivery";
  }

  if (collectionCount === 1 && deliveryCount >= 2) {
    return "anchored-collection";
  }

  return "independent";
}

/** Build independently orderable Fast Plot phases.

    Deduplication happens inside each phase here. The final join performs a
    second global dedupe so a coordinate that appears in more than one phase
    is still plotted only once. */
export function fastPlotPhases(jobs: PlanJob[]): FastPlotPhases {
  const collections: LatLng[] = [];
  const deliveries: LatLng[] = [];
  const other: LatLng[] = [];

  for (const job of jobs) {
    for (const stop of sortedStops(job)) {
      const point = stopPoint(stop);
      if (!point) continue;

      const type = stop.type?.trim().toLowerCase();

      if (type === "collection") {
        collections.push(point);
      } else if (type === "delivery") {
        deliveries.push(point);
      } else {
        other.push(point);
      }
    }
  }

  return {
    collections: uniquePoints(collections),
    deliveries: uniquePoints(deliveries),
    other: uniquePoints(other),
  };
}

/** Join Fast Plot phases into the actual vehicle journey. */
export function fastPlotWaypointsFromPhases(
  phases: FastPlotPhases
): LatLng[] {
  return uniquePoints([
    ...phases.collections,
    ...phases.deliveries,
    ...phases.other,
  ]);
}

/** Apply an optimizer result only when it is a complete permutation.

    Invalid optimizer output must never delete, duplicate or invent a routing
    point, so the safe fallback is always the original phase order. */
export function reorderFastPlotPhase(
  points: LatLng[],
  order: number[]
): LatLng[] {
  if (
    order.length !== points.length ||
    new Set(order).size !== points.length ||
    order.some(
      (index) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index >= points.length
    )
  ) {
    return points.slice();
  }

  return order.map((index) => points[index]);
}

/** Fast Plot builds one vehicle journey rather than replaying every job as a
    separate collection-to-delivery trip.

    Collection stops are visited first and delivery stops second. Shared
    endpoints are emitted once, so ten collections for the same delivery do
    not send the vehicle back to that delivery ten times.

    Unknown stop types retain their lane/stop order after the typed phases,
    rather than being silently discarded. Stops without coordinates are
    omitted from the plotted route; their jobs remain on the Planning board. */
export function fastPlotWaypoints(jobs: PlanJob[]): LatLng[] {
  return fastPlotWaypointsFromPhases(fastPlotPhases(jobs));
}

/** Legacy lane-order expansion retained for callers that need the literal
    job-by-job stop sequence. Planning's vehicle map uses fastPlotWaypoints. */
export function laneWaypoints(jobs: PlanJob[]): LatLng[] {
  return jobs.flatMap(jobWaypoints);
}
