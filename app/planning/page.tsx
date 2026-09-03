"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Button from "../../components/Button";
import PlanningMap, { type MapMarker } from "./PlanningMap";
import UnassignedPool from "./UnassignedPool";
import VehicleLane from "./VehicleLane";
import { stopsNeedingGeocode } from "../../lib/planning/geocoding";
import { computeSaveDiff, type LanePlan } from "../../lib/planning/saveDiff";
import {
  assignJobsToLane,
  moveJobInLane,
} from "../../lib/planning/boardActions";
import { formatDistance, formatDuration } from "../../lib/planning/format";
import {
  isRoutable, jobEntryPoint, jobExitPoint, jobRepresentativePoint, laneWaypoints,
} from "../../lib/planning/waypoints";
import { bestOrder } from "../../lib/planning/optimize";
import { sanitizeTravelSeconds } from "../../lib/planning/matrix";
import type { PlanJob, RouteResult } from "../../lib/planning/types";
import { createSupabasePositionSource } from "../../lib/tracking/supabasePositions";
import type { PositionReading } from "../../lib/tracking/position";
import {
  evaluatePlanningCompliance,
  type PlanningCompliance,
  type PlanningComplianceDriver,
} from "../../lib/planning/compliance";
import type { ComplianceVehicleFacts } from "../../lib/planning/regime";
import {
  summarizeLaneRegimes,
  type LaneRegimeSummary,
} from "../../lib/planning/laneRegime";
import {
  isValidIanaTimeZone,
  OPERATOR_TIME_ZONE,
  operatorDay,
  operatorDayInTimeZone,
} from "../../lib/time";

/* Same embedded-relation normalisation as /tracking: Supabase returns an
   embedded relation as an object or a one-element array depending on how it
   infers the relationship, and both shapes have appeared in this codebase. */
