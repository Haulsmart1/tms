import {
  jobsInFastPlotOrder,
  optimizeFastPlotOrderFromStart,
  type FastPlotCostLoader,
  type FastPlotVisit,
} from "./fastPlot";
import {
  buildPlanningPhysicalItinerary,
  type PlanningServiceStop,
} from "./physicalItinerary";
import type { LatLng, PlanJob, PlanStop } from "./types";
import { isRoutable } from "./waypoints";

export const DRIVER_STOP_SERVICE_SECONDS = 10 * 60;

export type DriverAwareRouteResult =
  | {
      ok: true;
      jobs: PlanJob[];
      physicalRoute: LatLng[];
      orderedVisits: FastPlotVisit[];
      serviceStops: PlanningServiceStop[];
      firstJobId: string;
      firstTravelSeconds: number;
      totalServiceSeconds: number;
    }
  | {
      ok: false;
      reason:
        | "no_jobs"
        | "no_routable_jobs"
        | "no_reachable_first_job"
        | "route_cost_unavailable"
        | "unsupported_physical_route";
    };

export type DriverScheduleStopTask = {
  id: string;
  jobId: string;
  locationId: string;
  point: LatLng;
  type: string | null;
  serviceSeconds: number;
  precedenceIds: string[];
};

function stopPoint(stop: PlanStop): LatLng | null {
  if (
    typeof stop.lat !== "number" ||
    typeof stop.lng !== "number" ||
    !Number.isFinite(stop.lat) ||
    !Number.isFinite(stop.lng)
  ) {
    return null;
  }

  return { lat: stop.lat, lng: stop.lng };
}

function orderedStops(job: PlanJob): PlanStop[] {
  return [...job.stops].sort((left, right) => {
    if (left.stop_order !== right.stop_order) {
      return left.stop_order - right.stop_order;
    }

    return left.id.localeCompare(right.id);
  });
}

export async function optimizeDriverAwareJobOrder(input: {
  jobs: PlanJob[];
  vanPosition: LatLng;
  loadCosts: FastPlotCostLoader;
}): Promise<DriverAwareRouteResult> {
  if (input.jobs.length === 0) {
    return { ok: false, reason: "no_jobs" };
  }

  const routableJobs = input.jobs.filter(isRoutable);

  if (routableJobs.length === 0) {
    return { ok: false, reason: "no_routable_jobs" };
  }

  const optimized = await optimizeFastPlotOrderFromStart(
    routableJobs,
    input.vanPosition,
    input.loadCosts,
  );

  if (!optimized.ok) {
    switch (optimized.reason) {
      case "no_reachable_first_visit":
        return { ok: false, reason: "no_reachable_first_job" };
      case "unsupported_physical_route":
        return { ok: false, reason: "unsupported_physical_route" };
      case "no_routable_visits":
        return { ok: false, reason: "no_routable_jobs" };
      case "start_cost_unavailable":
      case "route_cost_unavailable":
        return { ok: false, reason: "route_cost_unavailable" };
    }
  }

  const itinerary = buildPlanningPhysicalItinerary(
    routableJobs,
    optimized.orderedVisits,
  );

  const firstServiceStop = itinerary.serviceStops[0];

  if (!firstServiceStop) {
    return { ok: false, reason: "no_routable_jobs" };
  }

  // Keep the legacy job list for existing consumers only. The physical
  // itinerary is the canonical source of route and service ordering.
  const orderedIds = jobsInFastPlotOrder(
    input.jobs,
    optimized.route,
  );
  const jobsById = new Map(
    input.jobs.map((job) => [job.id, job] as const),
  );
  const jobs = orderedIds
    .map((id) => jobsById.get(id))
    .filter((job): job is PlanJob => job !== undefined);

  return {
    ok: true,
    jobs,
    physicalRoute: itinerary.visits.map((visit) => visit.point),
    orderedVisits: optimized.orderedVisits,
    serviceStops: itinerary.serviceStops,
    firstJobId: firstServiceStop.jobId,
    firstTravelSeconds: optimized.firstTravelSeconds,
    totalServiceSeconds: itinerary.totalServiceSeconds,
  };
}

/**
 * Build per-stop service tasks in deterministic job/stop order.
 *
 * This helper intentionally does not claim to encode an interleaved physical
 * Fast Plot route. The scheduler-integration patch will map physical route
 * occurrences to globally chained tasks. Every valid physical collection or
 * delivery still contributes ten minutes of service/work here.
 */
export type DriverPhysicalTaskBuildResult =
  | {
      ok: true;
      tasks: DriverScheduleStopTask[];
    }
  | {
      ok: false;
      reason: "physical_route_mismatch";
      remainingStopIds: string[];
    };

function samePoint(left: LatLng, right: LatLng): boolean {
  return left.lat === right.lat && left.lng === right.lng;
}

/**
 * Map the optimized physical route to every routable service occurrence.
 *
 * Tasks are globally chained so the driver scheduler cannot reorder the
 * physical route. Jobs with incomplete coordinates are intentionally excluded
 * from this physical schedule rather than having travel invented for them.
 */
