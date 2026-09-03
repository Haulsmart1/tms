import { describe, expect, it } from "vitest";
import {
  fastPlotOptimizationMode,
  fastPlotPhases,
  fastPlotWaypoints,
  fastPlotWaypointsFromPhases,
  isRoutable,
  jobEntryPoint,
  jobExitPoint,
  jobRepresentativePoint,
  reorderFastPlotPhase,
  jobWaypoints,
  laneWaypoints,
  sortedStops,
} from "./waypoints";
import type { PlanJob, PlanStop } from "./types";

function stop(overrides: Partial<PlanStop>): PlanStop {
  return {
    id: "s1", stop_order: 1, type: "collection",
    address_line: "1 Dock Rd", city: "Leeds", postcode: "LS1 1AA",
    lat: 53.8, lng: -1.55,
    ...overrides,
  };
}

function job(stops: PlanStop[], overrides: Partial<PlanJob> = {}): PlanJob {
  return {
    id: "j1", tenant_id: "t1", reference: "JOB-1", status: "planned",
    collection_eta: null, delivery_eta: null, acceptance_note: null,
    accepted_at: null, accepted_by: null,
    vehicle_id: null, driver_id: null, subcontractor_id: null,
    route_order: null, customer_name: "Acme", stops,
    ...overrides,
  };
}

describe("isRoutable", () => {
  it("is true when every stop has coordinates", () => {
    expect(isRoutable(job([stop({}), stop({ id: "s2", stop_order: 2 })]))).toBe(true);
  });

  it("is false when any stop is missing a coordinate", () => {
    expect(isRoutable(job([stop({}), stop({ id: "s2", stop_order: 2, lat: null })]))).toBe(false);
    expect(isRoutable(job([stop({ lng: null })]))).toBe(false);
  });

  it("is false for a job with no stops", () => {
    expect(isRoutable(job([]))).toBe(false);
  });
});

