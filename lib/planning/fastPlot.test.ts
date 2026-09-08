import { describe, expect, it, vi } from "vitest";
import {
  buildFastPlotVisits,
  fallbackFastPlotOrder,
  hasPhysicalPrecedenceCycle,
  jobsInFastPlotOrder,
  optimizeFastPlotOrder,
  optimizeFastPlotOrderFromStart,
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

describe("Fast Plot V5", () => {
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

  it("supports more than ten physical locations with bounded matrices", async () => {
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

  it("looks ahead past a nearest-next greedy trap", async () => {
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 1, 0),
        stop("a-d", 2, "delivery", 4, 0),
      ]),
      job("b", [
        stop("b-c", 1, "collection", 2, 0),
        stop("b-d", 2, "delivery", 3, 0),
      ]),
    ];

    const costs = new Map<string, number>([
      ["1,0>2,0", 1],
      ["1,0>4,0", 1],
      ["2,0>3,0", 1],
      ["2,0>4,0", 100],
      ["3,0>4,0", 100],
      ["3,0>1,0", 100],
      ["4,0>2,0", 1],
      ["4,0>3,0", 1],
    ]);

    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map((origin) =>
      destinations.map((destination) => {
        if (
          origin.lat === destination.lat &&
          origin.lng === destination.lng
        ) {
          return 0;
        }

        return costs.get(
          `${origin.lat},${origin.lng}>${destination.lat},${destination.lng}`
        ) ?? 50;
      })
    ));

    const route = await optimizeFastPlotOrder(jobs, loader);

    expect(route).toEqual([
      { lat: 1, lng: 0 },
      { lat: 4, lng: 0 },
      { lat: 2, lng: 0 },
      { lat: 3, lng: 0 },
    ]);
  });

  it("keeps every V5 TomTom matrix request within 100 cells", async () => {
    const jobs = Array.from({ length: 14 }, (_, index) =>
      job(`beam-${index}`, [
        stop(
          `beam-c-${index}`,
          1,
          "collection",
          50 + index / 10,
          -3
        ),
        stop("beam-shared", 2, "delivery", 53.59, -2.22),
      ])
    );

    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map((origin) =>
      destinations.map((destination) =>
        secondsBetween(origin, destination)
      )
    ));

    const route = await optimizeFastPlotOrder(jobs, loader);

    expect(route).toHaveLength(15);

    for (const [origins, destinations] of loader.mock.calls) {
      expect(
        origins.length * destinations.length
      ).toBeLessThanOrEqual(100);
    }
  });

  it("produces deterministic V5 ordering when route costs tie", async () => {
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 1, 1),
        stop("a-d", 2, "delivery", 3, 3),
      ]),
      job("b", [
        stop("b-c", 1, "collection", 2, 2),
        stop("b-d", 2, "delivery", 4, 4),
      ]),
    ];

    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map((origin) =>
      destinations.map((destination) =>
        origin.lat === destination.lat &&
        origin.lng === destination.lng
          ? 0
          : 1
      )
    ));

    const first = await optimizeFastPlotOrder(jobs, loader);
    const second = await optimizeFastPlotOrder(jobs, loader);

    expect(second).toEqual(first);
  });


  it("avoids leaving and later re-entering a geographic work area", async () => {
    const jobs = [
      job("area-a", [
        stop("area-a-c", 1, "collection", 55.95, -3.19),
        stop("area-a-d", 2, "delivery", 53.59, -2.22),
      ]),
      job("area-b", [
        stop("area-b-c", 1, "collection", 55.98, -3.10),
        stop("area-b-d", 2, "delivery", 53.59, -2.22),
      ]),
      job("west", [
        stop("west-c", 1, "collection", 55.86, -4.25),
        stop("west-d", 2, "delivery", 55.86, -4.25),
      ]),
    ];

    const costs = new Map<string, number>([
      ["55.95,-3.19>55.86,-4.25", 10],
      ["55.86,-4.25>55.98,-3.1", 10],
      ["55.95,-3.19>55.98,-3.1", 100],
      ["55.98,-3.1>55.86,-4.25", 100],
    ]);

    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map((origin) =>
      destinations.map((destination) => {
        if (
          origin.lat === destination.lat &&
          origin.lng === destination.lng
        ) {
          return 0;
        }

        return costs.get(
          `${origin.lat},${origin.lng}>${destination.lat},${destination.lng}`
        ) ?? secondsBetween(origin, destination);
      })
    ));

    const route = await optimizeFastPlotOrder(jobs, loader);
    const firstArea = route.findIndex(
      (point) => point.lat === 55.95
    );
    const secondArea = route.findIndex(
      (point) => point.lat === 55.98
    );
    const west = route.findIndex(
      (point) => point.lat === 55.86
    );

    expect(firstArea).toBeGreaterThanOrEqual(0);
    expect(secondArea).toBeGreaterThanOrEqual(0);
    expect(west).toBeGreaterThanOrEqual(0);

    expect(Math.abs(firstArea - secondArea)).toBe(1);

    const areaMin = Math.min(firstArea, secondArea);
    const areaMax = Math.max(firstArea, secondArea);

    expect(
      west < areaMin || west > areaMax
    ).toBe(true);
  });

  it("keeps nearby legal work together before leaving its cluster", async () => {
    const jobs = [
      job("east-one", [
        stop("east-one-c", 1, "collection", 55.95, -3.19),
        stop("shared", 2, "delivery", 53.59, -2.22),
      ]),
      job("east-two", [
        stop("east-two-c", 1, "collection", 55.96, -3.05),
        stop("shared", 2, "delivery", 53.59, -2.22),
      ]),
      job("far", [
        stop("far-c", 1, "collection", 56.46, -2.97),
        stop("shared", 2, "delivery", 53.59, -2.22),
      ]),
    ];

    const route = await optimizeFastPlotOrder(jobs, costLoader);

    const eastOne = route.findIndex(
      (point) => point.lat === 55.95
    );
    const eastTwo = route.findIndex(
      (point) => point.lat === 55.96
    );
    const far = route.findIndex(
      (point) => point.lat === 56.46
    );

    expect(Math.abs(eastOne - eastTwo)).toBe(1);

    const eastMin = Math.min(eastOne, eastTwo);
    const eastMax = Math.max(eastOne, eastTwo);

    expect(
      far < eastMin || far > eastMax
    ).toBe(true);
  });

  it("never breaks stop precedence to avoid an area re-entry", async () => {
    const jobs = [
      job("precedence", [
        stop("first", 1, "collection", 55.95, -3.19),
        stop("middle", 2, "other", 55.86, -4.25),
        stop("last", 3, "delivery", 55.98, -3.10),
      ]),
    ];

    const route = await optimizeFastPlotOrder(jobs, costLoader);

    expect(route).toEqual([
      { lat: 55.95, lng: -3.19 },
      { lat: 55.86, lng: -4.25 },
      { lat: 55.98, lng: -3.10 },
    ]);
  });

  it("keeps small local work routable without artificial direction rules", async () => {
    const jobs = [
      job("local-a", [
        stop("local-a-c", 1, "collection", 55.95, -3.19),
        stop("shared", 2, "delivery", 53.59, -2.22),
      ]),
      job("local-b", [
        stop("local-b-c", 1, "collection", 55.96, -3.15),
        stop("shared", 2, "delivery", 53.59, -2.22),
      ]),
      job("local-c", [
        stop("local-c-c", 1, "collection", 55.94, -3.12),
        stop("shared", 2, "delivery", 53.59, -2.22),
      ]),
    ];

    const route = await optimizeFastPlotOrder(jobs, costLoader);

    expect(route).toHaveLength(4);
    expect(route.at(-1)).toEqual({
      lat: 53.59,
      lng: -2.22,
    });
  });


  it("uses bounded sparse TomTom requests for 70 physical visits", async () => {
    const jobs = Array.from({ length: 35 }, (_, index) =>
      job(`large-${index}`, [
        stop(
          `large-c-${index}`,
          1,
          "collection",
          50 + index / 100,
          -4
        ),
        stop(
          `large-d-${index}`,
          2,
          "delivery",
          51 + index / 100,
          -3
        ),
      ])
    );

    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map((origin) =>
      destinations.map((destination) =>
        secondsBetween(origin, destination)
      )
    ));

    const route = await optimizeFastPlotOrder(jobs, loader);

    expect(route).toHaveLength(70);
    expect(loader.mock.calls.length).toBeLessThanOrEqual(32);

    for (const [origins, destinations] of loader.mock.calls) {
      expect(origins.length).toBeGreaterThan(0);
      expect(destinations.length).toBeGreaterThan(0);
      expect(origins.length * destinations.length).toBeLessThanOrEqual(100);
    }

    const positions = new Map(
      route.map((point, index) => [`${point.lat},${point.lng}`, index])
    );

    for (let index = 0; index < 35; index++) {
      const collectionIndex = positions.get(
        `${50 + index / 100},-4`
      );
      const deliveryIndex = positions.get(
        `${51 + index / 100},-3`
      );

      expect(collectionIndex).toBeDefined();
      expect(deliveryIndex).toBeDefined();

      if (
        collectionIndex === undefined ||
        deliveryIndex === undefined
      ) {
        throw new Error("Expected collection and delivery in sparse route.");
      }

      expect(collectionIndex).toBeLessThan(deliveryIndex);
    }
  });

  it("does not construct an all-to-all matrix for 350 two-stop jobs", async () => {
    const jobs = Array.from({ length: 350 }, (_, index) =>
      job(`courier-${index}`, [
        stop(
          `courier-c-${index}`,
          1,
          "collection",
          50 + index / 10000,
          -4
        ),
        stop(
          `courier-d-${index}`,
          2,
          "delivery",
          52 + index / 10000,
          -2
        ),
      ])
    );

    let requestedCells = 0;

    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => {
      requestedCells += origins.length * destinations.length;

      return origins.map((origin) =>
        destinations.map((destination) =>
          secondsBetween(origin, destination)
        )
      );
    });

    const route = await optimizeFastPlotOrder(jobs, loader);

    expect(route).toHaveLength(700);
    expect(loader.mock.calls.length).toBeLessThanOrEqual(32);
    expect(requestedCells).toBeLessThanOrEqual(4000);
    expect(requestedCells).toBeLessThan(700 * 700);

    for (const [origins, destinations] of loader.mock.calls) {
      expect(origins.length * destinations.length).toBeLessThanOrEqual(100);
    }

    const positions = new Map(
      route.map((point, index) => [`${point.lat},${point.lng}`, index])
    );

    for (let index = 0; index < 350; index++) {
      const collectionIndex = positions.get(
        `${50 + index / 10000},-4`
      );
      const deliveryIndex = positions.get(
        `${52 + index / 10000},-2`
      );

      expect(collectionIndex).toBeDefined();
      expect(deliveryIndex).toBeDefined();

      if (
        collectionIndex === undefined ||
        deliveryIndex === undefined
      ) {
        throw new Error("Expected collection and delivery in sparse route.");
      }

      expect(collectionIndex).toBeLessThan(deliveryIndex);
    }
  });

  it("stops sparse matrix loading after the first failed request", async () => {
    const jobs = Array.from({ length: 31 }, (_, index) =>
      job(`failure-${index}`, [
        stop(
          `failure-c-${index}`,
          1,
          "collection",
          50 + index / 100,
          -5
        ),
        stop(
          `failure-d-${index}`,
          2,
          "delivery",
          53 + index / 100,
          -2
        ),
      ])
    );

    const loader = vi.fn(async () => null);

    const first = await optimizeFastPlotOrder(jobs, loader);
    const second = await optimizeFastPlotOrder(jobs, loader);

    expect(first).toHaveLength(62);
    expect(second).toEqual(first);

    // One failed load per independent optimization; no retry storm.
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps sparse routing deterministic after the TomTom budget is exhausted", async () => {
    const jobs = Array.from({ length: 40 }, (_, index) =>
      job(`deterministic-${index}`, [
        stop(
          `deterministic-c-${index}`,
          1,
          "collection",
          54 + index / 1000,
          -4
        ),
        stop(
          `deterministic-d-${index}`,
          2,
          "delivery",
          55 + index / 1000,
          -3
        ),
      ])
    );

    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map((origin) =>
      destinations.map((destination) =>
        secondsBetween(origin, destination)
      )
    ));

    const first = await optimizeFastPlotOrder(jobs, loader);
    loader.mockClear();
    const second = await optimizeFastPlotOrder(jobs, loader);

    expect(second).toEqual(first);
    expect(loader.mock.calls.length).toBeLessThanOrEqual(32);
  });

  it("maps a physical Fast Plot route back to stable job order", () => {
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 10, 0),
        stop("a-d", 2, "delivery", 20, 0),
      ]),
      job("b", [
        stop("b-c", 1, "collection", 30, 0),
        stop("b-d", 2, "delivery", 40, 0),
      ]),
    ];

    expect(
      jobsInFastPlotOrder(jobs, [
        { lat: 30, lng: 0 },
        { lat: 10, lng: 0 },
        { lat: 20, lng: 0 },
        { lat: 40, lng: 0 },
      ])
    ).toEqual(["b", "a"]);
  });

  it("keeps lane order when jobs share the same first physical visit", () => {
    const jobs = [
      job("first", [
        stop("first-c", 1, "collection", 10, 0),
        stop("first-d", 2, "delivery", 20, 0),
      ]),
      job("second", [
        stop("second-c", 1, "collection", 10, 0),
        stop("second-d", 2, "delivery", 30, 0),
      ]),
    ];

    expect(
      jobsInFastPlotOrder(jobs, [
        { lat: 10, lng: 0 },
        { lat: 30, lng: 0 },
        { lat: 20, lng: 0 },
      ])
    ).toEqual(["first", "second"]);
  });

  it("keeps unmatched routable jobs deterministically instead of deleting them", () => {
    const jobs = [
      job("matched", [
        stop("matched-c", 1, "collection", 10, 0),
        stop("matched-d", 2, "delivery", 20, 0),
      ]),
      job("unmatched", [
        stop("unmatched-c", 1, "collection", 30, 0),
        stop("unmatched-d", 2, "delivery", 40, 0),
      ]),
    ];

    expect(
      jobsInFastPlotOrder(jobs, [
        { lat: 10, lng: 0 },
        { lat: 20, lng: 0 },
      ])
    ).toEqual(["matched", "unmatched"]);
  });

  it("preserves every lane job exactly once when converting Fast Plot order", () => {
    const unroutable = job("no-map", []);
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 1, 0),
        stop("a-d", 2, "delivery", 4, 0),
      ]),
      unroutable,
      job("b", [
        stop("b-c", 1, "collection", 2, 0),
        stop("b-d", 2, "delivery", 3, 0),
      ]),
    ];

    const order = jobsInFastPlotOrder(jobs, [
      { lat: 2, lng: 0 },
      { lat: 3, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 4, lng: 0 },
    ]);

    expect(order).toEqual(["b", "a", "no-map"]);
    expect(new Set(order)).toEqual(
      new Set(jobs.map((item) => item.id))
    );
    expect(order).toHaveLength(jobs.length);
  });

  it("anchors Job 1 to the reachable visit with the lowest directed TomTom time", async () => {
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 1, 0),
        stop("a-d", 2, "delivery", 4, 0),
      ]),
      job("b", [
        stop("b-c", 1, "collection", 2, 0),
        stop("b-d", 2, "delivery", 3, 0),
      ]),
    ];

    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map((origin) =>
      destinations.map((destination) => {
        if (origin.lat === 0 && origin.lng === 0) {
          if (destination.lat === 1) return 100;
          if (destination.lat === 2) return 10;
        }

        return secondsBetween(origin, destination);
      })
    ));

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 0, lng: 0 },
      loader,
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.route[0]).toEqual({ lat: 2, lng: 0 });
      expect(result.firstTravelSeconds).toBe(10);
    }
  });

  it("reports an unavailable van-to-first-stop cost separately", async () => {
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 1, 0),
        stop("a-d", 2, "delivery", 4, 0),
      ]),
      job("b", [
        stop("b-c", 1, "collection", 2, 0),
        stop("b-d", 2, "delivery", 3, 0),
      ]),
    ];

    const loader = vi.fn(async () => {
      throw new Error("anchor lookup unavailable");
    });

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 0, lng: 0 },
      loader,
    );

    expect(result).toEqual({
      ok: false,
      reason: "start_cost_unavailable",
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("reports remaining route costs separately after anchoring Drop 1", async () => {
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 1, 0),
        stop("a-d", 2, "delivery", 4, 0),
      ]),
      job("b", [
        stop("b-c", 1, "collection", 2, 0),
        stop("b-d", 2, "delivery", 3, 0),
      ]),
    ];

    let callNumber = 0;
    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[],
    ) => {
      callNumber += 1;

      if (callNumber === 1) {
        return origins.map((origin) =>
          destinations.map((destination) =>
            secondsBetween(origin, destination)
          )
        );
      }

      throw new Error("remaining route costs unavailable");
    });

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 0, lng: 0 },
      loader,
    );

    expect(result).toEqual({
      ok: false,
      reason: "route_cost_unavailable",
    });

    expect(loader.mock.calls.length).toBeGreaterThanOrEqual(2);

    const [anchorOrigins, anchorDestinations] = loader.mock.calls[0];
    expect(anchorOrigins).toEqual([{ lat: 0, lng: 0 }]);
    expect(anchorDestinations).toEqual([
      { lat: 1, lng: 0 },
      { lat: 2, lng: 0 },
    ]);
  });

  it("ignores individually unreachable anchored candidates", async () => {
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 1, 0),
        stop("a-d", 2, "delivery", 4, 0),
      ]),
      job("b", [
        stop("b-c", 1, "collection", 2, 0),
        stop("b-d", 2, "delivery", 3, 0),
      ]),
    ];

    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map((origin) =>
      destinations.map((destination) => {
        if (origin.lat === 0 && origin.lng === 0) {
          return destination.lat === 1
            ? Number.POSITIVE_INFINITY
            : 20;
        }

        return secondsBetween(origin, destination);
      })
    ));

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 0, lng: 0 },
      loader,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.route[0]).toEqual({ lat: 2, lng: 0 });
    }
  });

  it("fails explicitly when every anchored first visit is unreachable", async () => {
    const jobs = [
      job("a", [
        stop("a-c", 1, "collection", 1, 0),
        stop("a-d", 2, "delivery", 2, 0),
      ]),
    ];

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 0, lng: 0 },
      async (origins, destinations) =>
        origins.map(() =>
          destinations.map(() => Number.POSITIVE_INFINITY)
        ),
    );

    expect(result).toEqual({
      ok: false,
      reason: "no_reachable_first_visit",
    });
  });

  it("keeps anchored lookup requests within 100 cells for a large lane", async () => {
    const jobs = Array.from({ length: 350 }, (_, index) =>
      job(`anchor-${index}`, [
        stop(
          `anchor-c-${index}`,
          1,
          "collection",
          50 + index / 10000,
          -4,
        ),
        stop(
          `anchor-d-${index}`,
          2,
          "delivery",
          52 + index / 10000,
          -2,
        ),
      ])
    );

    const loader = vi.fn(async (
      origins: LatLng[],
      destinations: LatLng[]
    ) => origins.map((origin) =>
      destinations.map((destination) =>
        secondsBetween(origin, destination)
      )
    ));

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 49, lng: -4 },
      loader,
    );

    expect(result.ok).toBe(true);
    for (const [origins, destinations] of loader.mock.calls) {
      expect(origins.length * destinations.length).toBeLessThanOrEqual(100);
    }

    // Four 1x100-or-smaller anchor chunks plus the existing 32 sparse budget.
    expect(loader.mock.calls.length).toBeLessThanOrEqual(36);
  });

  it("does not claim closest-first for a route requiring a physical revisit", async () => {
    const jobs = [
      job("revisit", [
        stop("first", 1, "collection", 1, 1),
        stop("middle", 2, "other", 2, 2),
        stop("last", 3, "delivery", 1, 1),
      ]),
    ];

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 0, lng: 0 },
      costLoader,
    );

    expect(result).toEqual({
      ok: false,
      reason: "unsupported_physical_route",
    });
  });

  it("continues anchored selection when an earlier 100-candidate chunk is unavailable", async () => {
    const jobs = Array.from({ length: 101 }, (_, index) =>
      job(`chunk-${index}`, [
        stop(
          `chunk-c-${index}`,
          1,
          "collection",
          50 + index / 10000,
          -4
        ),
        stop(
          `chunk-d-${index}`,
          2,
          "delivery",
          52 + index / 10000,
          -4
        ),
      ])
    );

    let callNumber = 0;

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 49, lng: -4 },
      async (origins, destinations) => {
        callNumber += 1;

        if (callNumber === 1) {
          throw new Error("first anchor chunk temporarily unavailable");
        }

        return origins.map(() =>
          destinations.map((destination) =>
            Math.round((destination.lat - 49) * 1000)
          )
        );
      }
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.orderedVisits[0].point).toEqual({
        lat: 50.01,
        lng: -4,
      });
      expect(result.firstTravelSeconds).toBe(1010);
    }
  });

  it("reports start cost unavailable only when every anchor chunk is unavailable", async () => {
    const jobs = Array.from({ length: 101 }, (_, index) =>
      job(`all-fail-${index}`, [
        stop(
          `all-fail-c-${index}`,
          1,
          "collection",
          50 + index / 10000,
          -4
        ),
        stop(
          `all-fail-d-${index}`,
          2,
          "delivery",
          52 + index / 10000,
          -4
        ),
      ])
    );

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 49, lng: -4 },
      async () => {
        throw new Error("matrix unavailable");
      }
    );

    expect(result).toEqual({
      ok: false,
      reason: "start_cost_unavailable",
    });
  });

  it("reports no reachable first visit when a successful anchor chunk contains only unreachable cells", async () => {
    const jobs = [
      job("unreachable", [
        stop("unreachable-c", 1, "collection", 50, -4),
        stop("unreachable-d", 2, "delivery", 51, -4),
      ]),
    ];

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 49, lng: -4 },
      async (origins, destinations) =>
        origins.map(() =>
          destinations.map(() => Number.POSITIVE_INFINITY)
        )
    );

    expect(result).toEqual({
      ok: false,
      reason: "no_reachable_first_visit",
    });
  });

});
