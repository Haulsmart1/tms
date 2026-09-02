import { describe, it, expect } from "vitest";
import { buildJourney, routeGlyph, arrowStateFor, type JourneyNode } from "./journey";
import type { PositionReading } from "./position";
import type { TrackingStop } from "./types";

const NOW = new Date("2026-08-14T12:00:00Z");

function stop(over: Partial<TrackingStop> = {}): TrackingStop {
  return {
    id: "s1", stop_order: 1, type: "delivery", address_line: "1 Dock Rd",
    city: "Hull", postcode: "HU3 4AB", lat: null, lng: null, planned_at: "2026-08-14T08:00:00Z",
    delivered_at: null, pod_status: "pending", recipient_name: null,
    pod_updated_at: null, pod_photo_url: null, pod_document_url: null,
    /* Required on TrackingStop, not optional: these come from a Supabase
       select, where a selected nullable column is always present and may be
       null. The fixture has to say so. */
    lat: null, lng: null,
    ...over,
  };
}

const pair = () => [
  stop({ id: "s0", stop_order: 0, type: "collection", city: "Leeds", postcode: "LS10 1AA" }),
  stop(),
];

function stops(nodes: JourneyNode[]) {
  return nodes.filter((n) => n.kind === "stop");
}

describe("buildJourney", () => {
  it("marks delivered stops done and the first undelivered one current", () => {
    const s = pair();
    s[0] = { ...s[0], pod_status: "delivered" };
    const n = stops(buildJourney(s, null, NOW));
    expect(n.map((x) => x.state)).toEqual(["done", "current"]);
  });

  it("marks later stops upcoming, not current", () => {
    const n = stops(buildJourney(
      [stop({ id: "a", stop_order: 0 }), stop({ id: "b", stop_order: 1 }), stop({ id: "c", stop_order: 2 })],
      null, NOW,
    ));
    expect(n.map((x) => x.state)).toEqual(["current", "upcoming", "upcoming"]);
  });

  it("orders by stop_order regardless of array order", () => {
    const n = stops(buildJourney([stop({ id: "b", stop_order: 2 }), stop({ id: "a", stop_order: 1 })], null, NOW));
    expect(n.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("has no current node when every stop is done", () => {
    const s = pair().map((x) => ({ ...x, pod_status: "delivered" }));
    const n = stops(buildJourney(s, null, NOW));
    expect(n.every((x) => x.state === "done")).toBe(true);
  });

  it("handles a single-stop job", () => {
    const n = stops(buildJourney([stop()], null, NOW));
    expect(n).toHaveLength(1);
    expect(n[0].isLast).toBe(true);
    expect(n[0].caption).toBe("Destination");
  });

  it("captions a done collection and a done delivery differently", () => {
    const s = pair().map((x) => ({ ...x, pod_status: "delivered", delivered_at: "2026-08-14T09:12:00Z" }));
    const n = stops(buildJourney(s, null, NOW));
    expect(n[0].caption).toBe("Collected");
    expect(n[1].caption).toBe("Delivered");
  });

  it("captions an intermediate undelivered stop as a waypoint", () => {
    const n = stops(buildJourney(
      [stop({ id: "a", stop_order: 0 }), stop({ id: "b", stop_order: 1 }), stop({ id: "c", stop_order: 2 })],
      null, NOW,
    ));
    expect(n.map((x) => x.caption)).toEqual(["Next stop", "Waypoint", "Destination"]);
  });

  it("shows delivered_at as a date and time", () => {
    const n = stops(buildJourney([stop({ delivered_at: "2026-08-12T14:32:00Z" })], null, NOW));
    expect(n[0].when).toBe("12 Aug 15:32"); // Europe/London, BST in August
  });

  it("shows planned_at as a DATE ONLY, because the 08:00 stamp is derived", () => {
    // app/jobs/page.tsx writes planned_at as `${scheduled_date}T08:00:00`.
    // Rendering a time from it would present a fabricated 8am as a real slot.
    const n = stops(buildJourney([stop({ planned_at: "2026-08-16T08:00:00Z" })], null, NOW));
    expect(n[0].when).toBe("16 Aug");
  });

  it("falls back rather than rendering a blank when both stamps are null", () => {
    const n = stops(buildJourney([stop({ planned_at: null })], null, NOW));
    expect(n[0].when).toBe("—");
  });

  it("labels a stop by city and postcode, falling back when both are null", () => {
    expect(stops(buildJourney([stop()], null, NOW))[0].label).toBe("Hull HU3 4AB");
    expect(stops(buildJourney([stop({ city: null, postcode: null })], null, NOW))[0].label)
      .toBe("Unnamed stop");
  });

  it("inserts no live node when there is no reading", () => {
    expect(buildJourney(pair(), null, NOW).some((n) => n.kind === "live")).toBe(false);
  });

  it("inserts no live node for a stale reading, because an old fix is not a position", () => {
    const stale: PositionReading = {
      vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph: 80,
      headingDeg: null, recordedAt: "2026-08-14T09:00:00Z",
    };
    expect(buildJourney(pair(), stale, NOW).some((n) => n.kind === "live")).toBe(false);
  });

  it("inserts a live node immediately before the current stop when the fix is live", () => {
    const live: PositionReading = {
      vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph: 81,
      headingDeg: null, recordedAt: "2026-08-14T11:58:00Z",
    };
    const s = pair();
    s[0] = { ...s[0], pod_status: "delivered" };
    const n = buildJourney(s, live, NOW);
    expect(n.map((x) => x.kind)).toEqual(["stop", "live", "stop"]);
    const liveNode = n[1] as Extract<JourneyNode, { kind: "live" }>;
    expect(liveNode.speedLabel).toBe("81 km/h");
    expect(liveNode.pingLabel).toBe("updated 2 min ago");
  });

  it("says Stationary rather than 0 km/h for a live fix that is not moving", () => {
    const live: PositionReading = {
      vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph: 0,
      headingDeg: null, recordedAt: "2026-08-14T11:58:00Z",
    };
    const n = buildJourney([stop()], live, NOW);
    expect((n[0] as Extract<JourneyNode, { kind: "live" }>).speedLabel).toBe("Stationary");
  });

  it("says Speed unknown rather than Stationary when the speed is not a number", () => {
    // NaN > 0 is false, so the old expression labelled this "Stationary",
    // which reads as a confident assertion about a truck that may be moving.
    const live: PositionReading = {
      vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph: Number.NaN,
      headingDeg: null, recordedAt: "2026-08-14T11:58:00Z",
    };
    const n = buildJourney([stop()], live, NOW);
    expect((n[0] as Extract<JourneyNode, { kind: "live" }>).speedLabel).toBe("Speed unknown");
  });
});

describe("arrowStateFor", () => {
  it("is delivered when every stop is done", () => {
    const n = buildJourney(pair().map((x) => ({ ...x, pod_status: "delivered" })), null, NOW);
    expect(arrowStateFor(n, false)).toBe("delivered");
  });

  it("is overdue for a late job with work outstanding", () => {
    expect(arrowStateFor(buildJourney(pair(), null, NOW), true)).toBe("overdue");
  });

  it("is pending otherwise", () => {
    expect(arrowStateFor(buildJourney(pair(), null, NOW), false)).toBe("pending");
  });

  it("is not delivered for an empty journey, which has nothing to have delivered", () => {
    expect(arrowStateFor([], false)).toBe("pending");
  });
});

describe("routeGlyph", () => {
  it("drops the live node, since RouteProgress renders stops only", () => {
    const live: PositionReading = {
      vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph: 81,
      headingDeg: null, recordedAt: "2026-08-14T11:58:00Z",
    };
    const { nodes } = routeGlyph(buildJourney(pair(), live, NOW), "pending");
    expect(nodes.map((n) => n.id)).toEqual(["s0", "s1"]);
  });
});
