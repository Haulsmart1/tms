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

/** Waypoints for one vehicle's day: jobs in lane order, stops in stop_order,
    unroutable jobs skipped. */
export function laneWaypoints(jobs: PlanJob[]): LatLng[] {
  return jobs.flatMap(jobWaypoints);
}
