import { describe, it, expect } from "vitest";
import { buildActivity } from "./activity";
import type { TrackingJob, TrackingStop } from "./types";

function stop(over: Partial<TrackingStop> = {}): TrackingStop {
  return {
    id: "s1", stop_order: 1, type: "delivery", address_line: "1 Dock Rd",
    city: "Hull", postcode: "HU3 4AB", planned_at: "2026-08-14T08:00:00Z",
    delivered_at: null, pod_status: "pending", recipient_name: null,
    pod_updated_at: null, pod_photo_url: null, pod_document_url: null,
    /* Required on TrackingStop, not optional: these come from a Supabase
       select, where a selected nullable column is always present and may be
       null. The fixture has to say so. */
    lat: null, lng: null,
    ...over,
  };
}

function job(over: Partial<TrackingJob> = {}): TrackingJob {
  return {
    id: "j1", reference: "J-100", status: "planned", scheduled_date: "2026-08-14",
    created_at: "2026-08-14T06:00:00Z", customer_name: "Acme", vehicle_id: "v1",
    vehicle_registration: "YT19 KHR", driver_name: "A. Marsh",
    driver_phone: "07700900000", subcontractor_id: null, stops: [stop()],
    ...over,
  };
}

describe("buildActivity", () => {
  it("always includes the job creation event", () => {
    const events = buildActivity(job());
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe("Job J-100 created");
  });

  it("returns an empty list rather than a bogus event when created_at is null", () => {
    expect(buildActivity(job({ created_at: null }))).toEqual([]);
  });

  it("reports a delivered delivery stop with its recipient", () => {
    const events = buildActivity(job({
      stops: [stop({ pod_status: "delivered", delivered_at: "2026-08-14T11:00:00Z", recipient_name: "R. Bell" })],
    }));
    expect(events[0].text).toBe("Delivered to Hull, signed by R. Bell");
  });

  it("reports a delivered stop without a recipient, rather than saying signed by null", () => {
    const events = buildActivity(job({
      stops: [stop({ pod_status: "delivered", delivered_at: "2026-08-14T11:00:00Z" })],
    }));
    expect(events[0].text).toBe("Delivered to Hull");
  });

  it("words a collection differently from a delivery", () => {
    const events = buildActivity(job({
      stops: [stop({ type: "collection", city: "Leeds", pod_status: "delivered", delivered_at: "2026-08-14T09:12:00Z" })],
    }));
    expect(events[0].text).toBe("Collected at Leeds");
  });

  it("reports POD evidence attached, using pod_updated_at", () => {
    const events = buildActivity(job({
      stops: [stop({ pod_updated_at: "2026-08-14T11:05:00Z", pod_photo_url: "https://x/y.jpg" })],
    }));
    expect(events[0].text).toBe("POD evidence attached at Hull");
  });

  it("does not report evidence when pod_updated_at exists but no file is attached", () => {
    const events = buildActivity(job({ stops: [stop({ pod_updated_at: "2026-08-14T11:05:00Z" })] }));
    expect(events.map((e) => e.text)).toEqual(["Job J-100 created"]);
  });

  it("falls back to delivered_at for the evidence stamp when pod_updated_at is null, since /jobs never writes it", () => {
    const events = buildActivity(job({
      stops: [stop({ delivered_at: "2026-08-14T11:00:00Z", pod_photo_url: "https://x/y.jpg" })],
    }));
    expect(events.map((e) => e.text)).toEqual([
      "POD evidence attached at Hull",
      "Job J-100 created",
    ]);
  });

  it("ranks delivered above evidence when both stamps tie exactly, rather than relying on id spelling", () => {
    const events = buildActivity(job({
      stops: [stop({
        pod_status: "delivered",
        delivered_at: "2026-08-14T11:00:00Z",
        pod_updated_at: "2026-08-14T11:00:00Z",
        pod_photo_url: "https://x/y.jpg",
      })],
    }));
    expect(events.map((e) => e.text)).toEqual([
      "Delivered to Hull",
      "POD evidence attached at Hull",
      "Job J-100 created",
    ]);
  });

  it("sorts newest first", () => {
    const events = buildActivity(job({
      stops: [
        stop({ id: "a", stop_order: 0, type: "collection", city: "Leeds", pod_status: "delivered", delivered_at: "2026-08-14T09:12:00Z" }),
        stop({ id: "b", stop_order: 1, pod_status: "delivered", delivered_at: "2026-08-14T11:00:00Z" }),
      ],
    }));
    expect(events.map((e) => e.text)).toEqual([
      "Delivered to Hull",
      "Collected at Leeds",
      "Job J-100 created",
    ]);
  });

  it("gives every event a stable unique id, so React keys do not collide", () => {
    const events = buildActivity(job({
      stops: [stop({ pod_status: "delivered", delivered_at: "2026-08-14T11:00:00Z", pod_updated_at: "2026-08-14T11:05:00Z", pod_photo_url: "https://x/y.jpg" })],
    }));
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it("names an unreferenced job without printing null", () => {
    expect(buildActivity(job({ reference: null }))[0].text).toBe("Job created");
  });
});
