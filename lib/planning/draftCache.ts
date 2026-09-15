/* Version 2 adds `baseline` (review PLAN-11). A version 1 draft carries no
   record of the server plan it was made against, so it cannot be shown to be
   safe to restore and is ignored. */
export const PLANNING_DRAFT_VERSION = 2 as const;
export const PLANNING_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** A job's saved assignment: vehicle id, driver id, route order. */
export type PlanningDraftAssignment = [
  string | null,
  string | null,
  number | null,
];

export type PlanningDraft = {
  version: typeof PLANNING_DRAFT_VERSION;
  tenantId: string;
  date: string;
  updatedAt: number;
  laneOrders: Record<string, string[]>;
  laneDrivers: Record<string, string | null>;
  selectedVehicleId: string | null;
  /**
   * The server assignment of every job when the draft was written. Restoring
   * is only safe while the server still matches it; otherwise the draft would
   * overwrite someone else's newer plan.
   */
  baseline: Record<string, PlanningDraftAssignment>;
};

type AssignmentFacts = {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  route_order: number | null;
};

export function planningDraftBaseline(
  jobs: AssignmentFacts[]
): Record<string, PlanningDraftAssignment> {
  const baseline: Record<string, PlanningDraftAssignment> = {};

  for (const job of jobs) {
    baseline[job.id] = [job.vehicle_id, job.driver_id, job.route_order];
  }

  return baseline;
}

/**
 * True when the server plan has changed since the draft was written: some
 * job's current assignment differs from the draft's baseline, including a job
 * the draft never saw that is now assigned. A stale draft must not be offered
 * for restore (review PLAN-11).
 */
export function planningDraftIsStale(
  draft: PlanningDraft,
  currentJobs: AssignmentFacts[]
): boolean {
  return currentJobs.some((job) => {
    const [vehicleId, driverId, routeOrder] =
      draft.baseline[job.id] ?? [null, null, null];

    return (
      vehicleId !== job.vehicle_id ||
      driverId !== job.driver_id ||
      routeOrder !== job.route_order
    );
  });
}

function isAssignment(value: unknown): value is PlanningDraftAssignment {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    (value[0] === null || typeof value[0] === "string") &&
    (value[1] === null || typeof value[1] === "string") &&
    (value[2] === null ||
      (typeof value[2] === "number" && Number.isFinite(value[2])))
  );
}

type DraftInput = Omit<PlanningDraft, "version">;

type ParseContext = {
  tenantId: string;
  date: string;
  validVehicleIds: Set<string>;
  validJobIds: Set<string>;
  validDriverIds: Set<string>;
  now: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function planningDraftStorageKey(
  tenantId: string,
  date: string
): string {
  return `tms:planning-draft:v1:${tenantId}:${date}`;
}

export function createPlanningDraft(input: DraftInput): PlanningDraft {
  return {
    version: PLANNING_DRAFT_VERSION,
    ...input,
  };
}

export function parsePlanningDraft(
  raw: string | null,
  context: ParseContext
): PlanningDraft | null {
  if (!raw || raw.length > 2_000_000) return null;

  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value)) return null;
  if (value.version !== PLANNING_DRAFT_VERSION) return null;
  if (value.tenantId !== context.tenantId) return null;
  if (value.date !== context.date) return null;

  const updatedAt = value.updatedAt;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  if (updatedAt > context.now + FUTURE_TOLERANCE_MS) return null;
  if (context.now - updatedAt > PLANNING_DRAFT_MAX_AGE_MS) return null;

  if (!isRecord(value.laneOrders) || !isRecord(value.laneDrivers)) {
    return null;
  }

  const laneOrders: Record<string, string[]> = {};
  const seenJobs = new Set<string>();

  for (const [vehicleId, rawJobIds] of Object.entries(value.laneOrders)) {
    if (!context.validVehicleIds.has(vehicleId) || !Array.isArray(rawJobIds)) {
      return null;
    }

    const jobIds: string[] = [];

    for (const jobId of rawJobIds) {
      if (
        typeof jobId !== "string" ||
        !context.validJobIds.has(jobId) ||
        seenJobs.has(jobId)
      ) {
        return null;
      }

      seenJobs.add(jobId);
      jobIds.push(jobId);
    }

    laneOrders[vehicleId] = jobIds;
  }

  const laneDrivers: Record<string, string | null> = {};

  for (const [vehicleId, rawDriverId] of Object.entries(value.laneDrivers)) {
    if (!context.validVehicleIds.has(vehicleId)) return null;

    if (rawDriverId === null) {
      laneDrivers[vehicleId] = null;
      continue;
    }

    if (
      typeof rawDriverId !== "string" ||
      !context.validDriverIds.has(rawDriverId)
    ) {
      return null;
    }

    laneDrivers[vehicleId] = rawDriverId;
  }

  const selectedVehicleId = value.selectedVehicleId;

  if (
    selectedVehicleId !== null &&
    (typeof selectedVehicleId !== "string" ||
      !context.validVehicleIds.has(selectedVehicleId))
  ) {
    return null;
  }

  if (!isRecord(value.baseline)) return null;

  const baseline: Record<string, PlanningDraftAssignment> = {};

  for (const [jobId, assignment] of Object.entries(value.baseline)) {
    if (!isAssignment(assignment)) return null;
    baseline[jobId] = [assignment[0], assignment[1], assignment[2]];
  }

  return {
    version: PLANNING_DRAFT_VERSION,
    tenantId: context.tenantId,
    date: context.date,
    updatedAt,
    laneOrders,
    laneDrivers,
    selectedVehicleId,
    baseline,
  };
}

export function planningDraftMatchesPlan(
  draft: PlanningDraft,
  laneOrders: Record<string, string[]>,
  laneDrivers: Record<string, string | null>,
  vehicleIds: string[]
): boolean {
  const orderedVehicleIds = [...vehicleIds].sort();

  for (const vehicleId of orderedVehicleIds) {
    const draftJobs = draft.laneOrders[vehicleId] ?? [];
    const currentJobs = laneOrders[vehicleId] ?? [];

    if (
      draftJobs.length !== currentJobs.length ||
      draftJobs.some((jobId, index) => jobId !== currentJobs[index])
    ) {
      return false;
    }

    if (
      (draft.laneDrivers[vehicleId] ?? null) !==
      (laneDrivers[vehicleId] ?? null)
    ) {
      return false;
    }
  }

  return true;
}
