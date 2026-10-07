/*
  Loads everything one public tracking view needs and returns the payload.
  Server-only (service role, called after the token resolved); never import
  from client code. All decisions are pure functions in eta.ts, viewInputs.ts
  and publicPayload.ts; this file fetches, calls TomTom when shouldRefreshEta
  says so, and caches the answer in stop_eta_cache so a busy page costs at
  most one TomTom call per stop every two minutes.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPodBranding } from "../pod/brandingServer";
import { parseRoute, routeUrl } from "../tomtom/api";
import { etaWindow, roundToFiveMinutes, shouldRefreshEta, stopsBefore, trackingState, type EtaContext, type ItineraryStop } from "./eta";
import type { ResolvedTrackingLink } from "./linkStore";
import { POSITION_FRESH_MS, buildTrackingPayload, isTrackingEnded, type TrackingPayload } from "./publicPayload";
import { buildBaselines, isStopCompleted, readTrackingPosition, resolveItinerary, toLatLng, usableCachedEta } from "./viewInputs";

const DATE_ONLY_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TOMTOM_TIMEOUT_MS = 5000;

type LatLng = { lat: number; lng: number };
type Position = LatLng & { at: string };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Null when the link should read as ended (cancelled job, delivered over a day ago, stop gone). */
export async function loadTrackingView(admin: SupabaseClient, link: ResolvedTrackingLink, now: Date = new Date()): Promise<TrackingPayload | null> {
  const { tenantId, jobId, stopId } = link;

  const [jobResult, stopsResult] = await Promise.all([
    admin.from("jobs").select("id,status,vehicle_id,delivery_eta,planning_date,scheduled_date").eq("id", jobId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("job_stops").select("id,type,status,pod_status,delivered_at,lat,lng").eq("job_id", jobId).eq("tenant_id", tenantId),
  ]);
  if (jobResult.error) throw new Error(jobResult.error.message);
  if (stopsResult.error) throw new Error(stopsResult.error.message);
  const job = jobResult.data;
  const stops = stopsResult.data ?? [];
  const stop = stops.find((s) => String(s.id) === stopId);
  if (!job || !stop) return null;

  const deliveredAt = str(stop.delivered_at);
  if (isTrackingEnded({ jobStatus: str(job.status), deliveredAt, now })) return null;

  /* Passed to the ETA context as stored; eta.ts normalises it. The itinerary
     lookup needs a plain date, so it gets the YYYY-MM-DD prefix or nothing. */
  const plannedDate = str(job.planning_date ?? job.scheduled_date);
  const planningDay = plannedDate && DATE_ONLY_RE.test(plannedDate.slice(0, 10)) ? plannedDate.slice(0, 10) : null;
  const vehicleId = job.vehicle_id ? String(job.vehicle_id) : null;

  const itinerary = await loadItinerary(admin, tenantId, vehicleId, planningDay);
  const baselines = itinerary ? await loadBaselines(admin, tenantId, [...new Set(itinerary.map((s) => s.jobId))]) : {};

  const ctx: EtaContext = {
    now,
    stop: { id: stopId, jobId, completed: isStopCompleted(stop), deliveredAt, plannedDate },
    job: {
      vehicleId,
      deliveryEta: str(job.delivery_eta),
      deliveryStopCount: stops.filter((s) => s.type === "delivery").length,
      incompleteStopIds: stops.filter((s) => !isStopCompleted(s)).map((s) => String(s.id)),
    },
    itinerary,
    baselines,
  };

  const state = trackingState(ctx);
  const destination = toLatLng(stop.lat, stop.lng);

  /* The position is looked up only for "next": it is the driver's location,
     and earlier in the day it would reveal other customers' drops. */
  let position: Position | null = null;
  let etaLive: string | null = null;
  if (state === "next" && vehicleId) {
    position = await loadLatestPosition(admin, tenantId, vehicleId, now);
    if (position && destination && now.getTime() - Date.parse(position.at) <= POSITION_FRESH_MS) {
      etaLive = await liveEta(admin, { tenantId, stopId, position, destination, now });
    }
  }

  const branding = await loadPodBranding(admin, tenantId);

  return buildTrackingPayload({
    now,
    operatorName: branding.carrierName,
    state,
    etaWindow: etaWindow(ctx),
    etaLive,
    stopsBefore: stopsBefore(ctx),
    position,
    destination,
    deliveredAt,
  });
}

async function loadItinerary(admin: SupabaseClient, tenantId: string, vehicleId: string | null, planningDay: string | null): Promise<ItineraryStop[] | null> {
  if (!vehicleId || !planningDay) return null;
  const failed = (label: string, code: string | undefined) => {
    console.warn(`[tracking] ${label} lookup failed`, code);
    return resolveItinerary({ failed: true, visits: null, stopRows: [] });
  };

  const { data: itinerary, error } = await admin
    .from("planning_route_itineraries")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .eq("planning_date", planningDay)
    .maybeSingle();
  if (error) return failed("itinerary", error.code);
  if (!itinerary) return resolveItinerary({ failed: false, visits: null, stopRows: [] });

  const { data: visits, error: visitsError } = await admin
    .from("planning_route_visit_stops")
    .select("stop_id,job_id,service_sequence_number")
    .eq("tenant_id", tenantId)
    .eq("itinerary_id", itinerary.id)
    .order("service_sequence_number");
  if (visitsError) return failed("itinerary visits", visitsError.code);
  if (!visits || visits.length === 0) return resolveItinerary({ failed: false, visits: [], stopRows: [] });

  const { data: stopRows, error: stopsError } = await admin
    .from("job_stops")
    .select("id,type,status,pod_status,delivered_at")
    .eq("tenant_id", tenantId)
    .in("id", visits.map((v) => String(v.stop_id)));
  if (stopsError) return failed("itinerary stops", stopsError.code);

  return resolveItinerary({ failed: false, visits, stopRows: stopRows ?? [] });
}

async function loadBaselines(admin: SupabaseClient, tenantId: string, jobIds: string[]): Promise<Record<string, string | null>> {
  if (jobIds.length === 0) return {};
  const [jobs, stops] = await Promise.all([
    admin.from("jobs").select("id,delivery_eta").eq("tenant_id", tenantId).in("id", jobIds),
    admin.from("job_stops").select("job_id").eq("tenant_id", tenantId).eq("type", "delivery").in("job_id", jobIds),
  ]);
  if (jobs.error || stops.error) return {};
  return buildBaselines(jobs.data ?? [], stops.data ?? []);
}

async function loadLatestPosition(admin: SupabaseClient, tenantId: string, vehicleId: string, now: Date): Promise<Position | null> {
  const { data, error } = await admin
    .from("telematics_positions")
    .select("latitude,longitude,recorded_at")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) console.warn("[tracking] position lookup failed", error.code);
  if (error || !data) return null;
  return readTrackingPosition(data, now);
}

