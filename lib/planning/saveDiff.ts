import type { PlanJob } from "./types";

export type LanePlan = {
  vehicleId: string;
  driverId: string | null;
  /** Job ids in running order. Position in this array IS the route_order. */
  jobIds: string[];
};

export type JobUpdate = {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  route_order: number | null;
  planning_date?: string | null;
};

/* What Save actually writes: one update per job whose assignment changed,
   compared field-by-field against what was loaded. Unassigning clears all
   three columns; the driver is deliberately included so a job dragged out of
   a lane does not keep a driver it no longer rides with. Jobs in neither a
   lane nor the unassigned list (the subcontracted ones) are untouched.

   Precondition: lanes and unassignedJobIds are disjoint and no id repeats.
   The page upholds this by construction (the pool is derived as "jobs in no
   lane"); if it were ever violated, the later write wins silently. */
export function computeSaveDiff(
  original: PlanJob[],
  lanes: LanePlan[],
  unassignedJobIds: string[],
  planningDate?: string
): JobUpdate[] {
  const target = new Map<string, JobUpdate>();
  for (const lane of lanes) {
    lane.jobIds.forEach((id, index) => {
      target.set(id, {
        id,
        vehicle_id: lane.vehicleId,
        driver_id: lane.driverId,
        route_order: index + 1,
        ...(planningDate === undefined ? {} : { planning_date: planningDate }),
      });
    });
  }
  for (const id of unassignedJobIds) {
    target.set(id, { id, vehicle_id: null, driver_id: null, route_order: null });
  }

  const updates: JobUpdate[] = [];
  for (const job of original) {
    const t = target.get(job.id);
    if (!t) continue;
    // Unassignment preserves the operational day; only a lane schedules work.
    if (planningDate !== undefined && !("planning_date" in t)) {
      t.planning_date = job.planning_date ?? null;
    }
    if (
      t.vehicle_id !== job.vehicle_id ||
      t.driver_id !== job.driver_id ||
      t.route_order !== job.route_order ||
      (planningDate !== undefined && t.planning_date !== (job.planning_date ?? null))
    ) {
      updates.push(t);
    }
  }
  return updates;
}
