import { describe, expect, it } from "vitest";
import { buildBaselines, buildItinerary, isStopCompleted, readTrackingPosition, toLatLng } from "./viewInputs";

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
