import type { FastPlotVisit } from "./fastPlot";
import type { PlanningServiceStop } from "./physicalItinerary";

export const PLANNING_ITINERARY_SERVICE_SECONDS = 600;

export type PlanningItineraryRpcServiceStop = {
  job_id: string;
  stop_id: string;
  service_seconds: number;
};

export type PlanningItineraryRpcVisit = {
  lat: number;
  lng: number;
  service_stops: PlanningItineraryRpcServiceStop[];
};

export type PendingPlanningItinerary = {
  vehicleId: string;
  driverId: string | null;
  orderedVisits: FastPlotVisit[];
  serviceStops: PlanningServiceStop[];
};

export function buildPlanningItineraryRpcVisits(
  orderedVisits: FastPlotVisit[],
  serviceStops: PlanningServiceStop[]
): PlanningItineraryRpcVisit[] {
  if (orderedVisits.length === 0) {
    throw new Error("Canonical itinerary must contain at least one physical visit.");
  }

  const visits: PlanningItineraryRpcVisit[] = orderedVisits.map((visit) => {
    if (
      !Number.isFinite(visit.point.lat) ||
      !Number.isFinite(visit.point.lng)
    ) {
      throw new Error("Canonical itinerary contains an invalid physical point.");
    }

    return {
      lat: visit.point.lat,
      lng: visit.point.lng,
      service_stops: [],
    };
  });

  const seenStops = new Set<string>();

  for (const [index, service] of serviceStops.entries()) {
    if (service.serviceSequenceNumber !== index + 1) {
      throw new Error("Canonical service sequence is not contiguous.");
    }

    const visitIndex = service.visitSequenceNumber - 1;
    const visit = visits[visitIndex];

    if (!visit) {
      throw new Error(
        `Canonical service ${service.stopId} references an unknown physical visit.`
      );
    }

    if (
      service.visitServiceOrder !== visit.service_stops.length + 1
    ) {
      throw new Error(
        `Canonical visit ${service.visitSequenceNumber} service order is not contiguous.`
      );
    }

    if (service.serviceSeconds !== PLANNING_ITINERARY_SERVICE_SECONDS) {
      throw new Error(
        `Canonical service ${service.stopId} must consume 600 seconds.`
      );
    }

    if (seenStops.has(service.stopId)) {
      throw new Error(
        `Canonical service stop ${service.stopId} appears more than once.`
      );
    }

    seenStops.add(service.stopId);
    visit.service_stops.push({
      job_id: service.jobId,
      stop_id: service.stopId,
      service_seconds: PLANNING_ITINERARY_SERVICE_SECONDS,
    });
  }

  const emptyVisitIndex = visits.findIndex(
    (visit) => visit.service_stops.length === 0
  );

  if (emptyVisitIndex !== -1) {
    throw new Error(
      `Canonical physical visit ${emptyVisitIndex + 1} contains no service stops.`
    );
  }

  return visits;
}


export type PersistedPlanningItinerary = {
  vehicleId: string;
  driverId: string | null;
  orderedVisits: FastPlotVisit[];
  serviceStops: PlanningServiceStop[];
};

type PersistedItineraryRow = {
  id: string;
  vehicle_id: string;
  driver_id: string | null;
};

type PersistedVisitRow = {
  id: string;
  itinerary_id: string;
  sequence_number: number;
  lat: number;
  lng: number;
};

type PersistedServiceRow = {
  itinerary_id: string;
  visit_id: string;
  service_sequence_number: number;
  visit_service_order: number;
  job_id: string;
  stop_id: string;
  service_seconds: number;
};

type PlanningJobForPersistence = {
  id: string;
  vehicle_id?: string | null;
  stops: Array<{
    id: string;
    stop_order: number;
  }>;
};