/* A null from roundToFiveMinutes (unparseable time) reads as "no live ETA".
   A cached answer is only ever shown through usableCachedEta: recent and not
   already in the past, otherwise the page falls back to the window. */
async function liveEta(
  admin: SupabaseClient,
  input: { tenantId: string; stopId: string; position: Position; destination: LatLng; now: Date },
): Promise<string | null> {
  const { data: cache, error: cacheError } = await admin
    .from("stop_eta_cache")
    .select("eta,computed_at,from_position_at")
    .eq("stop_id", input.stopId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (cacheError) console.warn("[tracking] ETA cache lookup failed", cacheError.code);
  const cachedEta = cache ? usableCachedEta({ eta: String(cache.eta), computedAt: String(cache.computed_at) }, input.now) : null;
  const cached = cache ? { computedAt: String(cache.computed_at), fromPositionAt: String(cache.from_position_at) } : null;
  if (cache && !shouldRefreshEta(cached, input.position.at, input.now)) return cachedEta;

  const key = process.env.TOMTOM_API_KEY;
  if (!key) return cachedEta;

  try {
    const response = await fetch(routeUrl([input.position, input.destination], key, { traffic: true }), {
      cache: "no-store",
      signal: AbortSignal.timeout(TOMTOM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`TomTom answered ${response.status}`);
    const route = parseRoute(await response.json());
    if (!route) throw new Error("TomTom route could not be parsed");
    const eta = new Date(input.now.getTime() + route.totalTravelTimeSeconds * 1000).toISOString();
    const { error } = await admin.from("stop_eta_cache").upsert({
      stop_id: input.stopId,
      tenant_id: input.tenantId,
      eta,
      computed_at: input.now.toISOString(),
      from_position_at: input.position.at,
    });
    if (error) console.warn("[tracking] unable to cache ETA", error.code);
    return roundToFiveMinutes(eta);
  } catch (error) {
    console.warn("[tracking] live ETA unavailable", error instanceof Error ? error.message : error);
    return cachedEta;
  }
}
