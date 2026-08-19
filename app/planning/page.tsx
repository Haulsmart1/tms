"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Button from "../../components/Button";
import PlanningMap, { type MapMarker } from "./PlanningMap";
import UnassignedPool from "./UnassignedPool";
import VehicleLane from "./VehicleLane";
import { stopsNeedingGeocode } from "../../lib/planning/geocoding";
import { computeSaveDiff, type LanePlan } from "../../lib/planning/saveDiff";
import { formatDistance, formatDuration } from "../../lib/planning/format";
import {
  isRoutable, jobRepresentativePoint, laneWaypoints,
} from "../../lib/planning/waypoints";
import { bestOrder } from "../../lib/planning/optimize";
import type { PlanJob, RouteResult } from "../../lib/planning/types";
import { operatorDay } from "../../lib/time";

/* Same embedded-relation normalisation as /tracking: Supabase returns an
   embedded relation as an object or a one-element array depending on how it
   infers the relationship, and both shapes have appeared in this codebase. */
function rel(value: any): any {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

type Vehicle = { id: string; registration: string };
type Driver = { id: string; name: string };

/* The geocode endpoint caps a batch at 100 stop ids and rejects anything
   larger with a 400 (it does not truncate), so the client chunks. */
const GEOCODE_BATCH = 100;

export default function PlanningPage() {
  const supabase = createClient();
  const tenant = useTenant();

  const [date, setDate] = useState(() => operatorDay(new Date()));
  const [jobs, setJobs] = useState<PlanJob[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [laneOrders, setLaneOrders] = useState<Record<string, string[]>>({});
  const [laneDrivers, setLaneDrivers] = useState<Record<string, string | null>>({});
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<Record<string, RouteResult>>({});
  const [geocodeSettled, setGeocodeSettled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [message, setMessage] = useState("");
  const [mapNotice, setMapNotice] = useState<string | null>(null);

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  const fleetJobs = useMemo(() => jobs.filter((j) => !j.subcontractor_id), [jobs]);
  const subcontracted = useMemo(() => jobs.filter((j) => j.subcontractor_id), [jobs]);

  const assignedIds = useMemo(
    () => new Set(Object.values(laneOrders).flat()),
    [laneOrders]
  );
  const unassigned = useMemo(
    () => fleetJobs.filter((j) => !assignedIds.has(j.id)),
    [fleetJobs, assignedIds]
  );

  const lanePlans: LanePlan[] = useMemo(
    () =>
      vehicles.map((v) => ({
        vehicleId: v.id,
        driverId: laneDrivers[v.id] ?? null,
        jobIds: laneOrders[v.id] ?? [],
      })),
    [vehicles, laneOrders, laneDrivers]
  );
  const pendingUpdates = useMemo(
    () => computeSaveDiff(jobs, lanePlans, unassigned.map((j) => j.id)),
    [jobs, lanePlans, unassigned]
  );
  const dirty = pendingUpdates.length > 0;

  async function loadData() {
    setLoading(true);
    setMessage("");
    setGeocodeSettled(false);
    setRoutes({});

    const jobsQuery = supabase
      .from("jobs")
      .select(`
        id, reference, status, scheduled_date, vehicle_id, driver_id,
        subcontractor_id, route_order,
        customers ( name ),
        job_stops ( id, stop_order, type, address_line, city, postcode, lat, lng )
      `)
      .eq("scheduled_date", date);

    const { data: jobsData, error: jobsError } = await tenant
      .filterByTenant(jobsQuery)
      .order("created_at", { ascending: true });
    const { data: vehicleData, error: vehicleError } = await tenant
      .filterByTenant(supabase.from("vehicles").select("id, registration"))
      .eq("active", true)
      .order("registration", { ascending: true });
    const { data: driverData, error: driverError } = await tenant
      .filterByTenant(supabase.from("drivers").select("id, name"))
      .eq("active", true)
      .order("name", { ascending: true });

    if (jobsError) { setMessage(`Jobs load error: ${jobsError.message}`); setLoading(false); return; }
    if (vehicleError) { setMessage(`Vehicles load error: ${vehicleError.message}`); setLoading(false); return; }
    if (driverError) { setMessage(`Drivers load error: ${driverError.message}`); setLoading(false); return; }

    const loaded: PlanJob[] = (jobsData ?? []).map((row: any) => ({
      id: row.id,
      reference: row.reference,
      status: row.status,
      vehicle_id: row.vehicle_id,
      driver_id: row.driver_id,
      subcontractor_id: row.subcontractor_id,
      route_order: row.route_order,
      customer_name: rel(row.customers)?.name ?? null,
      stops: (row.job_stops ?? []).map((s: any) => ({
        id: s.id, stop_order: s.stop_order, type: s.type,
        address_line: s.address_line, city: s.city, postcode: s.postcode,
        lat: s.lat, lng: s.lng,
      })),
    }));

    // Lanes from the saved plan: group by vehicle, order by route_order with
    // unsequenced jobs after, in load order. Lane drivers come from the first
    // job that names one, so a saved plan round-trips exactly.
    const orders: Record<string, string[]> = {};
    const laneDriverInit: Record<string, string | null> = {};
    const grouped = loaded
      .filter((j) => j.vehicle_id && !j.subcontractor_id)
      .sort((a, b) => (a.route_order ?? 1e9) - (b.route_order ?? 1e9));
    for (const job of grouped) {
      const vid = job.vehicle_id as string;
      (orders[vid] ??= []).push(job.id);
      if (laneDriverInit[vid] === undefined && job.driver_id) laneDriverInit[vid] = job.driver_id;
    }

    setJobs(loaded);
    setVehicles(vehicleData ?? []);
    setDrivers(driverData ?? []);
    setLaneOrders(orders);
    setLaneDrivers(laneDriverInit);
    setSelectedVehicleId(
      (vehicleData ?? []).find((v: Vehicle) => (orders[v.id] ?? []).length > 0)?.id ??
        (vehicleData ?? [])[0]?.id ?? null
    );
    setLoading(false);

    // Geocode cache misses, then merge results into state. Failures leave
    // lat/lng null; geocodeSettled turns the null into a "no map fix" badge.
    const missing = stopsNeedingGeocode(loaded);
    if (missing.length === 0) { setGeocodeSettled(true); return; }
    try {
      // Sequential batches of at most GEOCODE_BATCH ids, merged as each lands.
      for (let start = 0; start < missing.length; start += GEOCODE_BATCH) {
        const batch = missing.slice(start, start + GEOCODE_BATCH);
        const response = await fetch("/api/tomtom/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stopIds: batch }),
        });
        // A refusal (403, 429, 503, ...) will refuse the next batch too, so
        // stop asking and let the badges explain the missing fixes.
        if (!response.ok) break;
        const { geocoded } = await response.json();
        const byStop = new Map<string, { lat: number; lng: number }>(
          (geocoded ?? []).map((g: any) => [g.id, { lat: g.lat, lng: g.lng }])
        );
        setJobs((prev) =>
          prev.map((job) => ({
            ...job,
            stops: job.stops.map((s) => {
              const hit = byStop.get(s.id);
              return hit ? { ...s, lat: hit.lat, lng: hit.lng } : s;
            }),
          }))
        );
      }
    } catch {
      // Board-only mode: badges explain themselves once settled.
    }
    setGeocodeSettled(true);
  }

  useEffect(() => {
    if (tenant.status !== "ready") return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId, date]);

  // Route for the selected vehicle, refetched when its lane content changes.
  const selectedLaneJobs = useMemo(() => {
    if (!selectedVehicleId) return [];
    return (laneOrders[selectedVehicleId] ?? [])
      .map((id) => jobById.get(id))
      .filter((j): j is PlanJob => Boolean(j));
  }, [selectedVehicleId, laneOrders, jobById]);

  useEffect(() => {
    if (!selectedVehicleId || !geocodeSettled) return;
    const points = laneWaypoints(selectedLaneJobs);
    if (points.length < 2) {
      setRoutes((prev) => {
        const next = { ...prev };
        delete next[selectedVehicleId];
        return next;
      });
      setMapNotice(
        selectedLaneJobs.length > 0 && points.length < 2
          ? "Not enough mappable stops to draw a route."
          : null
      );
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/tomtom/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points }),
        });
        if (cancelled) return;
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setMapNotice(body?.error ?? "Route calculation failed.");
          return;
        }
        const route: RouteResult = await response.json();
        setRoutes((prev) => ({ ...prev, [selectedVehicleId]: route }));
        setMapNotice(null);
      } catch {
        if (!cancelled) setMapNotice("Route calculation failed.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId, selectedLaneJobs, geocodeSettled]);

  function moveJob(jobId: string, vehicleId: string | null, beforeJobId: string | null) {
    const job = jobById.get(jobId);
    if (!job || job.subcontractor_id) return;
    setLaneOrders((prev) => {
      const next: Record<string, string[]> = {};
      for (const [vid, ids] of Object.entries(prev)) next[vid] = ids.filter((id) => id !== jobId);
      if (vehicleId) {
        const lane = next[vehicleId] ?? [];
        const at = beforeJobId ? lane.indexOf(beforeJobId) : -1;
        if (at === -1) lane.push(jobId);
        else lane.splice(at, 0, jobId);
        next[vehicleId] = lane;
      }
      return next;
    });
  }

  async function savePlan() {
    if (saving || pendingUpdates.length === 0) return;
    setSaving(true);
    setMessage("");
    for (const u of pendingUpdates) {
      const { error } = await supabase
        .from("jobs")
        .update({ vehicle_id: u.vehicle_id, driver_id: u.driver_id, route_order: u.route_order })
        .eq("id", u.id);
      if (error) {
        setMessage(`Save error: ${error.message}`);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    await loadData();
  }

  async function optimize() {
    if (optimizing || !selectedVehicleId) return;
    const routable = selectedLaneJobs.filter(isRoutable);
    if (routable.length < 2) {
      setMessage("Optimize needs at least two mappable jobs in the selected lane.");
      return;
    }
    setOptimizing(true);
    setMessage("");
    try {
      const points = routable.map((j) => jobRepresentativePoint(j));
      const response = await fetch("/api/tomtom/matrix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setMessage(body?.error ?? "Optimize failed.");
        return;
      }
      const { travelSeconds } = await response.json();
      const order = bestOrder(travelSeconds);
      const reordered = order
        .map((i) => routable[i].id)
        .concat(selectedLaneJobs.filter((j) => !isRoutable(j)).map((j) => j.id));
      setLaneOrders((prev) => ({ ...prev, [selectedVehicleId]: reordered }));
    } catch {
      setMessage("Optimize failed.");
    } finally {
      setOptimizing(false);
    }
  }

  const selectedRoute = selectedVehicleId ? (routes[selectedVehicleId] ?? null) : null;
  /* Memoised: a fresh markers array on every parent render tears down and
     rebuilds every TomTom marker, which flickers during a drag. */
  const markers: MapMarker[] = useMemo(
    () =>
      selectedLaneJobs
        .filter(isRoutable)
        .map((job, index) => ({
          position: jobRepresentativePoint(job) as { lat: number; lng: number },
          label: String(index + 1),
        })),
    [selectedLaneJobs]
  );

  function laneSummary(vehicleId: string): string | null {
    const route = routes[vehicleId];
    const count = (laneOrders[vehicleId] ?? []).length;
    if (!route) return null;
    return `${count} ${count === 1 ? "job" : "jobs"} · ${formatDistance(route.totalDistanceMeters)} · ${formatDuration(route.totalTravelTimeSeconds)}`;
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <div className="flex flex-col gap-4 p-6">
          <header className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">Planning</h1>
            <input
              type="date"
              aria-label="Plan date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
            />
            {selectedRoute ? (
              <span className="text-sm text-ink-2">
                {formatDistance(selectedRoute.totalDistanceMeters)} · {formatDuration(selectedRoute.totalTravelTimeSeconds)}
              </span>
            ) : null}
            {dirty ? <span className="text-xs text-ink-3">Unsaved changes</span> : null}
            <span className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={optimize} loading={optimizing}>
                Optimize order
              </Button>
              <Button size="sm" onClick={savePlan} loading={saving} disabled={!dirty}>
                Save plan
              </Button>
            </span>
          </header>

          {message ? <p className="text-sm text-danger">{message}</p> : null}

          <PlanningMap markers={markers} route={selectedRoute} notice={mapNotice} />

          {loading ? (
            <p className="text-sm text-ink-3">Loading the day&apos;s jobs...</p>
          ) : (
            <div className="flex items-start gap-4">
              <UnassignedPool
                jobs={unassigned}
                subcontracted={subcontracted}
                geocodeSettled={geocodeSettled}
                onDropJob={(jobId) => moveJob(jobId, null, null)}
              />
              <div className="flex flex-1 flex-col gap-3">
                {vehicles.length === 0 ? (
                  <p className="text-sm text-ink-3">No active vehicles. Add one under Fleet.</p>
                ) : (
                  vehicles.map((v) => (
                    <VehicleLane
                      key={v.id}
                      vehicle={v}
                      jobs={(laneOrders[v.id] ?? [])
                        .map((id) => jobById.get(id))
                        .filter((j): j is PlanJob => Boolean(j))}
                      driverId={laneDrivers[v.id] ?? null}
                      drivers={drivers}
                      selected={v.id === selectedVehicleId}
                      summary={laneSummary(v.id)}
                      geocodeSettled={geocodeSettled}
                      onSelect={() => setSelectedVehicleId(v.id)}
                      onDriverChange={(driverId) =>
                        setLaneDrivers((prev) => ({ ...prev, [v.id]: driverId }))
                      }
                      onDropJob={(jobId, beforeJobId) => moveJob(jobId, v.id, beforeJobId)}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </TenantGate>
  );
}
