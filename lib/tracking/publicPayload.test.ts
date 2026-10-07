import { describe, expect, it } from "vitest";
import { POSITION_FRESH_MS, buildTrackingPayload, isTrackingEnded, type TrackingPayloadInput } from "./publicPayload";

const now = new Date("2026-10-07T11:00:00.000Z");
const ALLOWED_KEYS = ["operator", "state", "etaWindow", "etaLive", "stopsBefore", "position", "destination", "deliveredAt"].sort();

function input(over: Partial<TrackingPayloadInput> = {}): TrackingPayloadInput {
  return {
    now,
    operatorName: "Acme Haulage",
    state: "next",
    etaWindow: { from: "2026-10-07T12:45:00.000Z", to: "2026-10-07T14:00:00.000Z" },
    etaLive: "2026-10-07T11:25:00.000Z",
    stopsBefore: 0,
    position: { lat: 52.1, lng: -1.2, at: "2026-10-07T10:58:00.000Z" },
    destination: { lat: 52.3, lng: -1.4 },
    deliveredAt: null,
    ...over,
  };
}

describe("buildTrackingPayload", () => {
  it("never carries anything outside the allowed keys, whatever it is given", () => {
    const smuggled = { ...input(), driverName: "Sam", registration: "AB12 CDE", vehicleId: "v1", reference: "J-1", recipientName: "Pat" };
    for (const state of ["scheduled", "en_route_earlier", "next", "delivered"] as const) {
      const payload = buildTrackingPayload({ ...smuggled, state } as TrackingPayloadInput);
      expect(Object.keys(payload).sort()).toEqual(ALLOWED_KEYS);
      expect(Object.keys(payload.operator)).toEqual(["name"]);
      const text = JSON.stringify(payload);
      for (const secret of ["Sam", "AB12 CDE", "J-1", "Pat", "v1"]) expect(text).not.toContain(secret);
    }
  });

  it("shows position, destination and live ETA only when next", () => {
    const next = buildTrackingPayload(input());
    expect(next.position).toEqual({ lat: 52.1, lng: -1.2, at: "2026-10-07T10:58:00.000Z" });
    expect(next.destination).toEqual({ lat: 52.3, lng: -1.4 });
    expect(next.etaLive).toBe("2026-10-07T11:25:00.000Z");

    for (const state of ["scheduled", "en_route_earlier", "delivered"] as const) {
      const other = buildTrackingPayload(input({ state }));
      expect(other.position).toBeNull();
      expect(other.destination).toBeNull();
      expect(other.etaLive).toBeNull();
    }
  });

  it("hides a stale position but keeps the destination", () => {
    const stale = new Date(now.getTime() - POSITION_FRESH_MS - 1).toISOString();
    const payload = buildTrackingPayload(input({ position: { lat: 1, lng: 2, at: stale } }));
    expect(payload.etaLive).toBeNull();
    expect(payload.position).toBeNull();
    expect(payload.destination).toEqual({ lat: 52.3, lng: -1.4 });
  });

  it("shows the delivered time only when delivered, and no window then", () => {
    const delivered = buildTrackingPayload(input({ state: "delivered", deliveredAt: "2026-10-07T10:32:00.000Z" }));
    expect(delivered.deliveredAt).toBe("2026-10-07T10:32:00.000Z");
    expect(delivered.etaWindow).toBeNull();
    expect(buildTrackingPayload(input({ deliveredAt: "2026-10-07T10:32:00.000Z" })).deliveredAt).toBeNull();
  });
});

describe("isTrackingEnded", () => {
  it("ends 24 hours after delivery or when the job is cancelled", () => {
    expect(isTrackingEnded({ jobStatus: "cancelled", deliveredAt: null, now })).toBe(true);
    expect(isTrackingEnded({ jobStatus: "in_progress", deliveredAt: "2026-10-06T10:59:59.000Z", now })).toBe(true);
    expect(isTrackingEnded({ jobStatus: "completed", deliveredAt: "2026-10-06T11:00:01.000Z", now })).toBe(false);
    expect(isTrackingEnded({ jobStatus: "accepted", deliveredAt: null, now })).toBe(false);
    expect(isTrackingEnded({ jobStatus: "completed", deliveredAt: "garbage", now })).toBe(false);
  });
});
