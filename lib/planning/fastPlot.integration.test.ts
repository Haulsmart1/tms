import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  buildFastPlotVisits,
  optimizeFastPlotOrderFromStart,
} from "./fastPlot";
import type {
  FastPlotVisit,
} from "./fastPlot";
import type { LatLng, PlanJob } from "./types";

type Fixture = {
  start: LatLng;
  jobs: PlanJob[];
};

function haversineKm(a: LatLng, b: LatLng): number {
  const radiusKm = 6371;
  const toRadians = (degrees: number) =>
    degrees * Math.PI / 180;

  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);

  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);

  const value =
    sinLat * sinLat +
    Math.cos(lat1) *
      Math.cos(lat2) *
      sinLng *
      sinLng;

  return 2 * radiusKm * Math.asin(Math.sqrt(value));
}

function preservesPhysicalPrecedence(
  jobs: PlanJob[],
  route: FastPlotVisit[],
): boolean {
  const progress = new Map<string, number>();

  for (const job of jobs) {
    progress.set(job.id, 0);
  }

  for (const visit of route) {
    for (const [jobId, requiredIndexes] of Object.entries(
      visit.requirements,
    )) {
      let current = progress.get(jobId);

      if (current === undefined) {
        return false;
      }

      const orderedIndexes = [...requiredIndexes].sort(
        (a, b) => a - b,
      );

      for (const requiredIndex of orderedIndexes) {
        if (requiredIndex !== current) {
          return false;
        }

        current += 1;
      }

      progress.set(jobId, current);
    }
  }

  for (const job of jobs) {
    if ((progress.get(job.id) ?? 0) !== job.stops.length) {
      return false;
    }
  }

  return true;
}

describe("integrated Master Route public optimizer", () => {
  it("routes the production regression through the public anchored entry point", async () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/large-shared-terminal-regression.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Fixture;

    const physicalVisits =
      buildFastPlotVisits(fixture.jobs);

    const loadCosts = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[],
    ) =>
      origins.map((origin) =>
        destinations.map((destination) =>
          haversineKm(origin, destination) * 60
        )
      )
    );

    const result =
      await optimizeFastPlotOrderFromStart(
        fixture.jobs,
        fixture.start,
        loadCosts,
      );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(
        `Unexpected optimizer failure: ${result.reason}`,
      );
    }

    expect(fixture.jobs).toHaveLength(199);
    expect(physicalVisits).toHaveLength(211);
    expect(result.orderedVisits).toHaveLength(211);
    expect(result.route).toHaveLength(211);

    expect(result.route).toEqual(
      result.orderedVisits.map(
        (visit) => visit.point,
      ),
    );

    expect(
      preservesPhysicalPrecedence(
        fixture.jobs,
        result.orderedVisits,
      ),
    ).toBe(true);

    expect(loadCosts).toHaveBeenCalledTimes(1);

    expect(loadCosts.mock.calls[0]?.[0]).toEqual([
      fixture.start,
    ]);

    expect(loadCosts.mock.calls[0]?.[1]).toEqual([
      result.orderedVisits[0]?.point,
    ]);

    const expectedFirstTravelSeconds =
      haversineKm(
        fixture.start,
        result.orderedVisits[0].point,
      ) * 60;

    expect(result.firstTravelSeconds).toBeCloseTo(
      expectedFirstTravelSeconds,
      8,
    );

    let longestHopKm = 0;
    let longestHop: [number, number] | null = null;

    for (
      let index = 1;
      index < result.route.length;
      index++
    ) {
      const distanceKm = haversineKm(
        result.route[index - 1],
        result.route[index],
      );

      if (distanceKm > longestHopKm) {
        longestHopKm = distanceKm;
        longestHop = [index - 1, index];
      }
    }

    console.log("PUBLIC_OPTIMIZER_PRODUCTION", {
      jobs: fixture.jobs.length,
      physicalVisits: physicalVisits.length,
      routeVisits: result.route.length,
      precedence: true,
      loadCostCalls: loadCosts.mock.calls.length,
      longestHopKm,
      longestHop,
      first: result.route[0],
      last: result.route.at(-1),
    });

    expect(longestHopKm).toBeLessThan(150);
  });
});