export function parsePersistedPlanningItineraries(
  itineraryRows: PersistedItineraryRow[],
  visitRows: PersistedVisitRow[],
  serviceRows: PersistedServiceRow[],
  jobs: PlanningJobForPersistence[]
): Record<string, PersistedPlanningItinerary> {
  const jobById = new Map(jobs.map((job) => [job.id, job] as const));
  const result: Record<string, PersistedPlanningItinerary> = {};

  for (const itinerary of itineraryRows) {
    const visits = visitRows
      .filter((visit) => visit.itinerary_id === itinerary.id)
      .sort((a, b) => a.sequence_number - b.sequence_number);

    if (visits.length === 0) continue;

    if (
      visits.some(
        (visit, index) =>
          visit.sequence_number !== index + 1 ||
          !Number.isFinite(visit.lat) ||
          !Number.isFinite(visit.lng)
      )
    ) {
      continue;
    }

    const visitIndexById = new Map(
      visits.map((visit, index) => [visit.id, index] as const)
    );

    const services = serviceRows
      .filter((service) => service.itinerary_id === itinerary.id)
      .sort(
        (a, b) =>
          a.service_sequence_number - b.service_sequence_number
      );

    if (services.length === 0) continue;

    const requirementsByVisit = visits.map(
      () => ({} as Record<string, number[]>)
    );

    const canonicalServices: PlanningServiceStop[] = [];
    const seenStops = new Set<string>();
    let valid = true;

    for (const [index, service] of services.entries()) {
      if (
        service.service_sequence_number !== index + 1 ||
        service.service_seconds !== PLANNING_ITINERARY_SERVICE_SECONDS ||
        seenStops.has(service.stop_id)
      ) {
        valid = false;
        break;
      }

      const visitIndex = visitIndexById.get(service.visit_id);
      const job = jobById.get(service.job_id);

      if (
        visitIndex === undefined ||
        !job ||
        job.vehicle_id !== itinerary.vehicle_id
      ) {
        valid = false;
        break;
      }

      const sortedStops = [...job.stops].sort(
        (a, b) => a.stop_order - b.stop_order
      );
      const stopIndex = sortedStops.findIndex(
        (stop) => stop.id === service.stop_id
      );

      if (stopIndex === -1) {
        valid = false;
        break;
      }

      const visitServiceCount = canonicalServices.filter(
        (candidate) =>
          candidate.visitSequenceNumber === visitIndex + 1
      ).length;

      if (service.visit_service_order !== visitServiceCount + 1) {
        valid = false;
        break;
      }

      const requirements = requirementsByVisit[visitIndex];
      (requirements[service.job_id] ??= []).push(stopIndex);

      canonicalServices.push({
        serviceSequenceNumber: service.service_sequence_number,
        visitSequenceNumber: visitIndex + 1,
        visitServiceOrder: service.visit_service_order,
        jobId: service.job_id,
        stopId: service.stop_id,
        stopIndex,
        stopOrder: sortedStops[stopIndex].stop_order,
        serviceSeconds: service.service_seconds,
      });

      seenStops.add(service.stop_id);
    }

    if (!valid) continue;

    const laneJobs = jobs.filter(
      (job) => job.vehicle_id === itinerary.vehicle_id
    );

    const expectedStopIds = new Set(
      laneJobs.flatMap((job) => job.stops.map((stop) => stop.id))
    );

    if (
      expectedStopIds.size !== seenStops.size ||
      [...expectedStopIds].some((stopId) => !seenStops.has(stopId))
    ) {
      continue;
    }

    const orderedVisits: FastPlotVisit[] = visits.map(
      (visit, index) => ({
        key: `persisted:${visit.id}`,
        point: { lat: visit.lat, lng: visit.lng },
        requirements: requirementsByVisit[index],
      })
    );

    // Reuse the same strict outbound validator for contiguous service order,
    // visit membership and the fixed 600-second service invariant.
    try {
      buildPlanningItineraryRpcVisits(
        orderedVisits,
        canonicalServices
      );
    } catch {
      continue;
    }

    result[itinerary.vehicle_id] = {
      vehicleId: itinerary.vehicle_id,
      driverId: itinerary.driver_id,
      orderedVisits,
      serviceStops: canonicalServices,
    };
  }

  return result;
}
