import { describe, expect, it } from "vitest";
import { etaWindow, latenessMs, roundToFiveMinutes, shouldRefreshEta, stopsBefore, trackingState, type EtaContext } from "./eta";

const now = new Date("2026-10-07T11:00:00.000Z"); // 12:00 London (BST)

function ctx(over: Partial<EtaContext> = {}): EtaContext {
  return {
    now,
    stop: { id: "s3", jobId: "j3", completed: false, deliveredAt: null, plannedDate: "2026-10-07" },
    job: { vehicleId: "v1", deliveryEta: "2026-10-07T13:00:00.000Z", deliveryStopCount: 1, incompleteStopIds: ["s3"] },
    itinerary: [
      { stopId: "s1", jobId: "j1", type: "delivery", completed: true, deliveredAt: "2026-10-07T10:20:00.000Z" },
      { stopId: "s2", jobId: "j2", type: "delivery", completed: false, deliveredAt: null },
      { stopId: "s3", jobId: "j3", type: "delivery", completed: false, deliveredAt: null },
    ],
    baselines: { j1: "2026-10-07T10:00:00.000Z", j2: "2026-10-07T12:00:00.000Z", j3: "2026-10-07T13:00:00.000Z" },
    ...over,
  };
}

describe("trackingState", () => {
  it("is delivered once the stop is complete", () => {
    expect(trackingState(ctx({ stop: { ...ctx().stop, completed: true, deliveredAt: "2026-10-07T10:59:00.000Z" } }))).toBe("delivered");
  });

  it("is next when it is the first incomplete stop in the itinerary", () => {
    const c = ctx();
    c.itinerary![1] = { ...c.itinerary![1], completed: true, deliveredAt: "2026-10-07T10:50:00.000Z" };
    expect(trackingState(c)).toBe("next");
  });

  it("is en route when earlier stops are still to do today", () => {
    expect(trackingState(ctx())).toBe("en_route_earlier");
  });

  it("is scheduled before the planned date", () => {
    expect(trackingState(ctx({ stop: { ...ctx().stop, plannedDate: "2026-10-08" } }))).toBe("scheduled");
  });

  it("without an itinerary, is next only when it is the job's last incomplete stop and a vehicle is assigned", () => {
    expect(trackingState(ctx({ itinerary: null }))).toBe("next");
    expect(trackingState(ctx({ itinerary: null, job: { ...ctx().job, incompleteStopIds: ["s0", "s3"] } }))).toBe("en_route_earlier");
    expect(trackingState(ctx({ itinerary: null, job: { ...ctx().job, vehicleId: null } }))).toBe("en_route_earlier");
  });
});

describe("stopsBefore", () => {
  it("counts incomplete delivery stops ahead in the itinerary", () => {
    expect(stopsBefore(ctx())).toBe(1);
  });
  it("is null without an itinerary", () => {
    expect(stopsBefore(ctx({ itinerary: null }))).toBeNull();
  });
});

describe("latenessMs", () => {
  it("uses the most recent completed stop before this one that has a baseline", () => {
    expect(latenessMs(ctx())).toBe(20 * 60 * 1000);
  });
  it("clamps to the allowed range", () => {
    const c = ctx();
    c.itinerary![0] = { ...c.itinerary![0], deliveredAt: "2026-10-07T20:00:00.000Z" };
    expect(latenessMs(c)).toBe(6 * 60 * 60 * 1000);
  });
  it("is zero with nothing to compare", () => {
    expect(latenessMs(ctx({ itinerary: null }))).toBe(0);
  });
});

describe("etaWindow", () => {
  it("is baseline plus lateness, plus and minus 30 minutes, rounded outward to 15 minutes", () => {
    // 13:00Z + 20m = 13:20Z; window 12:50Z to 13:50Z; rounded outward 12:45Z to 14:00Z.
    expect(etaWindow(ctx())).toEqual({ from: "2026-10-07T12:45:00.000Z", to: "2026-10-07T14:00:00.000Z" });
  });
  it("is null for a job with several delivery stops", () => {
    expect(etaWindow(ctx({ job: { ...ctx().job, deliveryStopCount: 2 } }))).toBeNull();
  });
  it("is null with no baseline", () => {
    expect(etaWindow(ctx({ job: { ...ctx().job, deliveryEta: null } }))).toBeNull();
  });
});

describe("shouldRefreshEta", () => {
  const positionAt = "2026-10-07T10:59:00.000Z";
  it("refreshes with no cache, a stale cache, or a newer position", () => {
    expect(shouldRefreshEta(null, positionAt, now)).toBe(true);
    expect(shouldRefreshEta({ computedAt: "2026-10-07T10:57:59.000Z", fromPositionAt: positionAt }, positionAt, now)).toBe(true);
    expect(shouldRefreshEta({ computedAt: "2026-10-07T10:59:30.000Z", fromPositionAt: "2026-10-07T10:58:00.000Z" }, positionAt, now)).toBe(true);
  });
  it("reuses a fresh cache built from the same position", () => {
    expect(shouldRefreshEta({ computedAt: "2026-10-07T10:59:30.000Z", fromPositionAt: positionAt }, positionAt, now)).toBe(false);
  });
});

describe("roundToFiveMinutes", () => {
  it("rounds to the nearest five minutes", () => {
    expect(roundToFiveMinutes("2026-10-07T13:22:29.000Z")).toBe("2026-10-07T13:20:00.000Z");
    expect(roundToFiveMinutes("2026-10-07T13:22:31.000Z")).toBe("2026-10-07T13:25:00.000Z");
  });
});
