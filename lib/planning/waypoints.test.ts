import { describe, expect, it } from "vitest";
import {
  isRoutable,
  jobEntryPoint,
  jobExitPoint,
  jobRepresentativePoint,
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
