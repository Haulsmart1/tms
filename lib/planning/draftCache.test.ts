import { describe, expect, it } from "vitest";
import {
  PLANNING_DRAFT_MAX_AGE_MS,
  createPlanningDraft,
  parsePlanningDraft,
  planningDraftBaseline,
  planningDraftIsStale,
  planningDraftMatchesPlan,
  planningDraftStorageKey,
} from "./draftCache";

const now = 2_000_000_000_000;

function context() {
  return {
    tenantId: "tenant-a",
    date: "2026-09-11",
    validVehicleIds: new Set(["van-a", "van-b"]),
    validJobIds: new Set(["job-1", "job-2", "job-3"]),
    validDriverIds: new Set(["driver-a", "driver-b"]),
    now,
  };
}

function draft() {
  return createPlanningDraft({
    tenantId: "tenant-a",
    date: "2026-09-11",
    updatedAt: now - 1_000,
    laneOrders: {
      "van-a": ["job-1", "job-2"],
      "van-b": ["job-3"],
    },
    laneDrivers: {
      "van-a": "driver-a",
      "van-b": null,
    },
    selectedVehicleId: "van-a",
    baseline: {
      "job-1": ["van-a", "driver-a", 1],
      "job-2": [null, null, null],
      "job-3": ["van-b", null, 1],
    },
  });
}

describe("planning draft staleness (PLAN-11)", () => {
  const serverJobs = [
    { id: "job-1", vehicle_id: "van-a", driver_id: "driver-a", route_order: 1 },
    { id: "job-2", vehicle_id: null, driver_id: null, route_order: null },
    { id: "job-3", vehicle_id: "van-b", driver_id: null, route_order: 1 },
  ];

  it("is not stale while the server still matches the baseline", () => {
    expect(planningDraftIsStale(draft(), serverJobs)).toBe(false);
  });

  it("is stale once another planner has changed a job", () => {
    expect(
      planningDraftIsStale(draft(), [
        { ...serverJobs[0], vehicle_id: "van-b" },
        serverJobs[1],
        serverJobs[2],
      ])
    ).toBe(true);
  });

  it("is stale when a job the draft never saw is now assigned", () => {
    expect(
      planningDraftIsStale(draft(), [
        ...serverJobs,
        { id: "job-9", vehicle_id: "van-a", driver_id: null, route_order: 3 },
      ])
    ).toBe(true);
  });

  it("builds the baseline from the loaded jobs", () => {
    expect(planningDraftBaseline(serverJobs)).toEqual(draft().baseline);
  });

  it("ignores a version 1 draft, which has no baseline", () => {
    const { baseline: _baseline, ...legacy } = draft();

    expect(
      parsePlanningDraft(
        JSON.stringify({ ...legacy, version: 1 }),
        context()
      )
    ).toBeNull();
  });
});

describe("planning draft cache", () => {
  it("keys drafts by tenant and planning date", () => {
    expect(
      planningDraftStorageKey("tenant-a", "2026-09-11")
    ).toBe("tms:planning-draft:v1:tenant-a:2026-09-11");
  });

  it("parses a valid draft", () => {
    expect(
      parsePlanningDraft(JSON.stringify(draft()), context())
    ).toEqual(draft());
  });

  it("rejects drafts from another tenant", () => {
    const value = { ...draft(), tenantId: "tenant-b" };

    expect(
      parsePlanningDraft(JSON.stringify(value), context())
    ).toBeNull();
  });

  it("rejects expired drafts", () => {
    const value = {
      ...draft(),
      updatedAt: now - PLANNING_DRAFT_MAX_AGE_MS - 1,
    };

    expect(
      parsePlanningDraft(JSON.stringify(value), context())
    ).toBeNull();
  });

  it("rejects duplicate jobs across lanes", () => {
    const value = {
      ...draft(),
      laneOrders: {
        "van-a": ["job-1"],
        "van-b": ["job-1"],
      },
    };

    expect(
      parsePlanningDraft(JSON.stringify(value), context())
    ).toBeNull();
  });

  it("rejects unknown vehicles, jobs and drivers", () => {
    expect(
      parsePlanningDraft(
        JSON.stringify({
          ...draft(),
          laneOrders: { "van-missing": ["job-1"] },
        }),
        context()
      )
    ).toBeNull();

    expect(
      parsePlanningDraft(
        JSON.stringify({
          ...draft(),
          laneOrders: { "van-a": ["job-missing"] },
        }),
        context()
      )
    ).toBeNull();

    expect(
      parsePlanningDraft(
        JSON.stringify({
          ...draft(),
          laneDrivers: { "van-a": "driver-missing" },
        }),
        context()
      )
    ).toBeNull();
  });

  it("compares cached lanes and drivers with the loaded plan", () => {
    const value = draft();

    expect(
      planningDraftMatchesPlan(
        value,
        value.laneOrders,
        value.laneDrivers,
        ["van-a", "van-b"]
      )
    ).toBe(true);

    expect(
      planningDraftMatchesPlan(
        value,
        {
          ...value.laneOrders,
          "van-a": ["job-2", "job-1"],
        },
        value.laneDrivers,
        ["van-a", "van-b"]
      )
    ).toBe(false);
  });
});