describe("sortedStops", () => {
  it("orders by stop_order without mutating the input", () => {
    const a = stop({ id: "a", stop_order: 2 });
    const b = stop({ id: "b", stop_order: 1 });
    const j = job([a, b]);
    expect(sortedStops(j).map((s) => s.id)).toEqual(["b", "a"]);
    expect(j.stops.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("jobWaypoints", () => {
  it("returns coordinates in stop_order", () => {
    const j = job([
      stop({ id: "a", stop_order: 2, lat: 53.9, lng: -1.0 }),
      stop({ id: "b", stop_order: 1, lat: 53.8, lng: -1.5 }),
    ]);
    expect(jobWaypoints(j)).toEqual([
      { lat: 53.8, lng: -1.5 },
      { lat: 53.9, lng: -1.0 },
    ]);
  });

  it("returns [] for an unroutable job rather than a partial route", () => {
    expect(jobWaypoints(job([stop({}), stop({ id: "s2", stop_order: 2, lat: null })]))).toEqual([]);
  });
});

describe("jobRepresentativePoint", () => {
  it("is the first stop by stop_order", () => {
    const j = job([
      stop({ id: "a", stop_order: 2, lat: 53.9, lng: -1.0 }),
      stop({ id: "b", stop_order: 1, lat: 53.8, lng: -1.5 }),
    ]);
    expect(jobRepresentativePoint(j)).toEqual({ lat: 53.8, lng: -1.5 });
  });

  it("is null for an unroutable job", () => {
    expect(jobRepresentativePoint(job([]))).toBeNull();
  });
});

describe("laneWaypoints", () => {
  it("concatenates routable jobs in the given order and skips unroutable ones", () => {
    const j1 = job([stop({ id: "a", lat: 1, lng: 1 })], { id: "j1" });
    const broken = job([stop({ id: "b", lat: null })], { id: "j2" });
    const j3 = job([stop({ id: "c", lat: 3, lng: 3 })], { id: "j3" });
    expect(laneWaypoints([j1, broken, j3])).toEqual([
      { lat: 1, lng: 1 },
      { lat: 3, lng: 3 },
    ]);
  });
});


describe("Smart Optimize entry and exit points", () => {
  it("uses stop_order rather than array order", () => {
    const job = {
      id: "job-1",
      tenant_id: "tenant-1",
      reference: "JOB-1",
      status: "planned",
      collection_eta: null,
      delivery_eta: null,
      acceptance_note: null,
      accepted_at: null,
      accepted_by: null,
      vehicle_id: "vehicle-1",
      driver_id: null,
      subcontractor_id: null,
      route_order: 1,
      customer_name: null,
      stops: [
        {
          id: "delivery",
          stop_order: 2,
          type: "delivery",
          address_line: "Delivery",
          city: null,
          postcode: "BB1 1BB",
          lat: 53.2,
          lng: -1.2,
        },
        {
          id: "collection",
          stop_order: 1,
          type: "collection",
          address_line: "Collection",
          city: null,
          postcode: "AA1 1AA",
          lat: 53.1,
          lng: -1.1,
        },
      ],
    };

    expect(jobEntryPoint(job)).toEqual({ lat: 53.1, lng: -1.1 });
    expect(jobExitPoint(job)).toEqual({ lat: 53.2, lng: -1.2 });
    expect(jobWaypoints(job)).toEqual([
      { lat: 53.1, lng: -1.1 },
      { lat: 53.2, lng: -1.2 },
    ]);
  });
});

describe("fastPlotWaypoints", () => {
  it("plots multiple collections once before one shared delivery", () => {
    const sharedDelivery = {
      lat: 53.592,
      lng: -2.219,
    };

    const jobs = [
      job(
        [
          stop({
            id: "c1",
            stop_order: 1,
            type: "collection",
            lat: 55.953,
            lng: -3.189,
          }),
          stop({
            id: "d1",
            stop_order: 2,
            type: "delivery",
            ...sharedDelivery,
          }),
        ],
        { id: "j1" }
      ),
      job(
        [
          stop({
            id: "c2",
            stop_order: 1,
            type: "collection",
            lat: 56.071,
            lng: -3.452,
          }),
          stop({
            id: "d2",
            stop_order: 2,
            type: "delivery",
            ...sharedDelivery,
          }),
        ],
        { id: "j2" }
      ),
      job(
        [
          stop({
            id: "c3",
            stop_order: 1,
            type: "collection",
            lat: 55.990,
            lng: -3.398,
          }),
          stop({
            id: "d3",
            stop_order: 2,
            type: "delivery",
            ...sharedDelivery,
          }),
        ],
        { id: "j3" }
      ),
    ];

    expect(fastPlotWaypoints(jobs)).toEqual([
      { lat: 55.953, lng: -3.189 },
      { lat: 56.071, lng: -3.452 },
      { lat: 55.990, lng: -3.398 },
      sharedDelivery,
    ]);
  });

  it("plots one shared collection once before multiple deliveries", () => {
    const sharedCollection = {
      lat: 53.592,
      lng: -2.219,
    };

    const jobs = [
      job(
        [
          stop({
            id: "c1",
            stop_order: 1,
            type: "collection",
            ...sharedCollection,
          }),
          stop({
            id: "d1",
            stop_order: 2,
            type: "delivery",
            lat: 55.953,
            lng: -3.189,
          }),
        ],
        { id: "j1" }
      ),
      job(
        [
          stop({
            id: "c2",
            stop_order: 1,
            type: "collection",
            ...sharedCollection,
          }),
          stop({
            id: "d2",
            stop_order: 2,
            type: "delivery",
            lat: 56.071,
            lng: -3.452,
          }),
        ],
        { id: "j2" }
      ),
    ];

    expect(fastPlotWaypoints(jobs)).toEqual([
      sharedCollection,
      { lat: 55.953, lng: -3.189 },
      { lat: 56.071, lng: -3.452 },
    ]);
  });

  it("deduplicates coordinates across the complete fast plot", () => {
    const jobs = [
      job(
        [
          stop({
            id: "c1",
            type: "collection",
            stop_order: 1,
            lat: 53.8,
            lng: -1.55,
          }),
          stop({
            id: "d1",
            type: "delivery",
            stop_order: 2,
            lat: 54.0,
            lng: -2.0,
          }),
        ],
        { id: "j1" }
      ),
      job(
        [
          stop({
            id: "c2",
            type: "collection",
            stop_order: 1,
            lat: 53.8,
            lng: -1.55,
          }),
          stop({
            id: "d2",
            type: "delivery",
            stop_order: 2,
            lat: 54.0,
            lng: -2.0,
          }),
        ],
        { id: "j2" }
      ),
    ];

    expect(fastPlotWaypoints(jobs)).toEqual([
      { lat: 53.8, lng: -1.55 },
      { lat: 54.0, lng: -2.0 },
    ]);
  });

  it("keeps mappable stops from partially geocoded jobs", () => {
    const j = job([
      stop({
        id: "c1",
        type: "collection",
        stop_order: 1,
        lat: 53.8,
        lng: -1.55,
      }),
      stop({
        id: "d1",
        type: "delivery",
        stop_order: 2,
        lat: null,
        lng: null,
      }),
    ]);

    expect(fastPlotWaypoints([j])).toEqual([
      { lat: 53.8, lng: -1.55 },
    ]);
  });

  it("does not mutate job or stop order", () => {
    const first = stop({
      id: "delivery",
      type: "delivery",
      stop_order: 2,
      lat: 54.0,
      lng: -2.0,
    });
    const second = stop({
      id: "collection",
      type: "collection",
      stop_order: 1,
      lat: 53.8,
      lng: -1.55,
    });
    const j = job([first, second]);

    fastPlotWaypoints([j]);

    expect(j.stops.map((item) => item.id)).toEqual([
      "delivery",
      "collection",
    ]);
  });
});

describe("Fast Plot phase optimization safety", () => {
  it("builds unique collection and delivery phases independently", () => {
    const j1 = job(
      [
        stop({
          id: "c1",
          type: "collection",
          stop_order: 1,
          lat: 53.8,
          lng: -1.55,
        }),
        stop({
          id: "d1",
          type: "delivery",
          stop_order: 2,
          lat: 54.0,
          lng: -2.0,
        }),
      ],
      { id: "j1" }
    );

    const j2 = job(
      [
        stop({
          id: "c2",
          type: "collection",
          stop_order: 1,
          lat: 53.8,
          lng: -1.55,
        }),
        stop({
          id: "d2",
          type: "delivery",
          stop_order: 2,
          lat: 55.0,
          lng: -3.0,
        }),
      ],
      { id: "j2" }
    );

    expect(fastPlotPhases([j1, j2])).toEqual({
      collections: [{ lat: 53.8, lng: -1.55 }],
      deliveries: [
        { lat: 54.0, lng: -2.0 },
        { lat: 55.0, lng: -3.0 },
      ],
      other: [],
    });
  });

  it("reorders one phase using a complete optimizer permutation", () => {
    const points = [
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ];

    expect(reorderFastPlotPhase(points, [2, 0, 1])).toEqual([
      { lat: 3, lng: 3 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ]);
  });

  it("falls back when an optimizer drops or duplicates a point", () => {
    const points = [
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ];

    expect(reorderFastPlotPhase(points, [0, 1])).toEqual(points);
    expect(reorderFastPlotPhase(points, [0, 1, 1])).toEqual(points);
    expect(reorderFastPlotPhase(points, [0, 1, 9])).toEqual(points);
  });

  it("keeps collection phase before delivery phase after optimization", () => {
    const result = fastPlotWaypointsFromPhases({
      collections: [
        { lat: 2, lng: 2 },
        { lat: 1, lng: 1 },
      ],
      deliveries: [
        { lat: 4, lng: 4 },
        { lat: 3, lng: 3 },
      ],
      other: [],
    });

    expect(result).toEqual([
      { lat: 2, lng: 2 },
      { lat: 1, lng: 1 },
      { lat: 4, lng: 4 },
      { lat: 3, lng: 3 },
    ]);
  });

  it("deduplicates a shared coordinate across phase boundaries", () => {
    expect(
      fastPlotWaypointsFromPhases({
        collections: [
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 },
        ],
        deliveries: [
          { lat: 2, lng: 2 },
          { lat: 3, lng: 3 },
        ],
        other: [],
      })
    ).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ]);
  });
});

describe("Fast Plot anchored matrix boundary", () => {
  it("keeps shared-delivery semantics at both 9 and 10 movable collections", () => {
    expect(fastPlotOptimizationMode(9, 1)).toBe("anchored-delivery");
    expect(fastPlotOptimizationMode(10, 1)).toBe("anchored-delivery");
  });

  it("keeps shared-collection semantics at both 9 and 10 movable deliveries", () => {
    expect(fastPlotOptimizationMode(1, 9)).toBe("anchored-collection");
    expect(fastPlotOptimizationMode(1, 10)).toBe("anchored-collection");
  });

  it("uses independent optimization for genuinely mixed phases", () => {
    expect(fastPlotOptimizationMode(2, 2)).toBe("independent");
    expect(fastPlotOptimizationMode(10, 10)).toBe("independent");
  });
});
