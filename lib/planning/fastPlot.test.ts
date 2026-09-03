import { describe, expect, it, vi } from "vitest";
import {
  buildFastPlotVisits,
  fallbackFastPlotOrder,
  hasPhysicalPrecedenceCycle,
  optimizeFastPlotOrder,
  requiresPhysicalRevisit,
} from "./fastPlot";
import type { LatLng, PlanJob, PlanStop } from "./types";

function stop(
  id: string,
  order: number,
  type: string,
  lat: number,
  lng: number
): PlanStop {
  return {
    id,
    stop_order: order,
    type,
    address_line: id,
    city: null,
    postcode: null,
    lat,
    lng,
  };
}

function job(
  id: string,
  stops: PlanStop[]
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
    driver_id: null,
    subcontractor_id: null,
    route_order: null,
    customer_name: null,
    stops,
  };
}

function secondsBetween(
  from: LatLng,
  to: LatLng
): number {
  return Math.abs(from.lat - to.lat) * 100 +
    Math.abs(from.lng - to.lng) * 100;
}

const costLoader = vi.fn(async (
  origins: LatLng[],
  destinations: LatLng[]
) => origins.map((origin) =>
  destinations.map((destination) => secondsBetween(origin, destination))
));

describe("Fast Plot V3", () => {
  it("merges one shared delivery into one physical visit", () => {
    const heywood = { lat: 53.59, lng: -2.22 };
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 55.95, -3.19),
        stop("a-d", 2, "delivery", heywood.lat, heywood.lng),
      ]),
      job("b", [
        stop("b-c", 1, "collection", 56.0, -3.78),
        stop("b-d", 2, "delivery", heywood.lat, heywood.lng),
      ]),
    ];

    const visits = buildFastPlotVisits(jobs);

    expect(visits).toHaveLength(3);
    expect(
      visits.filter(
        (visit) =>
          visit.point.lat === heywood.lat &&
          visit.point.lng === heywood.lng
      )
    ).toHaveLength(1);
  });

  it("keeps a shared delivery locked until every job is ready", () => {
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 10, 0),
        stop("a-d", 2, "delivery", 0, 0),
      ]),
      job("b", [
        stop("b-c", 1, "collection", 20, 0),
        stop("b-d", 2, "delivery", 0, 0),
      ]),
    ];

    const route = fallbackFastPlotOrder(jobs);

    expect(route).toEqual([
      { lat: 10, lng: 0 },
      { lat: 20, lng: 0 },
      { lat: 0, lng: 0 },
    ]);
    expect(
      route.filter((point) => point.lat === 0 && point.lng === 0)
    ).toHaveLength(1);
  });

  it("merges collection == delivery into one physical visit", () => {
    const jobs = [
      job("local", [
        stop("c", 1, "collection", 56.06, -3.41),
        stop("d", 2, "delivery", 56.06, -3.41),
      ]),
    ];

    expect(buildFastPlotVisits(jobs)).toHaveLength(1);
    expect(fallbackFastPlotOrder(jobs)).toEqual([
      { lat: 56.06, lng: -3.41 },
    ]);
  });

  it("keeps every job's multi-stop precedence", async () => {
    const jobs = [
      job("multi", [
        stop("one", 1, "collection", 1, 1),
        stop("two", 2, "other", 2, 2),
        stop("three", 3, "delivery", 3, 3),
      ]),
    ];

    const route = await optimizeFastPlotOrder(jobs, costLoader);

    expect(route).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ]);
  });

  it("does not force unrelated self-contained jobs into a global delivery phase", async () => {
    const jobs = [
      job("shared-a", [
        stop("a-c", 1, "collection", 10, 0),
        stop("a-d", 2, "delivery", 0, 0),
      ]),
      job("local", [
        stop("local-c", 1, "collection", 9, 0),
        stop("local-d", 2, "delivery", 9, 0),
      ]),
      job("shared-b", [
        stop("b-c", 1, "collection", 8, 0),
        stop("b-d", 2, "delivery", 0, 0),
      ]),
    ];

    const route = await optimizeFastPlotOrder(jobs, costLoader);
    const localIndex = route.findIndex((point) => point.lat === 9);
    const heywoodIndex = route.findIndex((point) => point.lat === 0);

    expect(localIndex).toBeGreaterThanOrEqual(0);
    expect(heywoodIndex).toBeGreaterThan(localIndex);
    expect(route.filter((point) => point.lat === 0)).toHaveLength(1);
  });

  it("supports more than ten physical locations with 1 x N matrices", async () => {
    const jobs = Array.from({ length: 14 }, (_, index) =>
      job(`job-${index}`, [
        stop(`c-${index}`, 1, "collection", 50 + index / 10, -3),
        stop("shared", 2, "delivery", 53.59, -2.22),
      ])
    );

    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map((origin) =>
      destinations.map((destination) => secondsBetween(origin, destination))
    ));

    const route = await optimizeFastPlotOrder(jobs, loader);

    expect(route).toHaveLength(15);
    expect(route.filter(
      (point) => point.lat === 53.59 && point.lng === -2.22
    )).toHaveLength(1);
    expect(route.at(-1)).toEqual({ lat: 53.59, lng: -2.22 });

    for (const [origins, destinations] of loader.mock.calls) {
      expect(origins.length * destinations.length).toBeLessThanOrEqual(100);
    }
  });

  it("preserves a required non-consecutive physical revisit", async () => {
    const jobs = [
      job("revisit", [
        stop("first-a", 1, "collection", 1, 1),
        stop("middle-b", 2, "other", 2, 2),
        stop("last-a", 3, "delivery", 1, 1),
      ]),
    ];
    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map(() => destinations.map(() => 1)));

    expect(requiresPhysicalRevisit(jobs)).toBe(true);

    const route = await optimizeFastPlotOrder(jobs, loader);

    expect(route).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 1, lng: 1 },
    ]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("falls back when different jobs create a physical precedence cycle", async () => {
    const jobs = [
      job("a-to-b", [
        stop("a", 1, "collection", 1, 1),
        stop("b", 2, "delivery", 2, 2),
      ]),
      job("b-to-a", [
        stop("b", 1, "collection", 2, 2),
        stop("a", 2, "delivery", 1, 1),
      ]),
    ];
    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map(() => destinations.map(() => 1)));

    expect(requiresPhysicalRevisit(jobs)).toBe(false);
    expect(hasPhysicalPrecedenceCycle(jobs)).toBe(true);

    const route = await optimizeFastPlotOrder(jobs, loader);

    expect(route).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 2, lng: 2 },
      { lat: 1, lng: 1 },
    ]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("still deduplicates consecutive stops at the same location", async () => {
    const jobs = [
      job("consecutive", [
        stop("first-a", 1, "collection", 1, 1),
        stop("second-a", 2, "other", 1, 1),
        stop("last-b", 3, "delivery", 2, 2),
      ]),
    ];

    expect(requiresPhysicalRevisit(jobs)).toBe(false);

    const route = await optimizeFastPlotOrder(jobs, costLoader);

    expect(route).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ]);
  });

  it("falls back safely when matrix loading fails", async () => {
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 1, 1),
        stop("a-d", 2, "delivery", 2, 2),
      ]),
      job("b", [
        stop("b-c", 1, "collection", 3, 3),
        stop("b-d", 2, "delivery", 4, 4),
      ]),
    ];

    const route = await optimizeFastPlotOrder(
      jobs,
      async () => null
    );

    expect(route).toEqual(fallbackFastPlotOrder(jobs));
  });

  it("does not mutate jobs or stops", async () => {
    const jobs = [
      job("a", [
        stop("second", 2, "delivery", 2, 2),
        stop("first", 1, "collection", 1, 1),
      ]),
    ];
    const before = JSON.stringify(jobs);

    await optimizeFastPlotOrder(jobs, costLoader);

    expect(JSON.stringify(jobs)).toBe(before);
  });
});
