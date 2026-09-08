import { describe, expect, it } from "vitest";
import type { FastPlotVisit } from "./fastPlot";
import {
  buildPlanningPhysicalItinerary,
  PLANNING_STOP_SERVICE_SECONDS,
} from "./physicalItinerary";
import type { PlanJob, PlanStop } from "./types";

function stop(
  id: string,
  stopOrder: number,
  type: PlanStop["type"],
  lat: number,
  lng: number
): PlanStop {
  return {
    id,
    stop_order: stopOrder,
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

function visit(
  key: string,
  lat: number,
  lng: number,
  requirements: Record<string, number[]>
): FastPlotVisit {
  return {
    key,
    point: { lat, lng },
    requirements,
  };
}

describe("buildPlanningPhysicalItinerary", () => {
  it("keeps two services at one shared physical location", () => {
    const jobs = [
      job("A", [
        stop("A1", 1, "collection", 51, -1),
        stop("A2", 2, "delivery", 52, -2),
      ]),
      job("B", [
        stop("B1", 1, "collection", 50, -1),
        stop("B2", 2, "delivery", 52, -2),
      ]),
    ];

    const itinerary = buildPlanningPhysicalItinerary(jobs, [
      visit("a", 51, -1, { A: [0] }),
      visit("b", 50, -1, { B: [0] }),
      visit("shared", 52, -2, { A: [1], B: [1] }),
    ]);

    expect(itinerary.visits).toHaveLength(3);
    expect(itinerary.serviceStops).toHaveLength(4);
    expect(
      itinerary.visits[2].serviceStops.map((service) => service.stopId)
    ).toEqual(["A2", "B2"]);

    expect(itinerary.totalServiceSeconds).toBe(
      4 * PLANNING_STOP_SERVICE_SECONDS
    );
  });

  it("retains collection and delivery at identical coordinates", () => {
    const jobs = [
      job("A", [
        stop("A1", 10, "collection", 51, -1),
        stop("A2", 20, "delivery", 51, -1),
      ]),
    ];

    const itinerary = buildPlanningPhysicalItinerary(jobs, [
      visit("same", 51, -1, { A: [0, 1] }),
    ]);

    expect(itinerary.visits).toHaveLength(1);
    expect(itinerary.serviceStops).toHaveLength(2);

    expect(
      itinerary.serviceStops.map((service) => ({
        stopId: service.stopId,
        stopIndex: service.stopIndex,
        stopOrder: service.stopOrder,
        serviceSeconds: service.serviceSeconds,
      }))
    ).toEqual([
      {
        stopId: "A1",
        stopIndex: 0,
        stopOrder: 10,
        serviceSeconds: 600,
      },
      {
        stopId: "A2",
        stopIndex: 1,
        stopOrder: 20,
        serviceSeconds: 600,
      },
    ]);

    expect(itinerary.totalServiceSeconds).toBe(1200);
  });

  it("treats requirements as zero-based indexes, not stop_order", () => {
    const jobs = [
      job("A", [
        stop("A1", 10, "collection", 51, -1),
        stop("A2", 30, "delivery", 52, -2),
      ]),
    ];

    const itinerary = buildPlanningPhysicalItinerary(jobs, [
      visit("collection", 51, -1, { A: [0] }),
      visit("delivery", 52, -2, { A: [1] }),
    ]);

    expect(
      itinerary.serviceStops.map((service) => [
        service.stopId,
        service.stopIndex,
        service.stopOrder,
      ])
    ).toEqual([
      ["A1", 0, 10],
      ["A2", 1, 30],
    ]);
  });

  it("rejects a physical route that violates stop precedence", () => {
    const jobs = [
      job("A", [
        stop("A1", 1, "collection", 51, -1),
        stop("A2", 2, "delivery", 52, -2),
      ]),
    ];

    expect(() =>
      buildPlanningPhysicalItinerary(jobs, [
        visit("delivery", 52, -2, { A: [1] }),
        visit("collection", 51, -1, { A: [0] }),
      ])
    ).toThrow(/violates stop precedence/i);
  });

  it("rejects an itinerary that omits a service stop", () => {
    const jobs = [
      job("A", [
        stop("A1", 1, "collection", 51, -1),
        stop("A2", 2, "delivery", 52, -2),
      ]),
    ];

    expect(() =>
      buildPlanningPhysicalItinerary(jobs, [
        visit("collection", 51, -1, { A: [0] }),
      ])
    ).toThrow(/missing planning stops/i);
  });
});
