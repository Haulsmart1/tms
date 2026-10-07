/*
  ETA rules for the public tracking page. Pure; lib/tracking/trackingServer.ts
  loads the inputs and does the TomTom call.

  Before the van is heading to this stop the page shows a window: the
  planner's ETA for the job (jobs.delivery_eta, only meaningful when the job
  has a single delivery stop) shifted by how late or early the driver ran on
  the last completed stop earlier in the day. Once this stop is next, the live
  ETA from TomTom replaces it (shouldRefreshEta decides when to ask again).
*/

import { operatorDay } from "../time";

export type ItineraryStop = { stopId: string; jobId: string; type: string; completed: boolean; deliveredAt: string | null };

export type EtaContext = {
  now: Date;
  stop: { id: string; jobId: string; completed: boolean; deliveredAt: string | null; plannedDate: string | null };
  job: { vehicleId: string | null; deliveryEta: string | null; deliveryStopCount: number; incompleteStopIds: string[] };
  /** Today's planned order for the job's vehicle, or null when the day was not planned. */
  itinerary: ItineraryStop[] | null;
  /** delivery_eta per job id, for single-delivery-stop jobs only (null otherwise). */
  baselines: Record<string, string | null>;
};

export type TrackingState = "scheduled" | "en_route_earlier" | "next" | "delivered";

const MINUTE = 60 * 1000;
export const LATENESS_MIN_MS = -2 * 60 * MINUTE;
export const LATENESS_MAX_MS = 6 * 60 * MINUTE;
export const ETA_CACHE_MS = 2 * MINUTE;

function indexInItinerary(ctx: EtaContext): number {
  return ctx.itinerary ? ctx.itinerary.findIndex((s) => s.stopId === ctx.stop.id) : -1;
}

export function trackingState(ctx: EtaContext): TrackingState {
  if (ctx.stop.completed) return "delivered";
  if (ctx.stop.plannedDate && ctx.stop.plannedDate > operatorDay(ctx.now)) return "scheduled";

  const index = indexInItinerary(ctx);
  if (ctx.itinerary && index >= 0) {
    const firstIncomplete = ctx.itinerary.findIndex((s) => !s.completed);
    return firstIncomplete === index ? "next" : "en_route_earlier";
  }

  const onlyRemaining = ctx.job.incompleteStopIds.length === 1 && ctx.job.incompleteStopIds[0] === ctx.stop.id;
  return onlyRemaining && ctx.job.vehicleId ? "next" : "en_route_earlier";
}

export function stopsBefore(ctx: EtaContext): number | null {
  const index = indexInItinerary(ctx);
  if (!ctx.itinerary || index < 0) return null;
  return ctx.itinerary.slice(0, index).filter((s) => s.type === "delivery" && !s.completed).length;
}

export function latenessMs(ctx: EtaContext): number {
  const index = indexInItinerary(ctx);
  if (!ctx.itinerary || index < 0) return 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const s = ctx.itinerary[i];
    const baseline = ctx.baselines[s.jobId];
    if (!s.completed || !s.deliveredAt || !baseline) continue;
    const diff = Date.parse(s.deliveredAt) - Date.parse(baseline);
    if (Number.isNaN(diff)) continue;
    return Math.min(LATENESS_MAX_MS, Math.max(LATENESS_MIN_MS, diff));
  }
  return 0;
}

const QUARTER = 15 * MINUTE;

export function etaWindow(ctx: EtaContext): { from: string; to: string } | null {
  if (ctx.job.deliveryStopCount !== 1 || !ctx.job.deliveryEta) return null;
  const baseline = Date.parse(ctx.job.deliveryEta);
  if (Number.isNaN(baseline)) return null;
  const centre = baseline + latenessMs(ctx);
  const from = Math.floor((centre - 30 * MINUTE) / QUARTER) * QUARTER;
  const to = Math.ceil((centre + 30 * MINUTE) / QUARTER) * QUARTER;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export type EtaCacheRow = { computedAt: string; fromPositionAt: string };

export function shouldRefreshEta(cache: EtaCacheRow | null, positionAt: string, now: Date): boolean {
  if (!cache) return true;
  if (now.getTime() - Date.parse(cache.computedAt) > ETA_CACHE_MS) return true;
  return Date.parse(positionAt) > Date.parse(cache.fromPositionAt);
}

export function roundToFiveMinutes(iso: string): string {
  const step = 5 * MINUTE;
  return new Date(Math.round(Date.parse(iso) / step) * step).toISOString();
}
