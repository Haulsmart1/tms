import { describe, expect, it } from "vitest";
import {
  PLANNING_DRAFT_MAX_AGE_MS,
  createPlanningDraft,
  parsePlanningDraft,
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
  });
}

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