function rel(value: any): any {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

type Vehicle = {
  id: string;
  registration: string;
} & ComplianceVehicleFacts;

type VehicleRow = Vehicle & {
  active: boolean;
};
type Driver = PlanningComplianceDriver;

/* The geocode endpoint caps a batch at 100 stop ids and rejects anything
   larger with a 400 (it does not truncate), so the client chunks. */
const GEOCODE_BATCH = 100;
const POSITION_POLL_MS = 30_000;

export default function PlanningPage() {
  const router = useRouter();
  const supabase = createClient();
  const tenant = useTenant();

  const [date, setDate] = useState(() => {
    const fallback = operatorDay(new Date());

    if (typeof window === "undefined") {
      return fallback;
    }

    const requestedDate =
      new URLSearchParams(window.location.search).get("date");

    return requestedDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : fallback;
  });
  const [planningTimeZone, setPlanningTimeZone] = useState(OPERATOR_TIME_ZONE);
  const [jobs, setJobs] = useState<PlanJob[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [positions, setPositions] = useState<Map<string, PositionReading>>(
    new Map()
  );
  const [positionNow, setPositionNow] = useState(() => new Date());
  const [laneOrders, setLaneOrders] = useState<Record<string, string[]>>({});
  const [laneDrivers, setLaneDrivers] = useState<Record<string, string | null>>({});
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [bulkVehicleId, setBulkVehicleId] = useState("");
  const [selectedUnassignedJobIds, setSelectedUnassignedJobIds] = useState<Set<string>>(
    new Set()
  );
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
  const [acceptanceTarget, setAcceptanceTarget] = useState<{
    jobs: {
      id: string;
      tenant_id: string;
      reference: string | null;
    }[];
  } | null>(null);
  const [acceptanceForm, setAcceptanceForm] = useState({
    collection_eta: "",
    delivery_eta: "",
    acceptance_note: "",
  });
  const [accepting, setAccepting] = useState(false);
  const [message, setMessage] = useState("");
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  /* Generation counter: each load claims the next value, and its predicate
     checks whether a newer load (or unmount) has since claimed a later one.
     Replaces a single-flag "cancelled" boolean so a save-triggered reload can
     itself be superseded by a later load, not just by unmount. */
  const loadSeq = useRef(0);

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const driverById = useMemo(
    () => new Map(drivers.map((driver) => [driver.id, driver])),
    [drivers]
  );

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

  const selectedUnassignedCount = useMemo(
    () =>
      unassigned.reduce(
        (count, job) => count + (selectedUnassignedJobIds.has(job.id) ? 1 : 0),
        0
      ),
    [unassigned, selectedUnassignedJobIds]
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
    /* The effect below already checks this before calling. Repeated here
       because a narrowing does not cross a function boundary, so without it
       filterByTenant is unavailable in this body. */
    if (tenant.status !== "ready") return;

    setLoading(true);
    setMessage("");
    setGeocodeSettled(false);
    setGeocodeUnavailable(false);
    setRoutes({});
    setPlanningTimeZone(OPERATOR_TIME_ZONE);

    const profileQuery = tenant
      .filterByTenant(
        supabase.from("company_profiles").select("timezone")
      )
      .maybeSingle();

    const jobsQuery = supabase
      .from("jobs")
      .select(`
        id, tenant_id, reference, status, scheduled_date, planning_date,
        collection_eta, delivery_eta, acceptance_note, accepted_at, accepted_by,
        vehicle_id, driver_id, subcontractor_id, route_order,
        journey_scope, origin_country_code, destination_country_code,
        compliance_regime_override, compliance_override_reason,
        customers ( name ),
        job_stops ( id, stop_order, type, address_line, city, postcode, lat, lng )
      `)
      .or(
        `planning_date.eq.${date},and(planning_date.is.null,scheduled_date.eq.${date})`
      );

    const { data: profileData, error: profileError } = await profileQuery;
    const { data: jobsData, error: jobsError } = await tenant
      .filterByTenant(jobsQuery)
      .order("created_at", { ascending: true });
    const { data: vehicleData, error: vehicleError } = await tenant
      .filterByTenant(
        supabase.from("vehicles").select(`
          id,
          registration,
          active,
          mam_kg,
          trailer_mam_kg,
          tachograph_fitted,
          tachograph_type,
          home_country_code
        `)
      )
      .order("registration", { ascending: true });
    const { data: driverData, error: driverError } = await tenant
      .filterByTenant(
        supabase.from("drivers").select(`
          id,
          name,
          tachograph_required,
          tachograph_card_number,
          tachograph_expiry,
          tachograph_next_download_due,
          cpc_required,
          cpc_qualified,
          cpc_expiry
        `)
      )
      .eq("active", true)
      .order("name", { ascending: true });

    if (isCancelled()) return;
    if (profileError) {
      setMessage(`Company profile load error: ${profileError.message}`);
      setLoading(false);
      return;
    }
    if (jobsError) { setMessage(`Jobs load error: ${jobsError.message}`); setLoading(false); return; }
    if (vehicleError) { setMessage(`Vehicles load error: ${vehicleError.message}`); setLoading(false); return; }
    if (driverError) { setMessage(`Drivers load error: ${driverError.message}`); setLoading(false); return; }

    const profileTimeZone =
      typeof profileData?.timezone === "string"
        ? profileData.timezone.trim()
        : "";
    const loadedTimeZone =
      profileTimeZone && isValidIanaTimeZone(profileTimeZone)
        ? profileTimeZone
        : OPERATOR_TIME_ZONE;

    const loaded: PlanJob[] = (jobsData ?? []).map((row: any) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      reference: row.reference,
      status: row.status,
      collection_eta: row.collection_eta,
      delivery_eta: row.delivery_eta,
      acceptance_note: row.acceptance_note,
      accepted_at: row.accepted_at,
      accepted_by: row.accepted_by,
      vehicle_id: row.vehicle_id,
      driver_id: row.driver_id,
      subcontractor_id: row.subcontractor_id,
      route_order: row.route_order,
      journey_scope: row.journey_scope,
      origin_country_code: row.origin_country_code,
      destination_country_code: row.destination_country_code,
      compliance_regime_override: row.compliance_regime_override,
      compliance_override_reason: row.compliance_override_reason,
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
      .map((v) => ({
        id: v.id,
        registration: v.registration,
        mam_kg: v.mam_kg,
        trailer_mam_kg: v.trailer_mam_kg,
        tachograph_fitted: v.tachograph_fitted,
        tachograph_type: v.tachograph_type,
        home_country_code: v.home_country_code,
      }));
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
    setPlanningTimeZone(loadedTimeZone);
    setJobs(loaded);
    setSelectedUnassignedJobIds(new Set());
    setBulkVehicleId("");
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

  useEffect(() => {
    if (tenant.status !== "ready") {
      setPositions(new Map());
      return;
    }

    let cancelled = false;
    let inFlight = false;

    async function loadPositions() {
      /* Same reason as loadData above: the effect already returned for this
         case, but the narrowing does not reach into this function. Before the
         inFlight latch, so an unresolved tenant never marks a load in flight. */
      if (tenant.status !== "ready") return;
      if (inFlight) return;
      inFlight = true;

      const startedAt = new Date();

      try {
        const vehicleIds = vehicles.map((vehicle) => vehicle.id);
        const source = createSupabasePositionSource(supabase, tenant);
        const readings = await source.getPositions(vehicleIds);

        if (cancelled) return;

        setPositions(readings);
        setPositionNow(startedAt);
      } catch {
        if (!cancelled) {
          // Preserve the last known fixes across a transient refresh failure,
          // but advance "now" so an old reading can correctly become stale.
          setPositionNow(startedAt);
        }
      } finally {
        inFlight = false;
      }
    }

    loadPositions();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadPositions();
      }
    }, POSITION_POLL_MS);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        loadPositions();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };

    // supabase and tenant are stable providers for the lifetime of this
    // tenant selection; vehicle membership is the trigger that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId, vehicles]);

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

    setSelectedUnassignedJobIds((prev) => {
      if (!prev.has(jobId)) return prev;
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });

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

  function openAcceptanceTargets(targetJobs: PlanJob[]) {
    const pendingTargets = targetJobs.filter(
      (job) => job.status === "pending_acceptance"
    );

    if (pendingTargets.length === 0) {
      setMessage("There are no jobs awaiting acceptance.");
      return;
    }

    if (pendingTargets.some((job) => !job.tenant_id)) {
      setMessage(
        "Cannot accept these jobs because tenant information is unavailable."
      );
      return;
    }

    const pendingJobs = pendingTargets.filter(
      (job): job is PlanJob & { tenant_id: string } =>
        typeof job.tenant_id === "string" && job.tenant_id.length > 0
    );

    if (pendingJobs.length !== pendingTargets.length) {
      setMessage(
        "Cannot accept these jobs because tenant information is unavailable."
      );
      return;
    }

    const tenantIds = new Set(pendingJobs.map((job) => job.tenant_id));

    if (tenantIds.size !== 1) {
      setMessage("Cannot accept jobs belonging to different tenants together.");
      return;
    }

    setMessage("");
    setAcceptanceTarget({
      jobs: pendingJobs.map((job) => ({
        id: job.id,
        tenant_id: job.tenant_id,
        reference: job.reference,
      })),
    });
    setAcceptanceForm({
      collection_eta: "",
      delivery_eta: "",
      acceptance_note: "",
    });
  }

  function openAcceptance(jobId: string) {
    const job = jobById.get(jobId);

    if (!job || job.status !== "pending_acceptance") {
      setMessage("This job is no longer awaiting acceptance.");
      return;
    }

    openAcceptanceTargets([job]);
  }

  function openAcceptAllPending() {
    openAcceptanceTargets(
      jobs.filter((job) => job.status === "pending_acceptance")
    );
  }

  function cancelAcceptance() {
    if (accepting) {
      return;
    }

    setAcceptanceTarget(null);
    setAcceptanceForm({
      collection_eta: "",
      delivery_eta: "",
      acceptance_note: "",
    });
  }

  async function confirmAcceptance() {
    if (!acceptanceTarget || accepting) {
      return;
    }

    setMessage("");

    if (!acceptanceForm.collection_eta) {
      setMessage("Enter a collection ETA before accepting the job.");
      return;
    }

    const collectionDate = new Date(acceptanceForm.collection_eta);

    if (Number.isNaN(collectionDate.getTime())) {
      setMessage("Enter a valid collection ETA.");
      return;
    }

    let deliveryDate: Date | null = null;

    if (acceptanceForm.delivery_eta) {
      deliveryDate = new Date(acceptanceForm.delivery_eta);

      if (Number.isNaN(deliveryDate.getTime())) {
        setMessage("Enter a valid delivery ETA.");
        return;
      }

      if (deliveryDate.getTime() < collectionDate.getTime()) {
        setMessage(
          "Delivery ETA cannot be earlier than collection ETA."
        );
        return;
      }
    }

    const targets = acceptanceTarget.jobs;

    if (targets.length === 0) {
      setMessage("There are no jobs awaiting acceptance.");
      setAcceptanceTarget(null);
      return;
    }

    const tenantIds = new Set(targets.map((target) => target.tenant_id));

    if (tenantIds.size !== 1) {
      setMessage("Cannot accept jobs belonging to different tenants together.");
      return;
    }

    const tenantId = targets[0].tenant_id;
    const targetIds = Array.from(
      new Set(targets.map((target) => target.id))
    );

    if (targetIds.length !== targets.length) {
      setMessage("Acceptance stopped because duplicate jobs were selected.");
      return;
    }

    setAccepting(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setMessage(
          "Your session has expired. Please sign in again."
        );
        return;
      }

      const acceptedAt = new Date().toISOString();
      const collectionEta = collectionDate.toISOString();
      const deliveryEta = deliveryDate
        ? deliveryDate.toISOString()
        : null;
      const acceptanceNote =
        acceptanceForm.acceptance_note.trim() || null;

      const {
        data: acceptedJobs,
        error: acceptanceError,
      } = await supabase
        .from("jobs")
        .update({
          status: "planned",
          accepted_at: acceptedAt,
          accepted_by: user.id,
          collection_eta: collectionEta,
          delivery_eta: deliveryEta,
          acceptance_note: acceptanceNote,
        })
        .in("id", targetIds)
        .eq("tenant_id", tenantId)
        .eq("status", "pending_acceptance")
        .select("id");

      if (acceptanceError) {
        setMessage(
          `Accept job error: ${acceptanceError.message}`
        );
        return;
      }

      const acceptedIds = new Set(
        (acceptedJobs ?? []).map((job) => job.id)
      );

      if (acceptedIds.size !== targetIds.length) {
        const failure =
          acceptedIds.size === 0
            ? "These jobs have already been accepted or are no longer awaiting acceptance."
            : `${acceptedIds.size} of ${targetIds.length} jobs were accepted. The board has been reloaded because another job changed.`;

        setAcceptanceTarget(null);

        const seq = ++loadSeq.current;
        await loadData(() => loadSeq.current !== seq);
        setMessage(failure);
        return;
      }

      setJobs((prev) =>
        prev.map((job) =>
          acceptedIds.has(job.id)
            ? {
                ...job,
                status: "planned",
                collection_eta: collectionEta,
                delivery_eta: deliveryEta,
                acceptance_note: acceptanceNote,
                accepted_at: acceptedAt,
                accepted_by: user.id,
              }
            : job
        )
      );

      setMessage(
        targetIds.length === 1
          ? `Job ${targets[0].reference ?? targets[0].id} accepted.`
          : `${targetIds.length} jobs accepted.`
      );

      setAcceptanceTarget(null);
      setAcceptanceForm({
        collection_eta: "",
        delivery_eta: "",
        acceptance_note: "",
      });
    } finally {
      setAccepting(false);
    }
  }

  function toggleUnassignedSelection(jobId: string, selected: boolean) {
    if (!unassigned.some((job) => job.id === jobId)) return;

    setSelectedUnassignedJobIds((prev) => {
      const next = new Set(prev);

      if (selected) {
        next.add(jobId);
      } else {
        next.delete(jobId);
      }

      return next;
    });
  }

  function selectAllUnassigned() {
    setSelectedUnassignedJobIds(new Set(unassigned.map((job) => job.id)));
  }

  function clearUnassignedSelection() {
    setSelectedUnassignedJobIds(new Set());
  }

  function assignSelectedToVehicle() {
    const vehicleId = bulkVehicleId || selectedVehicleId;

    if (!vehicleId || !vehicles.some((vehicle) => vehicle.id === vehicleId)) {
      setMessage("Choose a vehicle before assigning selected jobs.");
      return;
    }

    const selectedIds = unassigned
      .filter((job) => selectedUnassignedJobIds.has(job.id))
      .map((job) => job.id);

    if (selectedIds.length === 0) {
      setMessage("Check at least one unassigned job first.");
      return;
    }

    setLaneOrders((prev) =>
      assignJobsToLane(prev, selectedIds, vehicleId)
    );

    setRoutes((prev) => {
      const next = { ...prev };
      delete next[vehicleId];
      return next;
    });

    setSelectedVehicleId(vehicleId);
    setBulkVehicleId(vehicleId);
    setSelectedUnassignedJobIds(new Set());
    setMessage("");
  }

  function moveLaneJob(jobId: string, vehicleId: string, offset: -1 | 1) {
    const currentLane = laneOrders[vehicleId] ?? [];
    const currentIndex = currentLane.indexOf(jobId);

    if (
      currentIndex === -1 ||
      currentIndex + offset < 0 ||
      currentIndex + offset >= currentLane.length
    ) {
      return;
    }

    setLaneOrders((prev) =>
      moveJobInLane(prev, vehicleId, jobId, offset)
    );

    setRoutes((prev) => {
      const next = { ...prev };
      delete next[vehicleId];
      return next;
    });

    setSelectedVehicleId(vehicleId);
    setBulkVehicleId(vehicleId);
    setMessage("");
  }

  async function savePlan() {
    if (saving || pendingUpdates.length === 0) return;

    const missingTenantUpdate = pendingUpdates.find(
      (update) => !jobById.get(update.id)?.tenant_id
    );

    if (missingTenantUpdate) {
      setMessage(
        "Save error: one or more jobs are missing tenant information."
      );
      return;
    }

    setSaving(true);
    setMessage("");

    for (const u of pendingUpdates) {
      const tenantId = jobById.get(u.id)?.tenant_id;

      if (!tenantId) {
        setMessage(
          "Save error: one or more jobs are missing tenant information."
        );
        setSaving(false);
        return;
      }

      const { error } = await supabase
        .from("jobs")
        .update({
          vehicle_id: u.vehicle_id,
          driver_id: u.driver_id,
          route_order: u.route_order,
        })
        .eq("id", u.id)
        .eq("tenant_id", tenantId);
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
      const origins = routable.flatMap((job) => {
        const point = jobExitPoint(job);
        return point ? [point] : [];
      });
      const destinations = routable.flatMap((job) => {
        const point = jobEntryPoint(job);
        return point ? [point] : [];
      });

      if (
        origins.length !== routable.length ||
        destinations.length !== routable.length
      ) {
        setMessage("Smart Optimize failed: one or more jobs has no route entry or exit.");
        return;
      }

      const response = await fetch("/api/tomtom/matrix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origins, destinations }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setMessage(body?.error ?? "Optimize failed.");
        return;
      }
      const matrix = sanitizeTravelSeconds((await response.json())?.travelSeconds, routable.length);
      if (!matrix) { setMessage("Optimize failed."); return; }
      const order = bestOrder(matrix);
      // The optimizer must never delete, duplicate or invent jobs.
      const uniqueIndexes = new Set(order);
      if (
        order.length !== routable.length ||
        uniqueIndexes.size !== routable.length ||
        order.some(
          (index) =>
            !Number.isInteger(index) ||
            index < 0 ||
            index >= routable.length
        )
      ) {
        setMessage("Smart Optimize failed.");
        return;
      }
      const reordered = order
        .map((i) => routable[i].id)
        .concat(selectedLaneJobs.filter((j) => !isRoutable(j)).map((j) => j.id));
      setLaneOrders((prev) => ({ ...prev, [selectedVehicleId]: reordered }));
      setMessage(
        "Smart Optimize updated the proposed drop order. Review it, then Save plan to persist it."
      );
      // The lane's order changed, so its cached route describes the old one.
      setRoutes((prev) => {
        const next = { ...prev };
        delete next[selectedVehicleId];
        return next;
      });
    } catch {
      setMessage("Smart Optimize failed.");
    } finally {
      setOptimizing(false);
    }
  }

  const selectedVehicle = selectedVehicleId
    ? vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null
    : null;
  const selectedRoute = selectedVehicleId ? (routes[selectedVehicleId] ?? null) : null;
  const selectedVehicleReading = selectedVehicleId
    ? (positions.get(selectedVehicleId) ?? null)
    : null;

  const laneRegimeByVehicle = useMemo(() => {
    const result = new Map<string, LaneRegimeSummary>();

    for (const vehicle of vehicles) {
      const laneJobs = (laneOrders[vehicle.id] ?? [])
        .map((jobId) => jobById.get(jobId))
        .filter((job): job is PlanJob => Boolean(job));

      result.set(
        vehicle.id,
        summarizeLaneRegimes(vehicle, laneJobs)
      );
    }

    return result;
  }, [vehicles, laneOrders, jobById]);

  const laneComplianceByVehicle = useMemo(() => {
    const today = operatorDayInTimeZone(positionNow, planningTimeZone);
    const result = new Map<string, PlanningCompliance>();

    for (const vehicle of vehicles) {
      const jobCount = (laneOrders[vehicle.id] ?? []).length;
      const driverId = laneDrivers[vehicle.id] ?? null;
      const route = routes[vehicle.id] ?? null;

      result.set(
        vehicle.id,
        evaluatePlanningCompliance({
          driver: driverId ? (driverById.get(driverId) ?? null) : null,
          hasPlannedJobs: jobCount > 0,
          plannedDrivingSeconds:
            jobCount === 0
              ? 0
              : route?.totalTravelTimeSeconds ?? null,
          activityDataAvailable: false,
          today,
        })
      );
    }

    return result;
  }, [
    vehicles,
    laneOrders,
    laneDrivers,
    routes,
    driverById,
    positionNow,
    planningTimeZone,
  ]);

  const planningHealth = useMemo(() => {
    const plannedVehicleIds = vehicles
      .filter((vehicle) => (laneOrders[vehicle.id] ?? []).length > 0)
      .map((vehicle) => vehicle.id);

    const results = plannedVehicleIds
      .map((vehicleId) => laneComplianceByVehicle.get(vehicleId))
      .filter((value): value is PlanningCompliance => Boolean(value));

    return {
      plannedVehicles: plannedVehicleIds.length,
      unassignedJobs: unassigned.length,
      routesCalculated: plannedVehicleIds.filter(
        (vehicleId) => Boolean(routes[vehicleId])
      ).length,
      warnings: results.filter(
        (result) => result.status === "warning"
      ).length,
      incomplete: results.filter(
        (result) => !result.dataComplete
      ).length,
    };
  }, [
    vehicles,
    laneOrders,
    laneComplianceByVehicle,
    routes,
    unassigned.length,
  ]);

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

          </header>

          {message ? <p className="text-sm text-danger">{message}</p> : null}
          {geocodeUnavailable ? (
            <p className="text-sm text-ink-3">
              Address lookup is unavailable, so routes and map pins are off. Assigning and sequencing still works.
            </p>
          ) : null}

          <section
            aria-label="Planning health"
            className="grid gap-2 rounded-lg border border-line bg-surface p-3 shadow-sm sm:grid-cols-2 xl:grid-cols-5"
          >
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-3">
                Planned vehicles
              </p>
              <p className="text-lg font-semibold text-ink">
                {planningHealth.plannedVehicles}
              </p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-ink-3">
                Unassigned jobs
              </p>
              <p className="text-lg font-semibold text-ink">
                {planningHealth.unassignedJobs}
              </p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-ink-3">
                Routes calculated
              </p>
              <p className="text-lg font-semibold text-ink">
                {planningHealth.routesCalculated}
                <span className="text-sm font-normal text-ink-3">
                  {" / "}
                  {planningHealth.plannedVehicles}
                </span>
              </p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-ink-3">
                Wizard warnings
              </p>
              <p className="text-lg font-semibold text-warning">
                {planningHealth.warnings}
              </p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-ink-3">
                Compliance incomplete
              </p>
              <p className="text-lg font-semibold text-ink">
                {planningHealth.incomplete}
              </p>
            </div>

            <p className="sm:col-span-2 xl:col-span-5 text-xs text-ink-3">
              Advisory mode: no hard dispatch blocks. Actual driving,
              remaining hours, breaks and WTD stay unknown until driver
              activity data is available.
            </p>
          </section>

          <PlanningMap
            markers={markers}
            route={selectedRoute}
            notice={mapNotice}
            reading={selectedVehicleReading}
            now={positionNow}
          />

          <section
            aria-label="Planning actions"
            className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 p-3"
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={selectAllUnassigned}
              disabled={unassigned.length === 0}
            >
              Check all
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={clearUnassignedSelection}
              disabled={selectedUnassignedCount === 0}
            >
              Clear
            </Button>

            <span className="min-w-[80px] text-xs font-medium text-ink-2">
              {selectedUnassignedCount} selected
            </span>

            <select
              aria-label="Vehicle for selected jobs"
              value={bulkVehicleId || selectedVehicleId || ""}
              onChange={(e) => {
                const vehicleId = e.target.value;
                setBulkVehicleId(vehicleId);
                setSelectedVehicleId(vehicleId || null);
              }}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="">Choose vehicle</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.registration}
                </option>
              ))}
            </select>

            <Button
              size="sm"
              onClick={assignSelectedToVehicle}
              disabled={
                selectedUnassignedCount === 0 ||
                !(bulkVehicleId || selectedVehicleId)
              }
            >
              Send selected to vehicle
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={openAcceptAllPending}
              disabled={
                accepting ||
                jobs.every((job) => job.status !== "pending_acceptance")
              }
            >
              Accept all pending ({
                jobs.filter((job) => job.status === "pending_acceptance").length
              })
            </Button>

            <span className="hidden h-7 w-px bg-line sm:block" aria-hidden />

            <Button
              variant="secondary"
              size="sm"
              onClick={optimize}
              loading={optimizing}
              disabled={
                !selectedVehicleId ||
                selectedLaneJobs.filter(isRoutable).length < 2
              }
            >
              {selectedVehicle
                ? `Smart Optimize ${selectedVehicle.registration}`
                : "Smart Optimize Route"}
            </Button>

            <Button
              size="sm"
              onClick={savePlan}
              loading={saving}
              disabled={!dirty}
            >
              Save plan
            </Button>

            <span className="text-xs text-ink-3">
              {dirty
                ? "Unsaved changes"
                : "Plan saved"}
            </span>

            <span className="basis-full text-xs text-ink-3">
              Drop order: drag cards between positions or use Up / Down.
              Smart Optimize uses each job's final stop to next job's first stop;
              Save plan persists vehicle, driver and drop order.
            </span>
          </section>

          {loading ? (
            <p className="text-sm text-ink-3">Loading the day&apos;s jobs...</p>
          ) : (
            <div className="flex items-start gap-4">
              <UnassignedPool
                jobs={unassigned}
                subcontracted={subcontracted}
                geocodeSettled={geocodeSettled && !geocodeUnavailable}
                displacedNotes={displacedNotes}
                selectedJobIds={selectedUnassignedJobIds}
                onToggleJob={toggleUnassignedSelection}
                onOpenJob={(jobId) =>
                  router.push(`/jobs?job=${encodeURIComponent(jobId)}`)
                }
                onAcceptJob={openAcceptance}
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
                      regimeSummary={
                        laneRegimeByVehicle.get(v.id) ??
                        summarizeLaneRegimes(v, [])
                      }
                      compliance={
                        laneComplianceByVehicle.get(v.id) ??
                        evaluatePlanningCompliance({
                          driver: null,
                          hasPlannedJobs: false,
                          plannedDrivingSeconds: 0,
                          activityDataAvailable: false,
                          today: operatorDayInTimeZone(
                            positionNow,
                            planningTimeZone
                          ),
                        })
                      }
                      geocodeSettled={geocodeSettled && !geocodeUnavailable}
                      driverConflict={driverConflicts.has(v.id)}
                      onSelect={() => {
                        setSelectedVehicleId(v.id);
                        setBulkVehicleId(v.id);
                      }}
                      onDriverChange={(driverId) =>
                        setLaneDrivers((prev) => ({ ...prev, [v.id]: driverId }))
                      }
                      onOpenJob={(jobId) =>
                        router.push(`/jobs?job=${encodeURIComponent(jobId)}`)
                      }
                      onAcceptJob={openAcceptance}
                      onMoveJob={(jobId, offset) =>
                        moveLaneJob(jobId, v.id, offset)
                      }
                      onDropJob={(jobId, beforeJobId) =>
                        moveJob(jobId, v.id, beforeJobId)
                      }
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {acceptanceTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="planning-acceptance-title"
          onClick={cancelAcceptance}
        >
          <form
            className="w-full max-w-lg rounded-lg border border-line bg-surface p-5 shadow-xl"
            onSubmit={(e) => {
              e.preventDefault();
              void confirmAcceptance();
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <h2
                id="planning-acceptance-title"
                className="text-lg font-semibold text-ink"
              >
                {acceptanceTarget.jobs.length === 1
                  ? "Accept job"
                  : `Accept ${acceptanceTarget.jobs.length} jobs`}
              </h2>
              <p className="mt-1 text-sm text-ink-3">
                {acceptanceTarget.jobs.length === 1
                  ? acceptanceTarget.jobs[0].reference ??
                    acceptanceTarget.jobs[0].id
                  : "The ETA and acceptance note below will be applied to all pending jobs."}
              </p>
            </div>

            <div className="grid gap-4">
              <label className="grid gap-1 text-sm text-ink">
                <span>Collection ETA *</span>
                <input
                  type="datetime-local"
                  required
                  value={acceptanceForm.collection_eta}
                  onChange={(e) =>
                    setAcceptanceForm((prev) => ({
                      ...prev,
                      collection_eta: e.target.value,
                    }))
                  }
                  className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
                />
              </label>

              <label className="grid gap-1 text-sm text-ink">
                <span>Delivery ETA</span>
                <input
                  type="datetime-local"
                  value={acceptanceForm.delivery_eta}
                  onChange={(e) =>
                    setAcceptanceForm((prev) => ({
                      ...prev,
                      delivery_eta: e.target.value,
                    }))
                  }
                  className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
                />
              </label>

              <label className="grid gap-1 text-sm text-ink">
                <span>Acceptance note</span>
                <textarea
                  rows={3}
                  value={acceptanceForm.acceptance_note}
                  onChange={(e) =>
                    setAcceptanceForm((prev) => ({
                      ...prev,
                      acceptance_note: e.target.value,
                    }))
                  }
                  className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={accepting}
                onClick={cancelAcceptance}
                className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={accepting}
                className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50"
              >
                {accepting
                  ? "Accepting..."
                  : acceptanceTarget.jobs.length === 1
                    ? "Accept job"
                    : `Accept ${acceptanceTarget.jobs.length} jobs`}
              </button>
            </div>
          </form>
        </div>
      ) : null}

    </TenantGate>
  );
}
