import { describe, expect, it } from "vitest";
import { computeSaveDiff, type LanePlan } from "./saveDiff";
import type { PlanJob } from "./types";

function job(overrides: Partial<PlanJob>): PlanJob {
  return {
    id: "j1", tenant_id: "t1", reference: "JOB-1", status: "planned",
    collection_eta: null, delivery_eta: null, acceptance_note: null,
    accepted_at: null, accepted_by: null,
    vehicle_id: null, driver_id: null, subcontractor_id: null,
    route_order: null, customer_name: "Acme", stops: [],
    ...overrides,
  };
}

describe("computeSaveDiff", () => {
  it("writes vehicle, driver and 1-based route_order for newly planned jobs", () => {
    const original = [job({ id: "a" }), job({ id: "b" })];
    const lanes: LanePlan[] = [{ vehicleId: "v1", driverId: "d1", jobIds: ["b", "a"] }];
    expect(computeSaveDiff(original, lanes, [])).toEqual([
      { id: "a", vehicle_id: "v1", driver_id: "d1", route_order: 2 },
      { id: "b", vehicle_id: "v1", driver_id: "d1", route_order: 1 },
    ]);
  });

  it("emits nothing for jobs whose assignment did not change", () => {
    const original = [job({ id: "a", vehicle_id: "v1", driver_id: "d1", route_order: 1 })];
    const lanes: LanePlan[] = [{ vehicleId: "v1", driverId: "d1", jobIds: ["a"] }];
    expect(computeSaveDiff(original, lanes, [])).toEqual([]);
  });

  it("clears all three columns when a job is unassigned", () => {
    const original = [job({ id: "a", vehicle_id: "v1", driver_id: "d1", route_order: 1 })];
    expect(computeSaveDiff(original, [], ["a"])).toEqual([
      { id: "a", vehicle_id: null, driver_id: null, route_order: null },
    ]);
  });

  it("does not clear a job that was never assigned", () => {
    const original = [job({ id: "a" })];
    expect(computeSaveDiff(original, [], ["a"])).toEqual([]);
  });

  it("detects a driver-only change", () => {
    const original = [job({ id: "a", vehicle_id: "v1", driver_id: "d1", route_order: 1 })];
    const lanes: LanePlan[] = [{ vehicleId: "v1", driverId: "d2", jobIds: ["a"] }];
    expect(computeSaveDiff(original, lanes, [])).toEqual([
      { id: "a", vehicle_id: "v1", driver_id: "d2", route_order: 1 },
    ]);
  });

  it("ignores jobs that are in no lane and not explicitly unassigned (subcontracted)", () => {
    const original = [job({ id: "sub", subcontractor_id: "s1" })];
    expect(computeSaveDiff(original, [], [])).toEqual([]);
  });

  it("lets unassigned win over a lane on (invalid) overlapping input, per the documented precondition", () => {
    const original = [job({ id: "a", vehicle_id: "v1", driver_id: "d1", route_order: 1 })];
    const lanes: LanePlan[] = [{ vehicleId: "v1", driverId: "d1", jobIds: ["a"] }];
    expect(computeSaveDiff(original, lanes, ["a"])).toEqual([
      { id: "a", vehicle_id: null, driver_id: null, route_order: null },
    ]);
  });
});

describe("operational date persistence", () => {
  it("emits a date-only update for an already assigned HT21 EOR lane", () => {
    const original = [job({ id: "a", vehicle_id: "ht21-eor", driver_id: "bob", route_order: 1, planning_date: "2026-10-04" })];
    const lanes = [{ vehicleId: "ht21-eor", driverId: "bob", jobIds: ["a"] }];
    expect(computeSaveDiff(original, lanes, [], "2026-10-08")).toEqual([
      { id: "a", vehicle_id: "ht21-eor", driver_id: "bob", route_order: 1, planning_date: "2026-10-08" },
    ]);
  });

  it("preserves snapshot job order and Bob's assignment for a 25-job route", () => {
    const original = Array.from({ length: 25 }, (_, i) => job({ id: `job-${i + 1}`, scheduled_date: "2026-10-04" }));
    const ids = original.map((row) => row.id).reverse();
    const updates = computeSaveDiff(original, [{ vehicleId: "ht21-eor", driverId: "bob", jobIds: ids }], [], "2026-10-08");
    expect(updates).toHaveLength(25);
    expect([...updates].sort((a, b) => a.route_order! - b.route_order!).map((row) => row.id)).toEqual(ids);
    expect(updates.every((row) => row.planning_date === "2026-10-08" && row.driver_id === "bob" && row.vehicle_id === "ht21-eor")).toBe(true);
  });

  it("does not create another date-only write after the plan has landed", () => {
    expect(computeSaveDiff([job({ id: "a", vehicle_id: "v1", driver_id: "d1", route_order: 1, planning_date: "2026-10-08" })], [{ vehicleId: "v1", driverId: "d1", jobIds: ["a"] }], [], "2026-10-08")).toEqual([]);
  });

  it("unassigns a job without changing its operational date", () => {
    expect(computeSaveDiff([job({ id: "a", vehicle_id: "v1", driver_id: "d1", route_order: 1, planning_date: "2026-10-04" })], [], ["a"], "2026-10-08")).toEqual([
      { id: "a", vehicle_id: null, driver_id: null, route_order: null, planning_date: "2026-10-04" },
    ]);
  });
});
