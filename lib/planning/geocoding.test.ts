import { describe, expect, it } from "vitest";
import { geocodeQuery, stopsNeedingGeocode } from "./geocoding";
import type { PlanJob, PlanStop } from "./types";

function stop(overrides: Partial<PlanStop>): PlanStop {
  return {
    id: "s1", stop_order: 1, type: "collection",
    address_line: "1 Dock Rd", city: "Leeds", postcode: "LS1 1AA",
    lat: 53.8, lng: -1.55,
    ...overrides,
  };
}

function job(stops: PlanStop[], id = "j1"): PlanJob {
  return {
    id, tenant_id: "t1", reference: "JOB-1", status: "planned",
    collection_eta: null, delivery_eta: null, acceptance_note: null,
    accepted_at: null, accepted_by: null,
    vehicle_id: null, driver_id: null, subcontractor_id: null,
    route_order: null, customer_name: "Acme", stops,
  };
}

describe("geocodeQuery", () => {
  it("joins the parts with commas", () => {
    expect(geocodeQuery({ address_line: "1 Dock Rd", city: "Leeds", postcode: "LS1 1AA" }))
      .toBe("1 Dock Rd, Leeds, LS1 1AA");
  });

  it("drops null and blank parts", () => {
    expect(geocodeQuery({ address_line: "1 Dock Rd", city: null, postcode: "LS1 1AA" }))
      .toBe("1 Dock Rd, LS1 1AA");
    expect(geocodeQuery({ address_line: "1 Dock Rd", city: "  ", postcode: null }))
      .toBe("1 Dock Rd");
  });

  it("trims whitespace inside kept parts", () => {
    expect(geocodeQuery({ address_line: " 1 Dock Rd ", city: "Leeds", postcode: null }))
      .toBe("1 Dock Rd, Leeds");
  });
});

describe("stopsNeedingGeocode", () => {
  it("returns ids of stops missing either coordinate, across jobs", () => {
    const jobs = [
      job([stop({ id: "a" }), stop({ id: "b", stop_order: 2, lat: null })], "j1"),
      job([stop({ id: "c", lng: null })], "j2"),
    ];
    expect(stopsNeedingGeocode(jobs)).toEqual(["b", "c"]);
  });

  it("is empty when everything is geocoded", () => {
    expect(stopsNeedingGeocode([job([stop({})])])).toEqual([]);
  });
});
