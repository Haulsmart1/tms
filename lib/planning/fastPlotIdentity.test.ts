import { describe, expect, it } from "vitest";
import {
  optimizeFastPlotOrderFromStart,
  type FastPlotCostLoader,
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

function job(id: string, stops: PlanStop[]): PlanJob {
  return {
    id,
    tenant_id: "tenant-1",
    reference: id,
    status: "planned",
    collection_eta: null,
    delivery_eta: null,
    acceptance_note: null,
    accepted_at: null,
    accepted_by: null,
    vehicle_id: "vehicle-1",
    driver_id: null,
    subcontractor_id: null,
    route_order: null,
    customer_name: null,
    stops,
  };
}

function travelSeconds(origin: LatLng, destination: LatLng): number {
  const lat = Math.abs(destination.lat - origin.lat);
  const lng = Math.abs(destination.lng - origin.lng);
  return Math.round((lat + lng) * 1000);
}

const loadCosts: FastPlotCostLoader = async (
  origins,
  destinations
) =>
  origins.map((origin) =>
    destinations.map((destination) =>
      travelSeconds(origin, destination)
    )
  );

describe("anchored Fast Plot physical identity", () => {
  it("returns ordered visits whose points exactly match the public route", async () => {
    const jobs = [
      job("A", [
        stop("A1", 1, "collection", 1, 0),
        stop("A2", 2, "delivery", 3, 0),
      ]),
      job("B", [
        stop("B1", 1, "collection", 2, 0),
        stop("B2", 2, "delivery", 3, 0),
      ]),
    ];

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 0, lng: 0 },
      loadCosts
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(
      result.orderedVisits.map((visit) => visit.point)
    ).toEqual(result.route);

    expect(result.orderedVisits[0].point).toEqual({
      lat: 1,
      lng: 0,
    });

    const shared = result.orderedVisits.find(
      (visit) => visit.point.lat === 3 && visit.point.lng === 0
    );

    expect(shared).toBeDefined();
    expect(shared?.requirements).toEqual({
      A: [1],
      B: [1],
    });
  });

  it("preserves identity in the sparse large-route path", async () => {
    const jobs = Array.from({ length: 31 }, (_, index) => {
      const collection = index * 2 + 1;
      const delivery = index * 2 + 2;

      return job(`J${index}`, [
        stop(
          `J${index}-C`,
          1,
          "collection",
          collection,
          0
        ),
        stop(
          `J${index}-D`,
          2,
          "delivery",
          delivery,
          0
        ),
      ]);
    });

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 0, lng: 0 },
      loadCosts
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.route).toHaveLength(62);
    expect(result.orderedVisits).toHaveLength(62);

    expect(
      result.orderedVisits.map((visit) => visit.point)
    ).toEqual(result.route);

    expect(result.orderedVisits[0].point).toEqual({
      lat: 1,
      lng: 0,
    });

    for (const visit of result.orderedVisits) {
      expect(Object.keys(visit.requirements).length).toBeGreaterThan(0);
    }
  });

  it("preserves all requirements when multiple stops share one location", async () => {
    const jobs = [
      job("A", [
        stop("A1", 1, "collection", 1, 0),
        stop("A2", 2, "delivery", 1, 0),
      ]),
    ];

    const result = await optimizeFastPlotOrderFromStart(
      jobs,
      { lat: 0, lng: 0 },
      loadCosts
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.route).toEqual([{ lat: 1, lng: 0 }]);
    expect(result.orderedVisits).toHaveLength(1);
    expect(result.orderedVisits[0].requirements).toEqual({
      A: [0, 1],
    });
  });
});
