import type {
  PendingPlanningItinerary,
  PersistedPlanningItinerary,
} from "./itineraryPersistence";

export const SAVED_PLAN_SNAPSHOT_VERSION = 1 as const;

export type SavedPlanLaneSnapshot = {
  vehicleId: string;
  driverId: string | null;
  jobIds: string[];
};

export type SavedPlanVisitSnapshot = {
  sequenceNumber: number;
  key: string;
  lat: number;
  lng: number;
  requirements: Record<string, number[]>;
};

export type SavedPlanServiceSnapshot = {
  jobId: string;
  stopId: string;
  visitSequenceNumber: number;
  serviceSequenceNumber: number;
  visitServiceOrder: number;
  stopIndex: number;
  stopOrder: number;
  serviceSeconds: number;
};

export type SavedPlanCanonicalSnapshot = {
  vehicleId: string;
  driverId: string | null;
  visits: SavedPlanVisitSnapshot[];
  services: SavedPlanServiceSnapshot[];
};

export type SavedPlanSnapshot = {
  version: typeof SAVED_PLAN_SNAPSHOT_VERSION;
  planningDate: string;
  lanes: SavedPlanLaneSnapshot[];
  canonicalItineraries: SavedPlanCanonicalSnapshot[];
};

export type SavedPlanRow = {
  id: string;
  tenant_id: string;
  planning_date: string;
  name: string;
  snapshot: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SavedPlanSummary = {
  id: string;
  planningDate: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type CanonicalSource =
  | PendingPlanningItinerary
  | PersistedPlanningItinerary;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0;
}

function isFiniteCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isLane(value: unknown): value is SavedPlanLaneSnapshot {
  if (!isRecord(value)) return false;

  return (
    isNonEmptyString(value.vehicleId) &&
    isNullableString(value.driverId) &&
    Array.isArray(value.jobIds) &&
    value.jobIds.every(isNonEmptyString) &&
    new Set(value.jobIds).size === value.jobIds.length
  );
}

function isVisit(value: unknown): value is SavedPlanVisitSnapshot {
  if (!isRecord(value) || !isRecord(value.requirements)) return false;

  const requirementsValid = Object.entries(value.requirements).every(
    ([jobId, stopIndexes]) =>
      isNonEmptyString(jobId) &&
      Array.isArray(stopIndexes) &&
      stopIndexes.every(
        (stopIndex) =>
          typeof stopIndex === "number" &&
          Number.isInteger(stopIndex) &&
          stopIndex >= 0,
      ),
  );

  return (
    isPositiveInteger(value.sequenceNumber) &&
    isNonEmptyString(value.key) &&
    isFiniteCoordinate(value.lat, -90, 90) &&
    isFiniteCoordinate(value.lng, -180, 180) &&
    requirementsValid
  );
}

function isService(value: unknown): value is SavedPlanServiceSnapshot {
  if (!isRecord(value)) return false;

  return (
    isNonEmptyString(value.jobId) &&
    isNonEmptyString(value.stopId) &&
    isPositiveInteger(value.visitSequenceNumber) &&
    isPositiveInteger(value.serviceSequenceNumber) &&
    isPositiveInteger(value.visitServiceOrder) &&
    typeof value.stopIndex === "number" &&
    Number.isInteger(value.stopIndex) &&
    value.stopIndex >= 0 &&
    isPositiveInteger(value.stopOrder) &&
    value.serviceSeconds === 600
  );
}

function isCanonical(
  value: unknown,
): value is SavedPlanCanonicalSnapshot {
  if (!isRecord(value)) return false;

  if (
    !isNonEmptyString(value.vehicleId) ||
    !isNullableString(value.driverId) ||
    !Array.isArray(value.visits) ||
    !value.visits.every(isVisit) ||
    !Array.isArray(value.services) ||
    !value.services.every(isService)
  ) {
    return false;
  }

  if (value.visits.length === 0 || value.services.length === 0) {
    return false;
  }

  const visitNumbers = value.visits.map((visit) => visit.sequenceNumber);
  const serviceNumbers = value.services.map(
    (service) => service.serviceSequenceNumber,
  );

  if (
    new Set(visitNumbers).size !== visitNumbers.length ||
    new Set(serviceNumbers).size !== serviceNumbers.length
  ) {
    return false;
  }

  const knownVisits = new Set(visitNumbers);

  return value.services.every((service) =>
    knownVisits.has(service.visitSequenceNumber)
  );
}

export function parseSavedPlanSnapshot(
  value: unknown,
): SavedPlanSnapshot | null {
  if (!isRecord(value)) return null;

  if (
    value.version !== SAVED_PLAN_SNAPSHOT_VERSION ||
    typeof value.planningDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.planningDate) ||
    !Array.isArray(value.lanes) ||
    !value.lanes.every(isLane) ||
    !Array.isArray(value.canonicalItineraries) ||
    !value.canonicalItineraries.every(isCanonical)
  ) {
    return null;
  }

  const vehicleIds = value.lanes.map((lane) => lane.vehicleId);
  if (new Set(vehicleIds).size !== vehicleIds.length) return null;

  const allJobIds = value.lanes.flatMap((lane) => lane.jobIds);
  if (new Set(allJobIds).size !== allJobIds.length) return null;

  const canonicalVehicleIds = value.canonicalItineraries.map(
    (itinerary) => itinerary.vehicleId,
  );

  if (
    new Set(canonicalVehicleIds).size !== canonicalVehicleIds.length ||
    canonicalVehicleIds.some((vehicleId) => !vehicleIds.includes(vehicleId))
  ) {
    return null;
  }

  return value as SavedPlanSnapshot;
}

