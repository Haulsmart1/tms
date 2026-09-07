export const PLANNING_DRAFT_VERSION = 1 as const;
export const PLANNING_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export type PlanningDraft = {
  version: typeof PLANNING_DRAFT_VERSION;
  tenantId: string;
  date: string;
  updatedAt: number;
  laneOrders: Record<string, string[]>;
  laneDrivers: Record<string, string | null>;
  selectedVehicleId: string | null;
};

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

  return {
    version: PLANNING_DRAFT_VERSION,
    tenantId: context.tenantId,
    date: context.date,
    updatedAt,
    laneOrders,
    laneDrivers,
    selectedVehicleId,
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
