import { describe, expect, it } from "vitest";

import type { DriverAwareRouteResult } from "./driverAwareRoute";
import { scheduleDriverAwareRoute } from "./driverRouteSchedule";
import type { DriverRuleProfile } from "./driverRules";
import type { LatLng, PlanJob } from "./types";

const HOUR = 60 * 60;

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

function route(
  jobs: PlanJob[],
  physicalRoute: LatLng[],
): Extract<DriverAwareRouteResult, { ok: true }> {
  return {
    ok: true,
    jobs,
    physicalRoute,
    firstJobId: jobs[0].id,
    firstTravelSeconds: HOUR,
    totalServiceSeconds: jobs.reduce(
      (sum, value) => sum + value.stops.length * 600,
      0,
    ),
  };
}

function rules(
  overrides: Partial<DriverRuleProfile> = {},
): DriverRuleProfile {
  return {
    id: "test-rules",
    label: "Synthetic test rules",
    regime: "assimilated",
    effectiveFrom: "2026-01-01",
    verified: false,
    sourceReference: null,
    maxContinuousDrivingSeconds: 4 * HOUR,
    qualifyingBreakSeconds: HOUR,
    maxDailyDrivingSeconds: 8 * HOUR,
    dailyRestSeconds: 10 * HOUR,
    maxDutyWindowSeconds: 12 * HOUR,
    ...overrides,
  };
}

function travel(
  values: Record<string, number | null> = {},
) {
  return (from: string, to: string): number | null => {
    if (from === to) return 0;
    const key = `${from}->${to}`;
    return Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : HOUR;
  };
}

describe("scheduleDriverAwareRoute", () => {
  it("feeds the optimized physical task order into the scheduler", () => {
    const a = job("a", [[1, 1], [4, 4]]);
    const b = job("b", [[2, 2], [3, 3]]);

    const result = scheduleDriverAwareRoute({
      route: route(
        [a, b],
        [
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 },
          { lat: 3, lng: 3 },
          { lat: 4, lng: 4 },
        ],
      ),
      planningProfile: "tramper",
      ruleProfile: rules(),
      startLocationId: "van",
      baseLocationId: "base",
      activityDataAvailable: false,
      travelSecondsBetween: travel(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schedule.completedTaskIds).toEqual([
        "stop:a-1",
        "stop:b-1",
        "stop:b-2",
        "stop:a-2",
      ]);
      expect(result.schedule.status).toBe("review_required");
      expect(result.schedule.planningAssumption).toBe(true);
    }
  });

  it("passes missing directed travel through as unschedulable", () => {
    const a = job("a", [[1, 1], [2, 2]]);

    const result = scheduleDriverAwareRoute({
      route: route(
        [a],
        [
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 },
        ],
      ),
      planningProfile: "tramper",
      ruleProfile: rules(),
      startLocationId: "van",
      activityDataAvailable: true,
      travelSecondsBetween: travel({
        "van->location:1,1": null,
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schedule.status).toBe("unschedulable");
      expect(result.schedule.completedTaskIds).toEqual([]);
      expect(result.schedule.warnings.join(" ")).toContain(
        "Travel time unavailable",
      );
    }
  });

  it("returns a day driver to base", () => {
    const a = job("a", [[1, 1], [2, 2]]);

    const result = scheduleDriverAwareRoute({
      route: route(
        [a],
        [
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 },
        ],
      ),
      planningProfile: "day",
      ruleProfile: rules(),
      startLocationId: "base",
      baseLocationId: "base",
      activityDataAvailable: false,
      travelSecondsBetween: travel(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.schedule.events.some(
          (event) => event.kind === "return_to_base",
        ),
      ).toBe(true);
      expect(result.schedule.days.at(-1)?.endLocationId).toBe("base");
    }
  });

  it("keeps tramper daily rest at the current route location", () => {
    const a = job("a", [[1, 1], [2, 2]]);

    const result = scheduleDriverAwareRoute({
      route: route(
        [a],
        [
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 },
        ],
      ),
      planningProfile: "tramper",
      ruleProfile: rules({
        maxDailyDrivingSeconds: 5 * HOUR,
      }),
      startLocationId: "base",
      baseLocationId: "base",
      activityDataAvailable: false,
      travelSecondsBetween: travel({
        "base->location:1,1": 3 * HOUR,
        "location:1,1->location:2,2": 3 * HOUR,
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const rest = result.schedule.events.find(
        (event) => event.kind === "daily_rest",
      );
      expect(rest?.locationId).toBe("location:1,1");
      expect(result.schedule.days[1]?.startLocationId).toBe(
        "location:1,1",
      );
    }
  });

  it("uses zero travel between separate services at one coordinate", () => {
    const a = job("a", [[1, 1], [1, 1]]);

    const result = scheduleDriverAwareRoute({
      route: route([a], [{ lat: 1, lng: 1 }]),
      planningProfile: "tramper",
      ruleProfile: rules(),
      startLocationId: "van",
      activityDataAvailable: false,
      travelSecondsBetween: (from, to) => {
        if (from === to) return 0;
        return HOUR;
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tasks).toHaveLength(2);
      expect(
        result.schedule.events.filter((event) => event.kind === "drive"),
      ).toHaveLength(1);
      expect(
        result.schedule.events.filter((event) => event.kind === "service"),
      ).toHaveLength(2);
    }
  });

  it("fails before scheduling when the physical route is incomplete", () => {
    const a = job("a", [[1, 1], [2, 2]]);

    const result = scheduleDriverAwareRoute({
      route: route([a], [{ lat: 1, lng: 1 }]),
      planningProfile: "tramper",
      ruleProfile: rules(),
      startLocationId: "van",
      activityDataAvailable: false,
      travelSecondsBetween: travel(),
    });

    expect(result).toEqual({
      ok: false,
      reason: "physical_route_mismatch",
      remainingStopIds: ["a-2"],
    });
  });
});
