import { describe, expect, it, vi } from "vitest";

import {
  buildDriverScheduleStopTasks,
  DRIVER_STOP_SERVICE_SECONDS,
  optimizeDriverAwareJobOrder,
} from "./driverAwareRoute";
import type { LatLng, PlanJob } from "./types";

function job(
  id: string,
  points: Array<[number, number]>,
): PlanJob {
  return {
    id,
    tenant_id: "tenant",
    reference: id,
    status: "planned",
    collection_eta: null,
    delivery_eta: null,
    acceptance_note: null,
    accepted_at: null,
    accepted_by: null,
    vehicle_id: "vehicle",
    driver_id: "driver",
    subcontractor_id: null,
    route_order: null,
    journey_scope: null,
    origin_country_code: null,
    destination_country_code: null,
    compliance_regime_override: null,
    compliance_override_reason: null,
    customer_name: null,
    stops: points.map(([lat, lng], index) => ({
      id: `${id}-${index + 1}`,
      stop_order: index + 1,
      type: index === 0 ? "collection" : "delivery",
      address_line: `${id} stop ${index + 1}`,
      city: null,
      postcode: null,
      lat,
      lng,
    })),
    items: [],
  };
}

function secondsBetween(from: LatLng, to: LatLng): number {
  return Math.abs(from.lat - to.lat) * 100 +
    Math.abs(from.lng - to.lng) * 100;
}

describe("optimizeDriverAwareJobOrder", () => {
  it("uses Fast Plot to lock the closest reachable first job", async () => {
    const a = job("a", [[1, 0], [4, 0]]);
    const b = job("b", [[2, 0], [3, 0]]);

    const loadCosts = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[],
    ) => origins.map((origin) =>
      destinations.map((destination) => {
        if (origin.lat === 0 && origin.lng === 0) {
          if (destination.lat === 1) return 100;
          if (destination.lat === 2) return 10;
        }
        return secondsBetween(origin, destination);
      })
    ));

    const result = await optimizeDriverAwareJobOrder({
      jobs: [a, b],
      vanPosition: { lat: 0, lng: 0 },
      loadCosts,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.firstJobId).toBe("b");
      expect(result.jobs.map((value) => value.id)[0]).toBe("b");
      expect(result.physicalRoute[0]).toEqual({ lat: 2, lng: 0 });
      expect(result.firstTravelSeconds).toBe(10);
    }
  });

  it("fails explicitly when every first job is unreachable", async () => {
    const result = await optimizeDriverAwareJobOrder({
      jobs: [job("a", [[1, 0], [2, 0]])],
      vanPosition: { lat: 0, lng: 0 },
      loadCosts: async (origins, destinations) =>
        origins.map(() =>
          destinations.map(() => Number.POSITIVE_INFINITY)
        ),
    });

    expect(result).toEqual({
      ok: false,
      reason: "no_reachable_first_job",
    });
  });

  it("preserves unroutable jobs exactly once at the end", async () => {
    const routable = job("routable", [[1, 0], [2, 0]]);
    const missing = job("missing", [[3, 0], [4, 0]]);
    missing.stops[0].lat = null;

    const result = await optimizeDriverAwareJobOrder({
      jobs: [missing, routable],
      vanPosition: { lat: 0, lng: 0 },
      loadCosts: async (origins, destinations) =>
        origins.map((origin) =>
          destinations.map((destination) =>
            secondsBetween(origin, destination)
          )
        ),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.jobs.map((value) => value.id)).toEqual([
        "routable",
        "missing",
      ]);
    }
  });

  it("counts ten minutes for every valid physical service operation", async () => {
    const result = await optimizeDriverAwareJobOrder({
      jobs: [job("a", [[1, 0], [2, 0]])],
      vanPosition: { lat: 0, lng: 0 },
      loadCosts: async (origins, destinations) =>
        origins.map((origin) =>
          destinations.map((destination) =>
            secondsBetween(origin, destination)
          )
        ),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalServiceSeconds).toBe(1200);
    }
  });

  it("does not mutate the supplied job order", async () => {
    const a = job("a", [[1, 0], [4, 0]]);
    const b = job("b", [[2, 0], [3, 0]]);
    const input = [a, b];

    await optimizeDriverAwareJobOrder({
      jobs: input,
      vanPosition: { lat: 0, lng: 0 },
      loadCosts: async (origins, destinations) =>
        origins.map((origin) =>
          destinations.map((destination) =>
            secondsBetween(origin, destination)
          )
        ),
    });

    expect(input.map((value) => value.id)).toEqual(["a", "b"]);
  });
});

describe("buildDriverScheduleStopTasks", () => {
  it("uses ten minutes for every collection and delivery", () => {
    const tasks = buildDriverScheduleStopTasks([
      job("a", [[1, 1], [2, 2]]),
    ]);

    expect(DRIVER_STOP_SERVICE_SECONDS).toBe(600);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.serviceSeconds)).toEqual([600, 600]);
  });

  it("preserves stop precedence within each job", () => {
    const tasks = buildDriverScheduleStopTasks([
      job("a", [[1, 1], [2, 2], [3, 3]]),
    ]);

    expect(tasks.map((task) => task.precedenceIds)).toEqual([
      [],
      ["stop:a-1"],
      ["stop:a-2"],
    ]);
  });

  it("uses one scheduler location ID for the same physical coordinate", () => {
    const tasks = buildDriverScheduleStopTasks([
      job("a", [[1, 1], [1, 1]]),
    ]);

    expect(tasks[0].locationId).toBe("location:1,1");
    expect(tasks[1].locationId).toBe("location:1,1");
  });

  it("orders stops without mutating the job", () => {
    const value = job("a", [[1, 1], [2, 2]]);
    value.stops.reverse();

    const tasks = buildDriverScheduleStopTasks([value]);

    expect(tasks.map((task) => task.id)).toEqual([
      "stop:a-1",
      "stop:a-2",
    ]);
    expect(value.stops.map((stop) => stop.id)).toEqual([
      "a-2",
      "a-1",
    ]);
  });

  it("skips a task whose coordinates are unavailable", () => {
    const value = job("a", [[1, 1], [2, 2]]);
    value.stops[1].lat = null;

    const tasks = buildDriverScheduleStopTasks([value]);

    expect(tasks.map((task) => task.id)).toEqual(["stop:a-1"]);
  });
});
