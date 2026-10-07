/*
  Turns the rows lib/tracking/trackingServer.ts loads into the inputs
  lib/tracking/eta.ts and publicPayload.ts expect. Pure, so the shaping that
  decides "next" (and therefore whether the driver's position is shown) is
  tested rather than buried in a Supabase loader.
*/

import { roundToFiveMinutes, type ItineraryStop } from "./eta";
import { FUTURE_TOLERANCE_MINUTES, normaliseTimestamp } from "./position";
import { POSITION_FRESH_MS } from "./publicPayload";

type StopRow = { status?: unknown; pod_status?: unknown; delivered_at?: unknown };

export function isStopCompleted(row: StopRow): boolean {
  return (
    row.status === "completed" ||
    row.pod_status === "delivered" ||
    row.pod_status === "collected" ||
    (typeof row.delivered_at === "string" && row.delivered_at.length > 0)
  );
}

type VisitRow = { stop_id: unknown; job_id: unknown; service_sequence_number: unknown };
type ItineraryStopRow = StopRow & { id: unknown; type?: unknown };

/*
  Today's planned order for one vehicle. A visit whose stop row did not load
  stays in as an incomplete placeholder: dropping it would move the stops
  after it closer to "next" and reveal the van's position early.
*/
export function buildItinerary(visits: readonly VisitRow[], stopRows: readonly ItineraryStopRow[]): ItineraryStop[] | null {
  if (visits.length === 0) return null;
  const byId = new Map(stopRows.map((s) => [String(s.id), s]));
  return [...visits]
    .sort((a, b) => Number(a.service_sequence_number) - Number(b.service_sequence_number))
    .map((v) => {
      const stopId = String(v.stop_id);
      const s = byId.get(stopId);
      if (!s) return { stopId, jobId: String(v.job_id), type: "unknown", completed: false, deliveredAt: null };
      return {
        stopId,
        jobId: String(v.job_id),
        type: String(s.type ?? ""),
        completed: isStopCompleted(s),
        deliveredAt: typeof s.delivered_at === "string" ? s.delivered_at : null,
      };
    });
}

/*
  The itinerary as the ETA rules should see it, from the three lookups.
  A failed lookup is an empty, non-null itinerary: trackingState reads that as
  "the van has a plan this stop is not in" and never returns "next", so an
  unknown plan can never reveal the driver's position. Null (no plan, use the
  looser single-job rule) only when every lookup succeeded and found nothing.
*/
export function resolveItinerary(input: {
  failed: boolean;
  visits: readonly VisitRow[] | null;
  stopRows: readonly ItineraryStopRow[];
}): ItineraryStop[] | null {
  if (input.failed) return [];
  if (!input.visits || input.visits.length === 0) return null;
  return buildItinerary(input.visits, input.stopRows);
}

/*
  A cached live ETA, rounded, when it may still be shown: computed within the
  same 10 minutes a position stays fresh, and not already in the past.
  Otherwise null, and the page falls back to the window.
*/
export function usableCachedEta(cache: { eta: string; computedAt: string } | null, now: Date): string | null {
  if (!cache) return null;
  const computed = Date.parse(cache.computedAt);
  const eta = Date.parse(cache.eta);
  if (Number.isNaN(computed) || Number.isNaN(eta)) return null;
  if (now.getTime() - computed > POSITION_FRESH_MS) return null;
  if (eta < now.getTime()) return null;
  return roundToFiveMinutes(cache.eta);
}

/** delivery_eta for each job with exactly one delivery stop; null for every other job. */
export function buildBaselines(
  jobs: readonly { id: unknown; delivery_eta?: unknown }[],
  deliveryStops: readonly { job_id: unknown }[],
): Record<string, string | null> {
  const counts = new Map<string, number>();
  for (const s of deliveryStops) counts.set(String(s.job_id), (counts.get(String(s.job_id)) ?? 0) + 1);
  const out: Record<string, string | null> = {};
  for (const j of jobs) {
    const id = String(j.id);
    out[id] = counts.get(id) === 1 && typeof j.delivery_eta === "string" ? j.delivery_eta : null;
  }
  return out;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = num(lat);
  const ln = num(lng);
  if (la === null || ln === null || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

type PositionRow = { latitude?: unknown; longitude?: unknown; recorded_at?: unknown };

/*
  A telematics_positions row as a public-safe fix. recorded_at is
  `timestamp without time zone` and assumed UTC (see lib/tracking/position.ts),
  so it is normalised before parsing; the returned `at` always carries Z. A fix
  further in the future than clock drift allows is a broken device clock and
  is refused, since it would otherwise read as fresh forever.
*/
export function readTrackingPosition(row: PositionRow | null, now: Date): { lat: number; lng: number; at: string } | null {
  if (!row || typeof row.recorded_at !== "string" || !row.recorded_at) return null;
  const point = toLatLng(row.latitude, row.longitude);
  if (!point) return null;
  const ms = Date.parse(normaliseTimestamp(row.recorded_at));
  if (Number.isNaN(ms)) return null;
  if (ms - now.getTime() > FUTURE_TOLERANCE_MINUTES * 60 * 1000) return null;
  return { ...point, at: new Date(ms).toISOString() };
}
