import { describe, expect, it } from "vitest";
import {
  draftAssignment,
  formatEta,
  jobStatusLabel,
  stopTypeLabel,
  toLabelStops,
} from "./jobDetail";
import type { PlanStop } from "./types";

describe("jobStatusLabel", () => {
  it("uses the Jobs page wording for pending acceptance", () => {
    expect(jobStatusLabel("pending_acceptance")).toBe("Awaiting acceptance");
  });

  it("replaces underscores in any other status", () => {
    expect(jobStatusLabel("in_transit")).toBe("in transit");
    expect(jobStatusLabel("planned")).toBe("planned");
  });

  it("renders a missing status as the absent-value marker", () => {
    expect(jobStatusLabel(null)).toBe("-");
    expect(jobStatusLabel("")).toBe("-");
  });
});

describe("formatEta", () => {
  it("renders a GMT instant in London time", () => {
    expect(formatEta("2026-01-15T09:00:00Z", "Europe/London")).toBe(
      "15 Jan 2026, 09:00"
    );
  });

  it("shifts a BST instant by an hour", () => {
    expect(formatEta("2026-07-15T09:00:00Z", "Europe/London")).toBe(
      "15 Jul 2026, 10:00"
    );
  });

  it("respects a non-UK company timezone", () => {
    expect(formatEta("2026-07-15T09:00:00Z", "Europe/Warsaw")).toBe(
      "15 Jul 2026, 11:00"
    );
  });

  it("renders midnight as 00, never 24", () => {
    expect(formatEta("2026-01-15T00:00:00Z", "Europe/London")).toBe(
      "15 Jan 2026, 00:00"
    );
  });

  it("renders null or unparseable input as the absent-value marker", () => {
    expect(formatEta(null, "Europe/London")).toBe("-");
    expect(formatEta("not a date", "Europe/London")).toBe("-");
  });
});

describe("stopTypeLabel", () => {
  it("capitalises the two known types", () => {
    expect(stopTypeLabel("collection")).toBe("Collection");
    expect(stopTypeLabel("delivery")).toBe("Delivery");
  });

  it("passes an unknown type through and marks null", () => {
    expect(stopTypeLabel("transfer")).toBe("transfer");
    expect(stopTypeLabel(null)).toBe("-");
  });
});

function stop(overrides: Partial<PlanStop> & { id: string }): PlanStop {
  return {
    stop_order: 1,
    type: "collection",
    address_line: "1 High St",
    city: "Leeds",
    postcode: "LS1 1AA",
    lat: null,
    lng: null,
    ...overrides,
  };
}

describe("toLabelStops", () => {
  it("keeps collection and delivery stops in stop order", () => {
    const result = toLabelStops([
      stop({ id: "b", stop_order: 2, type: "delivery" }),
      stop({ id: "a", stop_order: 1, type: "collection" }),
    ]);
    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
    expect(result[0].type).toBe("collection");
    expect(result[1].type).toBe("delivery");
  });

  it("drops stops the label printer cannot classify", () => {
    const result = toLabelStops([
      stop({ id: "a", type: "collection" }),
      stop({ id: "x", stop_order: 2, type: null }),
      stop({ id: "y", stop_order: 3, type: "transfer" }),
    ]);
    expect(result.map((s) => s.id)).toEqual(["a"]);
  });

  it("carries only the label fields", () => {
    const [result] = toLabelStops([stop({ id: "a", lat: 53.8, lng: -1.5 })]);
    expect(result).toEqual({
      id: "a",
      stop_order: 1,
      type: "collection",
      address_line: "1 High St",
      city: "Leeds",
      postcode: "LS1 1AA",
    });
  });
});

describe("draftAssignment", () => {
  const laneOrders = { v1: ["j1", "j2"], v2: ["j3"] };
  const laneDrivers = { v1: "d1", v2: null };

  it("finds the lane that holds the job and that lane's driver", () => {
    expect(draftAssignment("j2", laneOrders, laneDrivers)).toEqual({
      vehicleId: "v1",
      driverId: "d1",
    });
  });

  it("reports a lane with no driver", () => {
    expect(draftAssignment("j3", laneOrders, laneDrivers)).toEqual({
      vehicleId: "v2",
      driverId: null,
    });
  });

  it("reports an unassigned job", () => {
    expect(draftAssignment("j9", laneOrders, laneDrivers)).toEqual({
      vehicleId: null,
      driverId: null,
    });
  });

  it("reads the draft, so a moved job reports its new lane", () => {
    const moved = { v1: ["j1"], v2: ["j3", "j2"] };
    expect(draftAssignment("j2", moved, laneDrivers)).toEqual({
      vehicleId: "v2",
      driverId: null,
    });
  });
});
