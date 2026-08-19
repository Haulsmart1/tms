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
  unassignedJobIds: string[]
): JobUpdate[] {
  const target = new Map<string, JobUpdate>();
  for (const lane of lanes) {
    lane.jobIds.forEach((id, index) => {
      target.set(id, {
        id,
        vehicle_id: lane.vehicleId,
        driver_id: lane.driverId,
        route_order: index + 1,
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
    if (
      t.vehicle_id !== job.vehicle_id ||
      t.driver_id !== job.driver_id ||
      t.route_order !== job.route_order
    ) {
      updates.push(t);
    }
  }
  return updates;
}
