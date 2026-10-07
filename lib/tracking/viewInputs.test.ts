import { describe, expect, it } from "vitest";
import { latenessMs, stopsBefore, trackingState, type EtaContext } from "./eta";
import { buildBaselines, buildItinerary, isStopCompleted, readTrackingPosition, resolveItinerary, toLatLng, usableCachedEta } from "./viewInputs";

describe("isStopCompleted", () => {
  it("is true for a completed status, a delivered or collected POD, or a recorded delivery time", () => {
    expect(isStopCompleted({ status: "completed" })).toBe(true);
    expect(isStopCompleted({ pod_status: "delivered" })).toBe(true);
    expect(isStopCompleted({ pod_status: "collected" })).toBe(true);
    expect(isStopCompleted({ delivered_at: "2026-10-07T10:00:00Z" })).toBe(true);
  });

  it("is false for an open stop", () => {
    expect(isStopCompleted({ status: "planned", pod_status: "pending", delivered_at: null })).toBe(false);
    expect(isStopCompleted({})).toBe(false);
  });
});

describe("buildItinerary", () => {
  const stops = [
    { id: "s1", type: "delivery", status: "completed", pod_status: "delivered", delivered_at: "2026-10-07T10:00:00Z" },
    { id: "s2", type: "collection", status: "planned", pod_status: "pending", delivered_at: null },
    { id: "s3", type: "delivery", status: "planned", pod_status: "pending", delivered_at: null },
  ];

  it("is null when there are no visits", () => {
    expect(buildItinerary([], stops)).toBeNull();
  });

  it("orders by service sequence number and maps each stop", () => {
    const visits = [
      { stop_id: "s3", job_id: "j3", service_sequence_number: 3 },
      { stop_id: "s1", job_id: "j1", service_sequence_number: 1 },
      { stop_id: "s2", job_id: "j2", service_sequence_number: 2 },
    ];
    expect(buildItinerary(visits, stops)).toEqual([
      { stopId: "s1", jobId: "j1", type: "delivery", completed: true, deliveredAt: "2026-10-07T10:00:00Z" },
      { stopId: "s2", jobId: "j2", type: "collection", completed: false, deliveredAt: null },
      { stopId: "s3", jobId: "j3", type: "delivery", completed: false, deliveredAt: null },
    ]);
  });

  /* A visit whose stop row did not load must still block "next" for the
     stops after it: dropping it would reveal the van's position early. */
  it("keeps a visit whose stop row is missing as an incomplete placeholder", () => {
    const visits = [
      { stop_id: "gone", job_id: "j0", service_sequence_number: 1 },
      { stop_id: "s3", job_id: "j3", service_sequence_number: 2 },
    ];
    expect(buildItinerary(visits, stops)).toEqual([
      { stopId: "gone", jobId: "j0", type: "unknown", completed: false, deliveredAt: null },
      { stopId: "s3", jobId: "j3", type: "delivery", completed: false, deliveredAt: null },
    ]);
  });
});

describe("buildBaselines", () => {
  it("gives delivery_eta only to jobs with exactly one delivery stop", () => {
    const jobs = [
      { id: "j1", delivery_eta: "2026-10-07T10:00:00Z" },
      { id: "j2", delivery_eta: "2026-10-07T12:00:00Z" },
      { id: "j3", delivery_eta: null },
      { id: "j4", delivery_eta: "2026-10-07T14:00:00Z" },
    ];
    const deliveryStops = [{ job_id: "j1" }, { job_id: "j2" }, { job_id: "j2" }, { job_id: "j3" }];
    expect(buildBaselines(jobs, deliveryStops)).toEqual({
      j1: "2026-10-07T10:00:00Z",
      j2: null,
      j3: null,
      j4: null,
    });
  });
});

describe("toLatLng", () => {
  it("accepts numbers and numeric strings in range", () => {
    expect(toLatLng(51.5, "-0.12")).toEqual({ lat: 51.5, lng: -0.12 });
  });

  it("refuses missing, non-numeric and out-of-range values", () => {
    expect(toLatLng(null, 1)).toBeNull();
    expect(toLatLng("", 1)).toBeNull();
    expect(toLatLng("abc", 1)).toBeNull();
    expect(toLatLng(91, 0)).toBeNull();
    expect(toLatLng(0, 181)).toBeNull();
  });
});