function canonicalToSnapshot(
  itinerary: CanonicalSource,
): SavedPlanCanonicalSnapshot {
  return {
    vehicleId: itinerary.vehicleId,
    driverId: itinerary.driverId,
    visits: itinerary.orderedVisits.map((visit, index) => ({
      sequenceNumber: index + 1,
      key: visit.key,
      lat: visit.point.lat,
      lng: visit.point.lng,
      requirements: Object.fromEntries(
        Object.entries(visit.requirements).map(([jobId, stopIndexes]) => [
          jobId,
          [...stopIndexes],
        ]),
      ),
    })),
    services: itinerary.serviceStops.map((service) => ({
      jobId: service.jobId,
      stopId: service.stopId,
      visitSequenceNumber: service.visitSequenceNumber,
      serviceSequenceNumber: service.serviceSequenceNumber,
      visitServiceOrder: service.visitServiceOrder,
      stopIndex: service.stopIndex,
      stopOrder: service.stopOrder,
      serviceSeconds: service.serviceSeconds,
    })),
  };
}

export function createSavedPlanSnapshot(input: {
  planningDate: string;
  lanes: SavedPlanLaneSnapshot[];
  pendingItineraries: Record<string, PendingPlanningItinerary>;
  persistedItineraries: Record<string, PersistedPlanningItinerary>;
}): SavedPlanSnapshot {
  const canonicalByVehicle = new Map<string, CanonicalSource>();

  for (const itinerary of Object.values(input.persistedItineraries)) {
    canonicalByVehicle.set(itinerary.vehicleId, itinerary);
  }

  // Unsaved Smart Optimize work is newer than the persisted canonical route.
  for (const itinerary of Object.values(input.pendingItineraries)) {
    canonicalByVehicle.set(itinerary.vehicleId, itinerary);
  }

  const laneVehicleIds = new Set(input.lanes.map((lane) => lane.vehicleId));

  const snapshot: SavedPlanSnapshot = {
    version: SAVED_PLAN_SNAPSHOT_VERSION,
    planningDate: input.planningDate,
    lanes: input.lanes.map((lane) => ({
      vehicleId: lane.vehicleId,
      driverId: lane.driverId,
      jobIds: [...lane.jobIds],
    })),
    canonicalItineraries: [...canonicalByVehicle.values()]
      .filter((itinerary) => laneVehicleIds.has(itinerary.vehicleId))
      .map(canonicalToSnapshot),
  };

  const parsed = parseSavedPlanSnapshot(snapshot);

  if (!parsed) {
    throw new Error("The current planning board cannot be saved as a snapshot.");
  }

  return parsed;
}

export function savedPlanSnapshotToPendingItineraries(
  snapshot: SavedPlanSnapshot,
): Record<string, PendingPlanningItinerary> {
  return Object.fromEntries(
    snapshot.canonicalItineraries.map((itinerary) => [
      itinerary.vehicleId,
      {
        vehicleId: itinerary.vehicleId,
        driverId: itinerary.driverId,
        orderedVisits: itinerary.visits
          .slice()
          .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
          .map((visit) => ({
            key: visit.key,
            point: {
              lat: visit.lat,
              lng: visit.lng,
            },
            requirements: Object.fromEntries(
              Object.entries(visit.requirements).map(
                ([jobId, stopIndexes]) => [jobId, [...stopIndexes]],
              ),
            ),
          })),
        serviceStops: itinerary.services
          .slice()
          .sort(
            (a, b) =>
              a.serviceSequenceNumber - b.serviceSequenceNumber,
          )
          .map((service) => ({
            jobId: service.jobId,
            stopId: service.stopId,
            stopIndex: service.stopIndex,
            stopOrder: service.stopOrder,
            visitSequenceNumber: service.visitSequenceNumber,
            serviceSequenceNumber: service.serviceSequenceNumber,
            visitServiceOrder: service.visitServiceOrder,
            serviceSeconds: service.serviceSeconds,
          })),
      },
    ]),
  );
}
export function savedPlanSummary(row: SavedPlanRow): SavedPlanSummary {
  return {
    id: row.id,
    planningDate: row.planning_date,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}