import type { PlanJob, PlanStop } from "./types";

/** The free-text query sent to TomTom for one stop. address_line is NOT NULL
    in the schema but city and postcode are nullable, and JobForm also saves
    blank strings, so both cases are dropped rather than sending ", ," noise
    that degrades geocoder accuracy. */
export function geocodeQuery(
  stop: Pick<PlanStop, "address_line" | "city" | "postcode">
): string {
  return [stop.address_line, stop.city, stop.postcode]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(", ");
}

/** Ids of every stop across the listed jobs still missing coordinates. The
    geocode API route is only ever called with these, which is what makes the
    cache a cache: a geocoded stop is never sent again. */
export function stopsNeedingGeocode(jobs: PlanJob[]): string[] {
  return jobs.flatMap((job) =>
    job.stops.filter((s) => s.lat === null || s.lng === null).map((s) => s.id)
  );
}