export function buildDriverScheduleStopTasksFromRoute(
  jobs: PlanJob[],
  physicalRoute: LatLng[],
): DriverPhysicalTaskBuildResult {
  const routableJobs = jobs.filter(isRoutable);
  const stopsByJob = new Map(
    routableJobs.map((job) => [job.id, orderedStops(job)] as const),
  );
  const progress = new Map<string, number>(
    routableJobs.map((job) => [job.id, 0] as const),
  );
  const tasks: DriverScheduleStopTask[] = [];
  let previousTaskId: string | null = null;

  for (const routePoint of physicalRoute) {
    let advanced = true;

    while (advanced) {
      advanced = false;

      for (const job of routableJobs) {
        const stops = stopsByJob.get(job.id) ?? [];
        const index = progress.get(job.id) ?? 0;
        const stop = stops[index];

        if (!stop) continue;

        const point = stopPoint(stop);

        if (!point || !samePoint(point, routePoint)) {
          continue;
        }

        const taskId = `stop:${stop.id}`;

        tasks.push({
          id: taskId,
          jobId: job.id,
          locationId: `location:${point.lat},${point.lng}`,
          point,
          type: stop.type ?? null,
          serviceSeconds: DRIVER_STOP_SERVICE_SECONDS,
          precedenceIds: previousTaskId ? [previousTaskId] : [],
        });

        previousTaskId = taskId;
        progress.set(job.id, index + 1);
        advanced = true;
      }
    }
  }

  const remainingStopIds: string[] = [];

  for (const job of routableJobs) {
    const stops = stopsByJob.get(job.id) ?? [];
    const index = progress.get(job.id) ?? 0;

    for (const stop of stops.slice(index)) {
      remainingStopIds.push(stop.id);
    }
  }

  if (remainingStopIds.length > 0) {
    return {
      ok: false,
      reason: "physical_route_mismatch",
      remainingStopIds,
    };
  }

  return { ok: true, tasks };
}

/**
 * Build scheduler tasks directly from the canonical physical itinerary.
 *
 * Service order comes exclusively from serviceSequenceNumber. Job ordering is
 * used only to resolve stop metadata and to detect omitted routable stops.
 */
export function buildDriverScheduleStopTasksFromItinerary(
  jobs: PlanJob[],
  orderedVisits: FastPlotVisit[],
  serviceStops: PlanningServiceStop[],
): DriverPhysicalTaskBuildResult {
  const routableJobs = jobs.filter(isRoutable);
  const jobsById = new Map(
    routableJobs.map((job) => [job.id, job] as const),
  );
  const stopsById = new Map(
    routableJobs.flatMap((job) =>
      orderedStops(job).map((stop) => [
        stop.id,
        { jobId: job.id, stop },
      ] as const),
    ),
  );

  const seenStopIds = new Set<string>();
  const tasks: DriverScheduleStopTask[] = [];
  let previousTaskId: string | null = null;

  for (const [index, service] of serviceStops.entries()) {
    if (service.serviceSequenceNumber !== index + 1) {
      throw new Error(
        `Canonical service sequence is not contiguous at ${service.serviceSequenceNumber}.`,
      );
    }

    const visit = orderedVisits[service.visitSequenceNumber - 1];
    if (!visit) {
      throw new Error(
        `Canonical service ${service.stopId} references missing visit ${service.visitSequenceNumber}.`,
      );
    }

    const job = jobsById.get(service.jobId);
    if (!job) {
      throw new Error(
        `Canonical service ${service.stopId} references unknown routable job ${service.jobId}.`,
      );
    }

    const resolved = stopsById.get(service.stopId);
    if (!resolved || resolved.jobId !== service.jobId) {
      throw new Error(
        `Canonical service ${service.stopId} does not belong to job ${service.jobId}.`,
      );
    }

    const stops = orderedStops(job);
    if (stops[service.stopIndex]?.id !== service.stopId) {
      throw new Error(
        `Canonical service ${service.stopId} has invalid stop index ${service.stopIndex}.`,
      );
    }

    if (seenStopIds.has(service.stopId)) {
      throw new Error(
        `Canonical service stop ${service.stopId} appears more than once.`,
      );
    }

    const taskId = `stop:${service.stopId}`;
    const point = visit.point;

    tasks.push({
      id: taskId,
      jobId: service.jobId,
      locationId: `location:${point.lat},${point.lng}`,
      point,
      type: resolved.stop.type ?? null,
      serviceSeconds: service.serviceSeconds,
      precedenceIds: previousTaskId ? [previousTaskId] : [],
    });

    seenStopIds.add(service.stopId);
    previousTaskId = taskId;
  }

  const remainingStopIds = routableJobs.flatMap((job) =>
    orderedStops(job)
      .filter((stop) => !seenStopIds.has(stop.id))
      .map((stop) => stop.id),
  );

  if (remainingStopIds.length > 0) {
    return {
      ok: false,
      reason: "physical_route_mismatch",
      remainingStopIds,
    };
  }

  return { ok: true, tasks };
}

export function buildDriverScheduleStopTasks(
  jobs: PlanJob[],
): DriverScheduleStopTask[] {
  const tasks: DriverScheduleStopTask[] = [];

  for (const job of jobs) {
    let previousTaskId: string | null = null;

    for (const stop of orderedStops(job)) {
      const point = stopPoint(stop);

      if (!point) continue;

      const taskId = `stop:${stop.id}`;

      tasks.push({
        id: taskId,
        jobId: job.id,
        locationId: `location:${point.lat},${point.lng}`,
        point,
        type: stop.type ?? null,
        serviceSeconds: DRIVER_STOP_SERVICE_SECONDS,
        precedenceIds: previousTaskId ? [previousTaskId] : [],
      });

      previousTaskId = taskId;
    }
  }

  return tasks;
}
