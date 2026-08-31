import { describe, it, expect } from "vitest";
import { isOnTheRoad, jobPhase, buildRail, routeEndpoints } from "./onTheRoad";
import type { TrackingJob, TrackingStop } from "./types";

const NOW = new Date("2026-08-14T12:00:00Z");
const TODAY = "2026-08-14";
const YESTERDAY = "2026-08-13";
const TOMORROW = "2026-08-15";

function stop(over: Partial<TrackingStop> = {}): TrackingStop {
  return {
    id: "s1", stop_order: 1, type: "delivery", address_line: "1 Dock Rd",
    city: "Hull", postcode: "HU3 4AB", lat: null, lng: null, planned_at: `${TODAY}T08:00:00Z`,
    delivered_at: null, pod_status: "pending", recipient_name: null,
    pod_updated_at: null, pod_photo_url: null, pod_document_url: null,
    ...over,
  };
}

function job(over: Partial<TrackingJob> = {}): TrackingJob {
  return {
    id: "j1", reference: "J-100", status: "planned", scheduled_date: TODAY,
    created_at: `${TODAY}T06:00:00Z`, customer_name: "Acme", vehicle_id: "v1",
    vehicle_registration: "YT19 KHR", driver_name: "A. Marsh",
    driver_phone: "07700900000", subcontractor_id: null,
    stops: [
      stop({ id: "s0", stop_order: 0, type: "collection", city: "Leeds", postcode: "LS10 1AA" }),
      stop(),
    ],
    ...over,
  };
}

describe("the operator's day boundary", () => {
  /* Constructed from explicit UTC instants rather than local-component `new
     Date(y, m, d)`, so these say what they mean regardless of what the runner's
     TZ happens to be. operatorDay owns the formatting and lib/time.test.ts
     pins it; what these two assert is that isOnTheRoad asks IT and gets the
     boundary right on both sides. */

  it("keeps a job scheduled for the operator's today on the road at 23:30 London", () => {
    // 22:30Z is 23:30 on the 14th in London during BST, still the 14th.
    const at = new Date("2026-08-14T22:30:00Z");
    expect(isOnTheRoad(job({ scheduled_date: "2026-08-14" }), at)).toBe(true);
  });

  it("keeps tomorrow's job off the rail at the same instant", () => {
    const at = new Date("2026-08-14T22:30:00Z");
    expect(isOnTheRoad(job({ scheduled_date: "2026-08-15" }), at)).toBe(false);
  });
});

describe("isOnTheRoad", () => {
  it("is true for an assigned, due, unfinished job", () => {
    expect(isOnTheRoad(job(), NOW)).toBe(true);
  });

  it("is true for an overdue job, which is the case that most needs showing", () => {
    expect(isOnTheRoad(job({ scheduled_date: YESTERDAY }), NOW)).toBe(true);
  });

  it("is false once the job is completed", () => {
    expect(isOnTheRoad(job({ status: "completed" }), NOW)).toBe(false);
  });

  it("is false with no vehicle assigned, because there is nothing to track", () => {
    expect(isOnTheRoad(job({ vehicle_id: null }), NOW)).toBe(false);
  });

  it("is false for a job scheduled in the future", () => {
    expect(isOnTheRoad(job({ scheduled_date: TOMORROW }), NOW)).toBe(false);
  });

  it("is false with no scheduled_date, which cannot be shown to be due", () => {
    expect(isOnTheRoad(job({ scheduled_date: null }), NOW)).toBe(false);
  });

  it("is false once every delivery stop is delivered", () => {
    const j = job();
    j.stops = j.stops.map((s) =>
      s.type === "delivery" ? { ...s, pod_status: "delivered" } : s,
    );
    expect(isOnTheRoad(j, NOW)).toBe(false);
  });

  it("is false for a job with no delivery stops at all", () => {
    // Mirrors the deliveryStops.length > 0 guard the POD completion cascade
    // applies in app/pod/page.tsx. A job with nothing to arrive at is not on
    // the road.
    expect(isOnTheRoad(job({ stops: [stop({ type: "collection" })] }), NOW)).toBe(false);
  });

  it("does NOT require the collection to be marked done", () => {
    // Nothing in the product prompts anyone to mark a collection: /pod only
    // ever surfaces delivery stops. Requiring it would leave the rail
    // permanently empty.
    expect(isOnTheRoad(job(), NOW)).toBe(true);
  });
});

