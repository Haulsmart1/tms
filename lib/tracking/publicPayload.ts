/*
  The ONLY place that decides what the public tracking route returns. Built
  field by field from explicit inputs (never by spreading a row), so a column
  added to a query can never leak to an anonymous viewer.

  Never included: the driver's name or id, the vehicle's registration or id,
  other stops' addresses or positions, the recipient, the job reference or the
  customer. The vehicle position is shown only while this stop is next and the
  fix is fresher than 10 minutes: it is the driver's location (personal data)
  and, earlier in the day, it would reveal other customers' drops.
*/

import type { TrackingState } from "./eta";

export const POSITION_FRESH_MS = 10 * 60 * 1000;
export const TRACKING_ENDS_AFTER_DELIVERY_MS = 24 * 60 * 60 * 1000;

type LatLng = { lat: number; lng: number };

export type TrackingPayloadInput = {
  now: Date;
  operatorName: string;
  state: TrackingState;
  etaWindow: { from: string; to: string } | null;
  etaLive: string | null;
  stopsBefore: number | null;
  position: (LatLng & { at: string }) | null;
  destination: LatLng | null;
  deliveredAt: string | null;
};

export type TrackingPayload = {
  operator: { name: string };
  state: TrackingState;
  etaWindow: { from: string; to: string } | null;
  etaLive: string | null;
  stopsBefore: number | null;
  position: (LatLng & { at: string }) | null;
  destination: LatLng | null;
  deliveredAt: string | null;
};

function latLng(value: LatLng | null): LatLng | null {
  if (!value || !Number.isFinite(value.lat) || !Number.isFinite(value.lng)) return null;
  return { lat: value.lat, lng: value.lng };
}

export function buildTrackingPayload(input: TrackingPayloadInput): TrackingPayload {
  const next = input.state === "next";
  const delivered = input.state === "delivered";

  let position: TrackingPayload["position"] = null;
  if (next && input.position) {
    const fresh = input.now.getTime() - Date.parse(input.position.at) <= POSITION_FRESH_MS;
    const point = latLng(input.position);
    if (fresh && point) position = { ...point, at: input.position.at };
  }

  return {
    operator: { name: input.operatorName },
    state: input.state,
    etaWindow: delivered || !input.etaWindow ? null : { from: input.etaWindow.from, to: input.etaWindow.to },
    etaLive: next ? input.etaLive : null,
    stopsBefore: delivered ? null : input.stopsBefore,
    position,
    destination: next ? latLng(input.destination) : null,
    deliveredAt: delivered ? input.deliveredAt : null,
  };
}

export function isTrackingEnded(input: { jobStatus: string | null; deliveredAt: string | null; now: Date }): boolean {
  if (input.jobStatus === "cancelled") return true;
  if (!input.deliveredAt) return false;
  const at = Date.parse(input.deliveredAt);
  return !Number.isNaN(at) && input.now.getTime() - at > TRACKING_ENDS_AFTER_DELIVERY_MS;
}
