"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { sanitizeTravelSeconds } from "../../lib/planning/matrix";
import type { PlanJob, RouteResult } from "../../lib/planning/types";
import { operatorDay } from "../../lib/time";

/* Same embedded-relation normalisation as /tracking: Supabase returns an
   embedded relation as an object or a one-element array depending on how it
   infers the relationship, and both shapes have appeared in this codebase. */
function rel(value: any): any {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

type Vehicle = { id: string; registration: string };
type VehicleRow = { id: string; registration: string; active: boolean };
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
  /* The diff the freshly loaded board already implies before the user touches
     anything. Loading normalises the saved plan (one driver per lane, jobs on
     inactive vehicles fall back to the pool), and that normalisation is not
     the user's own edit, so it must not light up "Unsaved changes". */
  const [baselineDiff, setBaselineDiff] = useState("[]");
  /* Vehicle ids whose lane arrived carrying more than one distinct driver. */
  const [driverConflicts, setDriverConflicts] = useState<Set<string>>(new Set());
  /* job id -> disclosure note for fleet jobs that arrived assigned to a
     vehicle no longer in the active fleet; see loadData for how this is
     built and why it matters. */
  const [displacedNotes, setDisplacedNotes] = useState<Record<string, string>>({});
  const [geocodeSettled, setGeocodeSettled] = useState(false);
  /* True when the geocode endpoint refused the whole batch (not configured,
     or rate-limited/forbidden) rather than failing on individual addresses.
     A 503 here means "TomTom isn't set up", not "these addresses are bad",
     and badging every job "no map fix" would read as N data errors during
     the exact manual pass that runs before keys exist. */
  const [geocodeUnavailable, setGeocodeUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [message, setMessage] = useState("");
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  /* Generation counter: each load claims the next value, and its predicate
     checks whether a newer load (or unmount) has since claimed a later one.
     Replaces a single-flag "cancelled" boolean so a save-triggered reload can
     itself be superseded by a later load, not just by unmount. */
  const loadSeq = useRef(0);

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
  const pendingUpdatesJson = useMemo(() => JSON.stringify(pendingUpdates), [pendingUpdates]);
  /* Dirty means "differs from what the load itself produced", not "non-empty".
     Save still writes pendingUpdates in full, normalisation included: by the
     time the button is enabled the user has made a deliberate edit. */
  const dirty = pendingUpdatesJson !== baselineDiff;

  async function loadData(isCancelled: () => boolean) {
    setLoading(true);
    setMessage("");
    setGeocodeSettled(false);
    setGeocodeUnavailable(false);
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
      .filterByTenant(supabase.from("vehicles").select("id, registration, active"))
      .order("registration", { ascending: true });
    const { data: driverData, error: driverError } = await tenant
      .filterByTenant(supabase.from("drivers").select("id, name"))
      .eq("active", true)
      .order("name", { ascending: true });

    if (isCancelled()) return;
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

    // Fetched unfiltered so retired vehicles' registrations are still known
    // (for the displaced-job disclosure below); lanes and everything else
    // stay driven by the active-only derived list, in the same registration
    // order the query already produced.
    const allVehicles: VehicleRow[] = vehicleData ?? [];
    const vehicleList: Vehicle[] = allVehicles
      .filter((v) => v.active)
      .map((v) => ({ id: v.id, registration: v.registration }));
    const activeVehicleIds = new Set(vehicleList.map((v) => v.id));
    const registrationById = new Map(allVehicles.map((v) => [v.id, v.registration]));

    // Lanes from the saved plan: group by vehicle, order by route_order with
    // unsequenced jobs after, in load order. Lane drivers come from the first
    // job that names one, so a saved plan round-trips exactly.
    /* Only jobs on an ACTIVE vehicle become lane jobs. A job pinned to a
       retired vehicle has no lane to render in, so grouping it there would
       hide it from the board entirely; falling through to the derived
       unassigned pool keeps it visible and re-plannable. Visible-in-pool beats
       invisible: saving after a user edit genuinely unassigns it, and the pool
       makes that plain before they press the button. */
    const orders: Record<string, string[]> = {};
    const laneDriverInit: Record<string, string | null> = {};
    const laneDriverSets = new Map<string, Set<string>>();
    const grouped = loaded
      .filter((j) => j.vehicle_id && !j.subcontractor_id && activeVehicleIds.has(j.vehicle_id))
      .sort((a, b) => (a.route_order ?? 1e9) - (b.route_order ?? 1e9));
    for (const job of grouped) {
      const vid = job.vehicle_id as string;
      (orders[vid] ??= []).push(job.id);
      if (laneDriverInit[vid] === undefined && job.driver_id) laneDriverInit[vid] = job.driver_id;
      if (job.driver_id) {
        let seen = laneDriverSets.get(vid);
        if (!seen) { seen = new Set(); laneDriverSets.set(vid, seen); }
        seen.add(job.driver_id);
      }
    }
    // A lane can only carry one driver, so a lane whose jobs disagree is being
    // silently normalised. Flag it rather than let Save surprise the planner.
    const conflicts = new Set<string>();
    for (const [vid, seen] of laneDriverSets) if (seen.size > 1) conflicts.add(vid);

    /* Baseline: the diff this load already implies, before any user action.
       `dirty` compares against it, so load-time normalisation (one driver per
       lane, inactive-vehicle fallout) does not masquerade as an unsaved edit. */
    const laneAssignedIds = new Set(Object.values(orders).flat());
    const initialLanePlans: LanePlan[] = vehicleList.map((v) => ({
      vehicleId: v.id,
      driverId: laneDriverInit[v.id] ?? null,
      jobIds: orders[v.id] ?? [],
    }));
    const initialUnassignedIds = loaded
      .filter((j) => !j.subcontractor_id && !laneAssignedIds.has(j.id))
      .map((j) => j.id);
    const initialDiff = computeSaveDiff(loaded, initialLanePlans, initialUnassignedIds);

    /* The pool's disclosure for jobs displaced by a retired vehicle: the
       unassignment already rides the baseline diff above, so it is only
       actually written once the user makes a deliberate edit and saves. The
       badge is what makes that quiet trade honest in the meantime. */
    const displaced: Record<string, string> = {};
    for (const job of loaded) {
      if (job.subcontractor_id) continue;
      if (job.vehicle_id && !activeVehicleIds.has(job.vehicle_id)) {
        displaced[job.id] = `was on ${registrationById.get(job.vehicle_id) ?? "a retired vehicle"}`;
      }
    }

    if (isCancelled()) return;
    setJobs(loaded);
    setVehicles(vehicleList);
    setDrivers(driverData ?? []);
    setLaneOrders(orders);
    setLaneDrivers(laneDriverInit);
    setDriverConflicts(conflicts);
    setBaselineDiff(JSON.stringify(initialDiff));
    setDisplacedNotes(displaced);
    // Keep the planner's current lane if it survived the reload; only fall
    // back when it did not, so a save-triggered reload does not jump the board.
    setSelectedVehicleId((prev) =>
      prev && activeVehicleIds.has(prev)
        ? prev
        : vehicleList.find((v) => (orders[v.id] ?? []).length > 0)?.id ?? vehicleList[0]?.id ?? null
    );
    setLoading(false);

    // Geocode cache misses, then merge results into state. Failures leave
    // lat/lng null; geocodeSettled turns the null into a "no map fix" badge.
    const missing = stopsNeedingGeocode(loaded);
    if (missing.length === 0) { setGeocodeSettled(true); return; }
    try {
      // Sequential batches of at most GEOCODE_BATCH ids, merged as each lands.
      for (let start = 0; start < missing.length; start += GEOCODE_BATCH) {
        if (isCancelled()) return;
        const batch = missing.slice(start, start + GEOCODE_BATCH);
        const response = await fetch("/api/tomtom/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stopIds: batch }),
        });
        // A refusal will refuse the next batch too, so stop asking. A 503
        // (or 401/403/429) means the geocoder is not configured or is
        // refusing us outright, not that these particular addresses are bad,
        // so that case is tracked separately from a plain per-batch failure.
        if (!response.ok) {
          if ([401, 403, 429, 503].includes(response.status)) {
            if (!isCancelled()) setGeocodeUnavailable(true);
          }
          break;
        }
        const { geocoded } = await response.json();
        if (isCancelled()) return;
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
    if (isCancelled()) return;
    setGeocodeSettled(true);
  }

  useEffect(() => {
    if (tenant.status !== "ready") return;
    const seq = ++loadSeq.current;
    loadData(() => loadSeq.current !== seq);
    // Any newer load (a later effect run, or a save-triggered reload) or an
    // unmount bumps the counter, which invalidates this load's predicate.
    return () => { loadSeq.current++; };
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
    /* `routes` is keyed by vehicle id, so a cached route outlives the lane it
       described. Every lane this job leaves, plus the one it enters, now has a
       different composition: drop just those entries and let the route effect
       refetch the selected one. */
    const affected = new Set<string>();
    if (vehicleId) affected.add(vehicleId);
    for (const [vid, ids] of Object.entries(laneOrders)) {
      if (ids.includes(jobId)) affected.add(vid);
    }
    if (affected.size > 0) {
      setRoutes((prev) => {
        const next = { ...prev };
        for (const vid of affected) delete next[vid];
        return next;
      });
    }
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
        const failure = `Save error: ${error.message}`;
        setMessage(failure);
        setSaving(false);
        /* Earlier updates in this loop already landed. A partial save must not
           leave the board confidently showing the unwritten plan, so reload
           what was actually written. loadData clears `message` on entry, so
           the failure is restated afterwards: the planner must still see it. */
        const seq = ++loadSeq.current;
        await loadData(() => loadSeq.current !== seq);
        setMessage(failure);
        return;
      }
    }
    setSaving(false);
    // Claim the next generation so a date/tenant change during this reload
    // (or the reload itself being superseded by a later save) cancels it
    // instead of painting stale state over the newer load.
    const seq = ++loadSeq.current;
    await loadData(() => loadSeq.current !== seq);
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
      const points = routable.flatMap((j) => {
        const p = jobRepresentativePoint(j);
        return p ? [p] : [];
      });
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
      const matrix = sanitizeTravelSeconds((await response.json())?.travelSeconds, routable.length);
      if (!matrix) { setMessage("Optimize failed."); return; }
      const order = bestOrder(matrix);
      // The optimizer must never be able to delete jobs from a lane, whatever
      // it returns: refuse any order that is not a full permutation.
      if (order.length !== routable.length) {
        setMessage("Optimize failed.");
        return;
      }
      const reordered = order
        .map((i) => routable[i].id)
        .concat(selectedLaneJobs.filter((j) => !isRoutable(j)).map((j) => j.id));
      setLaneOrders((prev) => ({ ...prev, [selectedVehicleId]: reordered }));
      // The lane's order changed, so its cached route describes the old one.
      setRoutes((prev) => {
        const next = { ...prev };
        delete next[selectedVehicleId];
        return next;
      });
    } catch {
      setMessage("Optimize failed.");
    } finally {
      setOptimizing(false);
    }
  }

  const selectedRoute = selectedVehicleId ? (routes[selectedVehicleId] ?? null) : null;
  /* Memoised: a fresh markers array on every parent render tears down and
     rebuilds every TomTom marker, which flickers during a drag.

     The label is the job's position IN THE LANE, not its position among the
     routable ones, so a pin always carries the same number as its card even
     when an unroutable job sits between two routable ones. */
  const markers: MapMarker[] = useMemo(
    () =>
      selectedLaneJobs.flatMap((job, index) => {
        const position = jobRepresentativePoint(job);
        return position ? [{ position, label: String(index + 1) }] : [];
      }),
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
          {geocodeUnavailable ? (
            <p className="text-sm text-ink-3">
              Address lookup is unavailable, so routes and map pins are off. Assigning and sequencing still works.
            </p>
          ) : null}

          <PlanningMap markers={markers} route={selectedRoute} notice={mapNotice} />

          {loading ? (
            <p className="text-sm text-ink-3">Loading the day&apos;s jobs...</p>
          ) : (
            <div className="flex items-start gap-4">
              <UnassignedPool
                jobs={unassigned}
                subcontracted={subcontracted}
                geocodeSettled={geocodeSettled && !geocodeUnavailable}
                displacedNotes={displacedNotes}
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
                      geocodeSettled={geocodeSettled && !geocodeUnavailable}
                      driverConflict={driverConflicts.has(v.id)}
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