describe("readTrackingPosition", () => {
  const now = new Date("2026-10-07T11:00:00.000Z");

  it("treats a naive recorded_at as UTC and returns an ISO time with an offset", () => {
    expect(readTrackingPosition({ latitude: 51.5, longitude: -0.1, recorded_at: "2026-10-07T10:55:00" }, now)).toEqual({
      lat: 51.5,
      lng: -0.1,
      at: "2026-10-07T10:55:00.000Z",
    });
  });

  it("keeps an offset that is already present", () => {
    expect(readTrackingPosition({ latitude: 51.5, longitude: -0.1, recorded_at: "2026-10-07T11:55:00+01:00" }, now)?.at).toBe(
      "2026-10-07T10:55:00.000Z",
    );
  });

  it("allows small clock drift into the future but refuses a broken device clock", () => {
    expect(readTrackingPosition({ latitude: 51.5, longitude: -0.1, recorded_at: "2026-10-07T11:01:00Z" }, now)).not.toBeNull();
    expect(readTrackingPosition({ latitude: 51.5, longitude: -0.1, recorded_at: "2026-10-07T11:10:00Z" }, now)).toBeNull();
  });

  it("refuses a row without a usable time or coordinates", () => {
    expect(readTrackingPosition(null, now)).toBeNull();
    expect(readTrackingPosition({ latitude: 51.5, longitude: -0.1, recorded_at: null }, now)).toBeNull();
    expect(readTrackingPosition({ latitude: 51.5, longitude: -0.1, recorded_at: "not a time" }, now)).toBeNull();
    expect(readTrackingPosition({ latitude: null, longitude: -0.1, recorded_at: "2026-10-07T10:55:00Z" }, now)).toBeNull();
  });
});

describe("buildItinerary numeric ordering", () => {
  it("sorts numeric-string sequence numbers numerically", () => {
    const visits = [
      { stop_id: "a", job_id: "j", service_sequence_number: "10" },
      { stop_id: "b", job_id: "j", service_sequence_number: "9" },
    ];
    expect(buildItinerary(visits, [])?.map((s) => s.stopId)).toEqual(["b", "a"]);
  });
});

describe("resolveItinerary", () => {
  const stops = [{ id: "s1", type: "delivery", status: "planned", pod_status: "pending", delivered_at: null }];
  const visits = [{ stop_id: "s1", job_id: "j1", service_sequence_number: 1 }];

  /* An unknown plan must never let a stop read as "next": [] means "the van
     has a plan this stop is not in", which trackingState never turns into next. */
  it("is an empty itinerary when any lookup failed", () => {
    expect(resolveItinerary({ failed: true, visits, stopRows: stops })).toEqual([]);
    expect(resolveItinerary({ failed: true, visits: null, stopRows: [] })).toEqual([]);
  });

  it("is null only when the lookups succeeded and there is no plan", () => {
    expect(resolveItinerary({ failed: false, visits: null, stopRows: [] })).toBeNull();
    expect(resolveItinerary({ failed: false, visits: [], stopRows: [] })).toBeNull();
  });

  it("builds the list when there are visits", () => {
    expect(resolveItinerary({ failed: false, visits, stopRows: stops })).toEqual([
      { stopId: "s1", jobId: "j1", type: "delivery", completed: false, deliveredAt: null },
    ]);
  });

  it("an empty itinerary never yields next, stops before or lateness", () => {
    const ctx: EtaContext = {
      now: new Date("2026-10-07T11:00:00.000Z"),
      stop: { id: "s1", jobId: "j1", completed: false, deliveredAt: null, plannedDate: "2026-10-07" },
      job: { vehicleId: "v1", deliveryEta: "2026-10-07T13:00:00.000Z", deliveryStopCount: 1, incompleteStopIds: ["s1"] },
      itinerary: [],
      baselines: {},
    };
    expect(trackingState(ctx)).toBe("en_route_earlier");
    expect(stopsBefore(ctx)).toBeNull();
    expect(latenessMs(ctx)).toBe(0);
  });
});

describe("usableCachedEta", () => {
  const now = new Date("2026-10-07T11:00:00.000Z");

  it("returns the rounded ETA when computed within 10 minutes and still ahead", () => {
    expect(usableCachedEta({ eta: "2026-10-07T11:31:00Z", computedAt: "2026-10-07T10:55:00Z" }, now)).toBe("2026-10-07T11:30:00.000Z");
  });

  it("refuses a cache computed more than 10 minutes ago", () => {
    expect(usableCachedEta({ eta: "2026-10-07T11:31:00Z", computedAt: "2026-10-07T10:49:00Z" }, now)).toBeNull();
  });

  it("refuses an ETA already in the past", () => {
    expect(usableCachedEta({ eta: "2026-10-07T10:59:00Z", computedAt: "2026-10-07T10:58:00Z" }, now)).toBeNull();
  });

  it("refuses a missing cache or unparseable times", () => {
    expect(usableCachedEta(null, now)).toBeNull();
    expect(usableCachedEta({ eta: "nope", computedAt: "2026-10-07T10:58:00Z" }, now)).toBeNull();
    expect(usableCachedEta({ eta: "2026-10-07T11:31:00Z", computedAt: "nope" }, now)).toBeNull();
  });
});
