import { describe, expect, it } from "vitest";
import {
  MAX_PLANNING_ROUTE_JOBS,
  MAX_TOMTOM_ROUTE_POINTS,
  mergeRouteResults,
  splitRoutePoints,
  wouldExceedPlanningRouteJobLimit,
} from "./routeChunks";
import type { LatLng, RouteResult } from "./types";

function makePoints(count: number): LatLng[] {
  return Array.from({ length: count }, (_, index) => ({
    lat: 50 + index / 1000,
    lng: -1 - index / 1000,
  }));
}

function makeRoute(
  points: LatLng[],
  distance: number,
  travelTime: number
): RouteResult {
  return {
    points: points.map((point) => ({ ...point })),
    legs: Array.from(
      { length: Math.max(0, points.length - 1) },
      (_, index) => ({
        distanceMeters: 1000 + index,
        travelTimeSeconds: 100 + index,
      })
    ),
    totalDistanceMeters: distance,
    totalTravelTimeSeconds: travelTime,
  };
}

describe("planning route job limit", () => {
  it("allows exactly 350 unique jobs", () => {
    const existing = Array.from(
      { length: MAX_PLANNING_ROUTE_JOBS },
      (_, index) => `job-${index}`
    );

    expect(
      wouldExceedPlanningRouteJobLimit(existing, [])
    ).toBe(false);
  });

  it("rejects a 351st unique job", () => {
    const existing = Array.from(
      { length: MAX_PLANNING_ROUTE_JOBS },
      (_, index) => `job-${index}`
    );

    expect(
      wouldExceedPlanningRouteJobLimit(existing, ["job-350"])
    ).toBe(true);
  });

  it("does not count an already-present job twice", () => {
    const existing = Array.from(
      { length: MAX_PLANNING_ROUTE_JOBS },
      (_, index) => `job-${index}`
    );

    expect(
      wouldExceedPlanningRouteJobLimit(existing, ["job-349"])
    ).toBe(false);
  });
});

describe("splitRoutePoints", () => {
  it("uses the TomTom 50-point request limit", () => {
    expect(MAX_TOMTOM_ROUTE_POINTS).toBe(50);
  });

  it("returns no route chunks for fewer than two points", () => {
    expect(splitRoutePoints([])).toEqual([]);
    expect(splitRoutePoints(makePoints(1))).toEqual([]);
  });

  it.each([
    [2, [2]],
    [50, [50]],
    [51, [50, 2]],
    [99, [50, 50]],
    [100, [50, 50, 2]],
    [350, [50, 50, 50, 50, 50, 50, 50, 7]],
    [701, [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 15]],
  ])("splits %i ordered points safely", (count, expectedLengths) => {
    const points = makePoints(count);
    const chunks = splitRoutePoints(points);

    expect(chunks.map((chunk) => chunk.length)).toEqual(expectedLengths);
    expect(chunks.every((chunk) => chunk.length <= 50)).toBe(true);

    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index][0]).toEqual(chunks[index - 1].at(-1));
    }

    const reconstructed = [
      ...chunks[0],
      ...chunks.slice(1).flatMap((chunk) => chunk.slice(1)),
    ];

    expect(reconstructed).toEqual(points);
  });

  it("does not mutate the supplied points", () => {
    const points = makePoints(51);
    const snapshot = structuredClone(points);

    const chunks = splitRoutePoints(points);
    chunks[0][0].lat = 999;

    expect(points).toEqual(snapshot);
  });

  it("rejects an invalid chunk size", () => {
    expect(() => splitRoutePoints(makePoints(5), 1)).toThrow(RangeError);
    expect(() => splitRoutePoints(makePoints(5), 2.5)).toThrow(RangeError);
  });
});

describe("mergeRouteResults", () => {
  it("returns null when there are no route results", () => {
    expect(mergeRouteResults([])).toBeNull();
  });

  it("merges legs and totals in route order", () => {
    const points = makePoints(4);
    const first = makeRoute(points.slice(0, 3), 2000, 200);
    const second = makeRoute(points.slice(2), 3000, 300);

    const merged = mergeRouteResults([first, second]);

    expect(merged).not.toBeNull();
    expect(merged!.points).toEqual(points);
    expect(merged!.legs).toEqual([...first.legs, ...second.legs]);
    expect(merged!.totalDistanceMeters).toBe(5000);
    expect(merged!.totalTravelTimeSeconds).toBe(500);
  });

  it("removes the exact duplicated geometry point at a chunk join", () => {
    const a = { lat: 51, lng: -1 };
    const b = { lat: 52, lng: -2 };
    const c = { lat: 53, lng: -3 };

    const merged = mergeRouteResults([
      makeRoute([a, b], 10, 20),
      makeRoute([b, c], 30, 40),
    ]);

    expect(merged!.points).toEqual([a, b, c]);
  });

  it("preserves repeated geometry inside a chunk", () => {
    const a = { lat: 51, lng: -1 };
    const b = { lat: 52, lng: -2 };
    const c = { lat: 53, lng: -3 };

    const merged = mergeRouteResults([
      makeRoute([a, a, b], 10, 20),
      makeRoute([b, c, c], 30, 40),
    ]);

    expect(merged!.points).toEqual([a, a, b, c, c]);
  });

  it("does not mutate source route results", () => {
    const points = makePoints(4);
    const first = makeRoute(points.slice(0, 3), 2000, 200);
    const second = makeRoute(points.slice(2), 3000, 300);
    const snapshot = structuredClone([first, second]);

    const merged = mergeRouteResults([first, second]);
    merged!.points[0].lat = 999;
    merged!.legs[0].distanceMeters = 999;

    expect([first, second]).toEqual(snapshot);
  });
});
