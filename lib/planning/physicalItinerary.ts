import type { FastPlotVisit } from "./fastPlot";
import type { PlanJob, PlanStop } from "./types";

export const PLANNING_STOP_SERVICE_SECONDS = 10 * 60;

export type PlanningServiceStop = {
  serviceSequenceNumber: number;
  visitSequenceNumber: number;
  visitServiceOrder: number;
  jobId: string;
  stopId: string;
  stopIndex: number;
  stopOrder: number;
  serviceSeconds: number;
};

export type PlanningPhysicalVisit = {
  sequenceNumber: number;
  key: string;
  point: {
    lat: number;
    lng: number;
  };
  serviceStops: PlanningServiceStop[];
};

export type PlanningPhysicalItinerary = {
  visits: PlanningPhysicalVisit[];
  serviceStops: PlanningServiceStop[];
  totalServiceSeconds: number;
};

function sortedStops(job: PlanJob): PlanStop[] {
  return [...job.stops].sort(
    (left, right) =>
      left.stop_order - right.stop_order || left.id.localeCompare(right.id)
  );
}

function orderedRequirements(
  requirements: Record<string, number[]>
): Array<[string, number]> {
  return Object.keys(requirements)
    .sort()
    .flatMap((jobId) =>
      [...requirements[jobId]]
        .sort((left, right) => left - right)
        .map((stopIndex) => [jobId, stopIndex] as [string, number])
    );
}

/**
 * Expands deduplicated Fast Plot locations into canonical service stops.
 * Requirement values are zero-based indexes into each job's sorted stops.
 */
export function buildPlanningPhysicalItinerary(
  jobs: PlanJob[],
  orderedVisits: FastPlotVisit[]
): PlanningPhysicalItinerary {
  const jobLookup = new Map(jobs.map((job) => [job.id, job] as const));
  const completedIndexes = new Map<string, Set<number>>();
  const seenStopIds = new Set<string>();
  const visits: PlanningPhysicalVisit[] = [];
  const serviceStops: PlanningServiceStop[] = [];

  for (const [visitIndex, visit] of orderedVisits.entries()) {
    const visitSequenceNumber = visitIndex + 1;
    const visitServices: PlanningServiceStop[] = [];
    let pending = orderedRequirements(visit.requirements);

    while (pending.length > 0) {
      const nextPending: Array<[string, number]> = [];
      let progressed = false;

      for (const [jobId, stopIndex] of pending) {
        const job = jobLookup.get(jobId);

        if (!job) {
          throw new Error(
            `Fast Plot requirement references unknown job ${jobId}.`
          );
        }

        const stops = sortedStops(job);
        const stop = stops[stopIndex];

        if (!stop) {
          throw new Error(
            `Fast Plot requirement ${jobId}:${stopIndex} does not resolve to a planning stop.`
          );
        }

        const completed =
          completedIndexes.get(jobId) ?? new Set<number>();

        const precedenceSatisfied = Array.from(
          { length: stopIndex },
          (_, index) => index
        ).every((index) => completed.has(index));

        if (!precedenceSatisfied) {
          nextPending.push([jobId, stopIndex]);
          continue;
        }

        if (seenStopIds.has(stop.id)) {
          throw new Error(
            `Planning stop ${stop.id} appears more than once in the physical itinerary.`
          );
        }

        const service: PlanningServiceStop = {
          serviceSequenceNumber: serviceStops.length + 1,
          visitSequenceNumber,
          visitServiceOrder: visitServices.length + 1,
          jobId,
          stopId: stop.id,
          stopIndex,
          stopOrder: stop.stop_order,
          serviceSeconds: PLANNING_STOP_SERVICE_SECONDS,
        };

        visitServices.push(service);
        serviceStops.push(service);
        seenStopIds.add(stop.id);

        const nextCompleted =
          completedIndexes.get(jobId) ?? new Set<number>();

        nextCompleted.add(stopIndex);
        completedIndexes.set(jobId, nextCompleted);
        progressed = true;
      }

      if (!progressed && nextPending.length > 0) {
        const blocked = nextPending
          .map(([jobId, stopIndex]) => `${jobId}:${stopIndex}`)
          .join(", ");

        throw new Error(
          `Physical itinerary violates stop precedence: ${blocked}.`
        );
      }

      pending = nextPending;
    }

    visits.push({
      sequenceNumber: visitSequenceNumber,
      key: visit.key,
      point: visit.point,
      serviceStops: visitServices,
    });
  }

  const expectedStops = jobs.flatMap(sortedStops);

  if (seenStopIds.size !== expectedStops.length) {
    const missing = expectedStops
      .filter((stop) => !seenStopIds.has(stop.id))
      .map((stop) => stop.id);

    throw new Error(
      `Physical itinerary is missing planning stops: ${missing.join(", ")}.`
    );
  }

  return {
    visits,
    serviceStops,
    totalServiceSeconds:
      serviceStops.length * PLANNING_STOP_SERVICE_SECONDS,
  };
}