describe("jobPhase", () => {
  it("is late when scheduled before today", () => {
    expect(jobPhase(job({ scheduled_date: YESTERDAY }), NOW)).toBe("late");
  });

  it("is due when scheduled today with nothing marked yet", () => {
    expect(jobPhase(job(), NOW)).toBe("due");
  });

  it("is in_progress when scheduled today and the collection is already delivered", () => {
    const j = job();
    j.stops[0] = { ...j.stops[0], pod_status: "delivered" };
    expect(jobPhase(j, NOW)).toBe("in_progress");
  });

  it("stays late even when the collection is already delivered, because late outranks progress", () => {
    const j = job({ scheduled_date: YESTERDAY });
    j.stops[0] = { ...j.stops[0], pod_status: "delivered" };
    expect(jobPhase(j, NOW)).toBe("late");
  });

  it("is in_progress on a multi-drop job once the first delivery lands and the second has not, which is the case the phase actually exists for", () => {
    const j = job({
      stops: [
        stop({ id: "s0", stop_order: 0, type: "collection", city: "Leeds" }),
        stop({ id: "s1", stop_order: 1, type: "delivery", city: "York", pod_status: "delivered" }),
        stop({ id: "s2", stop_order: 2, type: "delivery", city: "Hull", pod_status: "pending" }),
      ],
    });
    expect(jobPhase(j, NOW)).toBe("in_progress");
    expect(isOnTheRoad(j, NOW)).toBe(true);
  });
});

describe("routeEndpoints", () => {
  it("takes the collection as origin and the delivery as destination", () => {
    expect(routeEndpoints(job().stops)).toEqual({ origin: "Leeds", destination: "Hull" });
  });

  it("uses the LAST delivery on a multi-drop job, because that is where it finishes", () => {
    const stops = [
      stop({ id: "s0", stop_order: 0, type: "collection", city: "Leeds" }),
      stop({ id: "s1", stop_order: 1, city: "York" }),
      stop({ id: "s2", stop_order: 2, city: "Hull" }),
    ];
    expect(routeEndpoints(stops)).toEqual({ origin: "Leeds", destination: "Hull" });
  });

  it("falls back on both ends when neither stop type is present", () => {
    // The rail cell and the header subtitle both need something readable here,
    // which is the whole reason this lives in one place.
    expect(routeEndpoints([stop({ type: null })])).toEqual({ origin: "—", destination: "—" });
  });
});

describe("buildRail", () => {
  it("drops jobs that are not on the road", () => {
    const rows = buildRail([job(), job({ id: "j2", status: "completed" })], NOW);
    expect(rows.map((r) => r.jobId)).toEqual(["j1"]);
  });

  it("puts late jobs first, then oldest scheduled date, then reference", () => {
    const rows = buildRail(
      [
        job({ id: "a", reference: "J-300", scheduled_date: TODAY }),
        job({ id: "b", reference: "J-100", scheduled_date: YESTERDAY }),
        job({ id: "c", reference: "J-200", scheduled_date: "2026-08-12" }),
        job({ id: "d", reference: "J-050", scheduled_date: TODAY }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.jobId)).toEqual(["c", "b", "d", "a"]);
  });

  it("carries the route towns", () => {
    const [row] = buildRail([job()], NOW);
    expect(row.originCity).toBe("Leeds");
    expect(row.destinationCity).toBe("Hull");
  });

  it("falls back rather than rendering blanks or the word null", () => {
    // A delivery-only job with no city still belongs in the rail. Every cell
    // must render something a dispatcher can read.
    const [row] = buildRail(
      [job({ reference: null, vehicle_registration: null, driver_name: null, stops: [stop({ city: null })] })],
      NOW,
    );
    expect(row.reference).toBe("—");
    expect(row.registration).toBe("—");
    expect(row.originCity).toBe("—");
    expect(row.destinationCity).toBe("—");
    expect(row.driverName).toBeNull(); // the component supplies "No driver assigned"
  });

  it("uses the LAST delivery stop as the destination on a multi-drop job", () => {
    const j = job({
      stops: [
        stop({ id: "s0", stop_order: 0, type: "collection", city: "Leeds" }),
        stop({ id: "s1", stop_order: 1, city: "York" }),
        stop({ id: "s2", stop_order: 2, city: "Hull" }),
      ],
    });
    expect(buildRail([j], NOW)[0].destinationCity).toBe("Hull");
  });
});
