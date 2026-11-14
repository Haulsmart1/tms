"use client";

import SevenDayPlanEditor from "./SevenDayPlanEditor";
import type { SevenDayPlanEditorDraft } from "../../lib/planning/sevenDayPlanEditor";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Button from "../../components/Button";
import MessageBanner from "../../components/MessageBanner";
import PlanningMap, { type MapMarker } from "./PlanningMap";
import UnassignedPool from "./UnassignedPool";
import VehicleLane from "./VehicleLane";
import type { CollectionFailure, CollectionFailureUndo, PlanSignOff } from "./PlanJobCard";
import { useVehicleLayout } from "./useVehicleLayout";
import Link from "next/link";
import JobDetailDialog from "./JobDetailDialog";
import { warehousePlanningHref, readPlanningReturnContext, type PlanningReturnContext } from "../../lib/planning/navigation";
import { draftAssignment } from "../../lib/planning/jobDetail";
import { stopsNeedingGeocode } from "../../lib/planning/geocoding";
import { computeSaveDiff, type LanePlan } from "../../lib/planning/saveDiff";
import { loadPlanningBoardJobs, savedPlanBoardReady } from "../../lib/planning/boardJobs";
import {
  createSavedPlanSnapshot,
  savedPlanSnapshotToPendingItineraries,
  type SavedPlanSummary,
} from "../../lib/planning/savedPlan";
import {
  createSavedPlan,
  deleteSavedPlan,
  duplicateSavedPlan,
  listSavedPlans,
  loadSavedPlan,
  moveSavedPlanToNextDay,
  renameSavedPlan,
  updateSavedPlanSnapshot,
  type LoadedSavedPlan,
} from "../../lib/planning/savedPlanStore";
import {
  createPlanningDraft,
  parsePlanningDraft,
  planningDraftBaseline,
  planningDraftIsStale,
  planningDraftMatchesPlan,
  planningDraftStorageKey,
  type PlanningDraft,
} from "../../lib/planning/draftCache";
import {
  buildPlanningSavePlan,
  savePlanningAssignments,
  classifyPlanningSaveError,
  PLANNING_ASSIGNMENT_BLOCKED_MESSAGE,
  PLANNING_SAVE_BLOCKED_MESSAGES,
  PLANNING_SAVE_ERROR_MESSAGES,
  planningSaveErrorMessage,
  type PlanningSaveErrorKind,
} from "../../lib/planning/planningSave";
import { isUnlicensedVehicleError } from "../../lib/billing/unlicensedVehicle";
import {
  autosaveDelay,
  recordAutosaveFailure,
  type AutosaveFailure,
} from "../../lib/planning/autosave";
import { loadCompanyTimeZone } from "../../lib/planning/companyTimeZone";
import {
  assignJobsToLane,
  moveJobInLane,
} from "../../lib/planning/boardActions";
import { formatDistance, formatDuration } from "../../lib/planning/format";
import {
  isRoutable,
  jobRepresentativePoint,
} from "../../lib/planning/waypoints";
import {
  buildFastPlotVisits,
  jobsInFastPlotOrder,
  optimizeFastPlotOrderFromStart,
} from "../../lib/planning/fastPlot";
import { buildPlanningPhysicalItinerary } from "../../lib/planning/physicalItinerary";
import {
  buildPlanningDriverHoursState,
  planningDriverHoursBoundaries,
  planningHoursInstant,
  planningStartForLocalDate,
  planningStartIssue,
  PLANNING_DRIVER_ACTIVITY_ROW_LIMIT,
  type PlanningDriverActivityRow,
} from "../../lib/planning/planningDriverActivity";
import type { DriverHoursState } from "../../lib/planning/driverHoursState";
import {
  buildPlanningDriverSchedulePreview,
  type PlanningDriverSchedulePreview,
} from "../../lib/planning/planningDriverSchedule";
import {
  buildPlanningDropMarkers,
  buildPlanningDropNumbersByJobId,
} from "../../lib/planning/dropPresentation";
import {
  buildPlanningItineraryRpcVisits,
  parsePersistedPlanningItineraries,
  type PendingPlanningItinerary,
  type PersistedPlanningItinerary,
} from "../../lib/planning/itineraryPersistence";
import {
  MAX_PLANNING_ROUTE_JOBS,
  mergeRouteResults,
  splitRoutePoints,
  wouldExceedPlanningRouteJobLimit,
} from "../../lib/planning/routeChunks";
import type { PlanJob, RouteResult } from "../../lib/planning/types";
import {
  createBudgetedFastPlotCostLoader,
  loadCachedFastPlotCosts,
  loadPointToPointTravelSeconds,
} from "../../lib/planning/tomtomCostClient";
import { createSupabasePositionSource } from "../../lib/tracking/supabasePositions";
import type { PositionReading } from "../../lib/tracking/position";
import {
  evaluatePlanningCompliance,
  PLANNING_CHECKS_NOT_PERFORMED,
  type PlanningCompliance,
  type PlanningComplianceDriver,
} from "../../lib/planning/compliance";
import type { ComplianceVehicleFacts } from "../../lib/planning/regime";
import {
  summarizeLaneRegimes,
  type LaneRegimeSummary,
} from "../../lib/planning/laneRegime";
import {
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
type Driver = PlanningComplianceDriver & {
  planning_profile: "day" | "tramper";
  normal_start_time: string | null;
};

/* The geocode endpoint caps a batch at 100 stop ids and rejects anything
   larger with a 400 (it does not truncate), so the client chunks. */
const GEOCODE_BATCH = 100;
const POSITION_POLL_MS = 30_000;
/* How often today's driver-hours state is re-evaluated against "now". */
const HOURS_REFRESH_MS = 5 * 60_000;

export default function PlanningPage() {
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
  const [timeZoneNote, setTimeZoneNote] = useState<string | null>(null);
  /* Planning edits exactly one tenant. With admin "All tenants" active the
     board is read-only, so a lane can never mix tenants and Save never writes
     jobs before failing on a missing tenant (review PLAN-8). */
  const planningTenantId =
    tenant.status === "ready" &&
    typeof tenant.activeTenantId === "string" &&
    tenant.activeTenantId.length > 0
      ? tenant.activeTenantId
      : null;
  /* Autosave failure for the current snapshot of unsaved work (PLAN-7). */
  const [autosaveFailure, setAutosaveFailure] =
    useState<AutosaveFailure | null>(null);
  /* Set when the server refused a save because newer changes exist (PLAN-11). */
  const [saveConflict, setSaveConflict] = useState(false);
  /* Bumped after each successful save so autosave re-checks for edits made
     while that save was in flight. */
  const [saveRound, setSaveRound] = useState(0);
  const [jobs, setJobs] = useState<PlanJob[]>([]);
  const [completedJobs, setCompletedJobs] = useState<PlanJob[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [positions, setPositions] = useState<Map<string, PositionReading>>(
    new Map()
  );
  const [positionNow, setPositionNow] = useState(() => new Date());
  const [laneOrders, setLaneOrders] = useState<Record<string, string[]>>({});
  const [preserveLaneDrivers, setPreserveLaneDrivers] = useState<Set<string>>(new Set());
  const [laneDrivers, setLaneDrivers] = useState<Record<string, string | null>>({});
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [bulkVehicleId, setBulkVehicleId] = useState("");
  const [selectedUnassignedJobIds, setSelectedUnassignedJobIds] = useState<Set<string>>(
    new Set()
  );
  const [routes, setRoutes] = useState<Record<string, RouteResult>>({});
  const [driverHoursById, setDriverHoursById] = useState<
    Record<string, DriverHoursState | null>
  >({});
  const [selectedDriverSchedule, setSelectedDriverSchedule] =
    useState<PlanningDriverSchedulePreview | null>(null);
  const [driverScheduleNotice, setDriverScheduleNotice] =
    useState<string | null>(null);
  const [driverScheduleLoading, setDriverScheduleLoading] =
    useState(false);
  /* Assumptions behind the preview the planner must see (PLAN-2, PLAN-24). */
  const [driverScheduleNotes, setDriverScheduleNotes] =
    useState<string[]>([]);
  const [hoursClock, setHoursClock] = useState(() => Date.now());
  const [pendingItineraries, setPendingItineraries] = useState<
    Record<string, PendingPlanningItinerary>
  >({});
  const [itineraryInvalidations, setItineraryInvalidations] = useState<
    Set<string>
  >(new Set());
  const [persistedItineraries, setPersistedItineraries] = useState<
    Record<string, PersistedPlanningItinerary>
  >({});
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
  const [savedPlans, setSavedPlans] = useState<SavedPlanSummary[]>([]);
  const [savedPlansLoading, setSavedPlansLoading] = useState(false);
  const [savedPlanBusy, setSavedPlanBusy] = useState(false);
  const [savedPlanName, setSavedPlanName] = useState("");
  const [editorDrafts, setEditorDrafts] = useState<Record<string, SevenDayPlanEditorDraft>>({});
  const [stagedSavedPlan, setStagedSavedPlan] =
    useState<LoadedSavedPlan | null>(null);
  const stagedPlanMoved = stagedSavedPlan !== null && savedPlans.some((plan) =>
    plan.id === stagedSavedPlan.id && plan.planningDate !== stagedSavedPlan.planningDate
  );
  const [returnContext, setReturnContext] = useState<PlanningReturnContext | null>(null);
  const restoredReturnPlan = useRef<string | null>(null);
  const pendingSavedPlanOpen = useRef<LoadedSavedPlan | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "pending" | "saving" | "saved" | "local-only"
  >("idle");
  const [recoveryDraft, setRecoveryDraft] = useState<PlanningDraft | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
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
  /* Why the last drop or bulk assign was refused, shown beside the board.
     Cleared by the next accepted assignment and by every board load, which
     is what a tenant change triggers. */
  const [assignmentRefusal, setAssignmentRefusal] = useState<string | null>(
    null
  );
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  /* Generation counter: each load claims the next value, and its predicate
     checks whether a newer load (or unmount) has since claimed a later one.
     Replaces a single-flag "cancelled" boolean so a save-triggered reload can
     itself be superseded by a later load, not just by unmount. */
  const loadSeq = useRef(0);
  const saveInFlight = useRef(false);
  /* Lets the planner stop a long Smart Optimize run (PLAN-12). */
  const optimizeAbort = useRef<AbortController | null>(null);
  const latestPendingUpdatesJson = useRef("[]");
  const loadedPlanningScope = useRef<string | null>(null);
  const canonicalGeneration = useRef(0);
  const canonicalMutationGeneration = useRef<Record<string, number>>({});

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const detailJobById = useMemo(() => new Map([...jobs, ...completedJobs].map((j) => [j.id, j])), [jobs, completedJobs]);
  const completedByVehicle = useMemo(() => {
    const grouped = new Map<string, PlanJob[]>();
    for (const job of completedJobs) {
      if (!job.vehicle_id || job.subcontractor_id) continue;
      const lane = grouped.get(job.vehicle_id) ?? [];
      lane.push(job);
      grouped.set(job.vehicle_id, lane);
    }
    return grouped;
  }, [completedJobs]);

  /* A reload can drop the open job (moved to another day, deleted elsewhere);
     an empty dialog would otherwise linger over the board. */
  useEffect(() => {
    if (detailJobId && !detailJobById.has(detailJobId)) setDetailJobId(null);
  }, [detailJobId, detailJobById]);

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

  const vehicleLayout = useVehicleLayout(vehicles,
    `${planningTenantId ?? "all"}:${date}:${stagedSavedPlan?.id ?? "live"}`,
    stagedSavedPlan?.snapshot.lanes.map(lane => lane.vehicleId) ?? []);
  const displayVehicles = vehicleLayout.vehicles;
  const warehouseHref = planningTenantId ? warehousePlanningHref({
    tenantId: planningTenantId, date, planId: stagedSavedPlan?.id ?? null, vehicleId: selectedVehicleId,
  }) : null;

  const lanePlans: LanePlan[] = useMemo(
    () =>
      vehicles.map((v) => ({
        vehicleId: v.id,
        driverId: laneDrivers[v.id] ?? null,
        jobIds: laneOrders[v.id] ?? [],
        preserveJobDrivers: preserveLaneDrivers.has(v.id),
      })),
    [vehicles, laneOrders, laneDrivers, preserveLaneDrivers]
  );
  const pendingUpdates = useMemo(
    () => computeSaveDiff(jobs, lanePlans, unassigned.map((j) => j.id), date),
    [jobs, lanePlans, unassigned, date]
  );
  const pendingUpdatesJson = useMemo(() => JSON.stringify(pendingUpdates), [pendingUpdates]);
  /* Dirty means "differs from what the load itself produced", not "non-empty".
     Save still writes pendingUpdates in full, normalisation included: by the
     time the button is enabled the user has made a deliberate edit. */
  const dirty = pendingUpdatesJson !== baselineDiff;
  const hasCanonicalWork =
    Object.keys(pendingItineraries).length > 0 ||
    itineraryInvalidations.size > 0;
  const hasUnsavedWork = dirty || hasCanonicalWork;
  latestPendingUpdatesJson.current = pendingUpdatesJson;
  /* Identifies the unsaved work an autosave failure belongs to. Any edit
     (assignment, order, driver, optimize, invalidation) changes it, which is
     what resumes autosave after it stopped (PLAN-7). */
  const autosaveSnapshot = [
    pendingUpdatesJson,
    [...itineraryInvalidations].sort().join(","),
    Object.keys(pendingItineraries).sort().join(","),
    String(canonicalGeneration.current),
  ].join("|");
  /* Server assignments the local draft is written against (PLAN-11). Keyed
     as a string so geocoding updates to jobs do not reset the autosave timer. */
  const draftBaseline = useMemo(() => planningDraftBaseline(jobs), [jobs]);
  const draftBaselineKey = JSON.stringify(draftBaseline);

  async function loadData(isCancelled: () => boolean) {
    // Guard lives here, not in the effect: see TenantContextValue in lib/tenant/context.ts
    if (tenant.status !== "ready") return;

    loadedPlanningScope.current = null;
    if (!pendingSavedPlanOpen.current) {
      setStagedSavedPlan(null);
    }
    setRecoveryDraft(null);
    setSaveStatus("idle");
    setLoading(true);
    setMessage("");
    setGeocodeSettled(false);
    setGeocodeUnavailable(false);
    setRoutes({});
    setPendingItineraries({});
    setItineraryInvalidations(new Set());
    setPersistedItineraries({});
    canonicalMutationGeneration.current = {};
    setPlanningTimeZone(OPERATOR_TIME_ZONE);
    setTimeZoneNote(null);
    setAutosaveFailure(null);
    setSaveConflict(false);
    setAssignmentRefusal(null);

    /* company_profiles is keyed by company id, so the zone is resolved through
       tenants.company_id rather than filterByTenant, validated, and never
       aborts the load. A super_admin on "All" spanning several companies gets
       the operator default with a note instead of a multi-row error
       (review PLAN-10). */
    const timeZonePromise = loadCompanyTimeZone(
      supabase,
      tenant.activeTenantId
        ? [tenant.activeTenantId]
        : tenant.tenants.map((option) => option.id)
    );

    const resolvedTimeZone = await timeZonePromise;
    const savedPlan = pendingSavedPlanOpen.current;
    const { data: jobsData, completedData, error: jobsError } = await load…24029 tokens truncated…    size="sm"
                    onClick={discardRecoveryDraft}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            ) : null}

            <span className="basis-full text-xs text-ink-3">
              Drop order: drag cards between positions or use Up / Down.
              Fast Plot maps unique collections first, then unique deliveries,
              and TomTom optimizes up to 10 matrix points with shared endpoints anchored. Smart Optimize changes
              job order; autosave persists vehicle, driver and drop order. Save plan remains available as a manual fallback.
            </span>
          </section>

          {planningTenantId ? (
            <section
              aria-label="Saved plans"
              className="rounded-lg border border-line bg-surface p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="mr-2 text-sm font-semibold">Saved Plans</h2>

                <input
                  type="text"
                  value={savedPlanName}
                  onChange={(event) => setSavedPlanName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveNamedPlan();
                  }}
                  maxLength={120}
                  placeholder="Plan name"
                  aria-label="Saved plan name"
                  className="min-h-11 min-w-0 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink sm:w-auto sm:min-w-52"
                />

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void saveNamedPlan()}
                  loading={savedPlanBusy}
                  disabled={savedPlanBusy || !savedPlanName.trim()}
                >
                  Save As
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void refreshSavedPlans()}
                  disabled={savedPlansLoading || savedPlanBusy}
                >
                  Refresh
                </Button>
              </div>

              <div className="mt-3 overflow-x-auto">
                {savedPlansLoading ? (
                  <p className="text-sm text-ink-3">
                    Loading saved plans...
                  </p>
                ) : savedPlans.length === 0 ? (
                  <p className="text-sm text-ink-3">
                    No saved plans yet.
                  </p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs text-ink-3">
                        <th className="px-2 py-1.5 font-medium">Name</th>
                        <th className="px-2 py-1.5 font-medium">Date</th>
                        <th className="px-2 py-1.5 font-medium">Updated</th>
                        <th className="px-2 py-1.5 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedPlans.map((plan) => (
                        <tr
                          key={plan.id}
                          className="border-b border-line last:border-b-0"
                        >
                          <td className="px-2 py-2 font-medium text-ink">
                            {plan.name}
                          </td>
                          <td className="px-2 py-2 text-ink-2">
                            {plan.planningDate}
                          </td>
                          <td className="px-2 py-2 text-ink-2">
                            {new Date(plan.updatedAt).toLocaleString()}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void openNamedPlan(plan.id)}
                                disabled={savedPlanBusy}
                              >
                                Open
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void renameNamedPlan(plan)}
                                disabled={savedPlanBusy}
                              >
                                Rename
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void duplicateNamedPlan(plan)}
                                disabled={savedPlanBusy}
                              >
                                Duplicate
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void moveNamedPlanToNextDay(plan)}
                                disabled={savedPlanBusy || saving || loading}
                              >
                                Move to next day
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void deleteNamedPlan(plan)}
                                disabled={savedPlanBusy}
                              >
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          ) : null}
          {/* Always mounted (live region); see components/MessageBanner.tsx.
              Sits directly above the pool and lanes so a refused drop is
              explained where it happened, not only in the page header. */}
          <MessageBanner tone="warning" className="mb-0">
            {assignmentRefusal}
          </MessageBanner>

          {loading ? (
            <p className="text-sm text-ink-3">Loading the day&apos;s jobs...</p>
          ) : (
            <div className="flex min-w-0 w-full flex-col items-start gap-4 lg:flex-row">
              <UnassignedPool
                jobs={unassigned}
                subcontracted={subcontracted}
                geocodeSettled={geocodeSettled && !geocodeUnavailable}
                displacedNotes={displacedNotes}
                selectedJobIds={selectedUnassignedJobIds}
                onToggleJob={toggleUnassignedSelection}
                onOpenJob={setDetailJobId}
                onAcceptJob={openAcceptance}
                onDropJob={(jobId) => moveJob(jobId, null, null)}
              />
              <div className="flex min-w-0 w-full flex-1 flex-col gap-3">
                {selectedVehicle && (
                  <p className="text-sm font-semibold text-ink">
                    Route map · {selectedVehicle.registration}
                  </p>
                )}
                <PlanningMap
                  markers={markers}
                  route={selectedRoute}
                  notice={mapNotice}
                  reading={selectedVehicleReading}
                  now={positionNow}
                />

                {selectedVehicleId ? (
                  <section
                    aria-label="Driver hours schedule"
                    className="rounded-lg border border-line bg-surface p-3 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-ink">
                        Driver-hours schedule
                      </h2>

                      {selectedDriverSchedule ? (
                        <span className="text-xs font-medium uppercase tracking-wide text-warning">
                          {selectedDriverSchedule.schedule.status ===
                          "unschedulable"
                            ? "Unschedulable"
                            : "Review required"}
                        </span>
                      ) : null}
                    </div>

                    {driverScheduleLoading ? (
                      <p className="mt-2 text-sm text-ink-3">
                        Calculating canonical travel and driver hours...
                      </p>
                    ) : selectedDriverSchedule ? (
                      <>
                        <p className="mt-2 text-xs text-ink-3">
                          Advisory planning only. The rule profile is deliberately
                          unverified, so this does not assert legal compliance.
                          It places 45 min breaks and a daily rest when 9 h of
                          driving would be passed; loading and service time never
                          trigger a break or rest. {PLANNING_CHECKS_NOT_PERFORMED}
                        </p>

                        {driverScheduleNotes.length > 0 ? (
                          <div className="mt-2 space-y-1 text-xs text-ink-2">
                            {driverScheduleNotes.map((note) => (
                              <p key={note}>{note}</p>
                            ))}
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
                          <span>
                            Driving{" "}
                            {formatDuration(
                              selectedDriverSchedule.schedule.events
                                .filter(
                                  (event) =>
                                    event.kind === "drive" ||
                                    event.kind === "return_to_base"
                                )
                                .reduce(
                                  (total, event) =>
                                    total + event.durationSeconds,
                                  0
                                )
                            )}
                          </span>

                          <span>
                            Service{" "}
                            {formatDuration(
                              selectedDriverSchedule.schedule.events
                                .filter(
                                  (event) => event.kind === "service"
                                )
                                .reduce(
                                  (total, event) =>
                                    total + event.durationSeconds,
                                  0
                                )
                            )}
                          </span>

                          <span>
                            Breaks{" "}
                            {
                              selectedDriverSchedule.schedule.events.filter(
                                (event) => event.kind === "break"
                              ).length
                            }
                          </span>

                          <span>
                            Daily rests{" "}
                            {
                              selectedDriverSchedule.schedule.events.filter(
                                (event) => event.kind === "daily_rest"
                              ).length
                            }
                          </span>
                        </div>

                        {selectedDriverSchedule.schedule.warnings.length > 0 ? (
                          <div className="mt-3 space-y-1 text-xs text-warning">
                            {selectedDriverSchedule.schedule.warnings.map(
                              (warning) => (
                                <p key={warning}>{warning}</p>
                              )
                            )}
                          </div>
                        ) : null}

                        <SevenDayPlanEditor
                          key={`${selectedVehicleId}:${date}:${laneDrivers[selectedVehicleId] ?? ""}:${planningTimeZone}`}
                          jobs={jobs}
                          readOnly={!planningTenantId}
                          preview={selectedDriverSchedule}
                          planningDate={date}
                          driverId={laneDrivers[selectedVehicleId] ?? null}
                          timeZone={planningTimeZone}
                          serviceStops={(pendingItineraries[selectedVehicleId] ?? persistedItineraries[selectedVehicleId])?.serviceStops ?? []}
                          draft={editorDrafts[selectedVehicleId]}
                          onInspect={setDetailJobId}
                          onChange={(next) => {
                            const updated = { ...editorDrafts };
                            if (next) updated[selectedVehicleId] = next;
                            else delete updated[selectedVehicleId];
                            if (!next && !hasUnsavedWork && !Object.values(updated).some((value) => value.edited) && planningTenantId) {
                              try { window.localStorage.removeItem(planningDraftStorageKey(planningTenantId, date)); } catch { /* Local storage may be unavailable. */ }
                            }
                            setEditorDrafts(updated);
                          }}
                        />
                        <div className="mt-3 max-h-64 overflow-auto rounded-md border border-line">
                          <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-surface">
                              <tr className="border-b border-line text-ink-3">
                                <th className="px-2 py-1.5 font-medium">
                                  Drop
                                </th>
                                <th className="px-2 py-1.5 font-medium">
                                  ETA
                                </th>
                                <th className="px-2 py-1.5 font-medium">
                                  Service complete
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedDriverSchedule.dropEtas.map((drop) => {
                                const eta = new Date(
                                  selectedDriverSchedule.planningStart.getTime() +
                                    drop.serviceStartSeconds * 1000
                                );

                                const complete = new Date(
                                  selectedDriverSchedule.planningStart.getTime() +
                                    drop.serviceEndSeconds * 1000
                                );

                                const formatter = new Intl.DateTimeFormat(
                                  "en-GB",
                                  {
                                    timeZone: planningTimeZone,
                                    weekday: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                );

                                return (
                                  <tr
                                    key={`${drop.dropNumber}:${drop.stopId}`}
                                    className="border-b border-line last:border-b-0"
                                  >
                                    <td className="px-2 py-1.5 font-medium text-ink">
                                      {drop.dropNumber}
                                    </td>
                                    <td className="px-2 py-1.5 text-ink-2">
                                      {formatter.format(eta)}
                                    </td>
                                    <td className="px-2 py-1.5 text-ink-2">
                                      {formatter.format(complete)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : driverScheduleNotice ? (
                      <p className="mt-2 text-sm text-ink-3">
                        {driverScheduleNotice}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-ink-3">
                        Select a canonical route to calculate driver hours.
                      </p>
                    )}
                  </section>
                ) : null}

                <div className="flex flex-wrap items-center gap-2" aria-label="Vehicle display controls">
                  <Button size="sm" variant="secondary" onClick={() => vehicleLayout.collapseAll(true)}>Collapse all vehicles</Button>
                  <Button size="sm" variant="secondary" onClick={() => vehicleLayout.collapseAll(false)}>Expand all vehicles</Button>
                  {warehouseHref && <Link href={warehouseHref} target="_blank" rel="noopener" prefetch={false}
                    className="min-h-11 rounded-md border border-primary bg-primary px-3 py-2 text-sm font-semibold text-white">
                    Scan barcode / Warehouse mode ↗
                  </Link>}
                  <span className="text-xs text-ink-3">Warehouse opens in a new tab. Use Update saved to share the vehicle order.</span>
                </div>

                {vehicles.length === 0 ? (
                  <p className="text-sm text-ink-3">No active vehicles. Add one under Fleet.</p>
                ) : (
                  displayVehicles.map((v, vehicleIndex) => (
                    <VehicleLane
                      key={`${v.id}:${date}:${planningTenantId}`}
                      planningDate={date}
                      emailEnabled={Boolean(planningTenantId)}
                      vehicle={v}
                      collapsed={vehicleLayout.collapsed.has(v.id)}
                      onToggleCollapsed={() => vehicleLayout.toggle(v.id)}
                      onMoveVehicle={(offset) => vehicleLayout.move(v.id, offset)}
                      canMoveVehicleUp={vehicleIndex > 0}
                      canMoveVehicleDown={vehicleIndex < displayVehicles.length - 1}
                      jobs={(laneOrders[v.id] ?? [])
                        .map((id) => jobById.get(id))
                        .filter((j): j is PlanJob => Boolean(j))}
                      completedJobs={completedByVehicle.get(v.id) ?? []}
                      canonicalDropNumbersByJobId={
                        pendingItineraries[v.id] ?? persistedItineraries[v.id]
                          ? buildPlanningDropNumbersByJobId(
                              (
                                pendingItineraries[v.id] ??
                                persistedItineraries[v.id]
                              ).serviceStops
                            )
                          : undefined
                      }
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
                          driverHours: null,
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
                      onDriverChange={(driverId) => {
                        if (planningReadOnly()) return;
                        invalidateCanonicalVehicles([v.id]);
                        setLaneDrivers((prev) => ({ ...prev, [v.id]: driverId }));
                        setPreserveLaneDrivers(prev => { const next = new Set(prev); next.delete(v.id); return next; });
                        setRoutes((prev) => {
                          const next = { ...prev };
                          delete next[v.id];
                          return next;
                        });
                      }}
                      onOpenJob={setDetailJobId}
                      onAcceptJob={openAcceptance}
                      onSignOff={planningTenantId ? (jobId, action, requestId, failure) =>
                        signOffVanJob(v.id, jobId, action, requestId, failure) : undefined}
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
        </main>
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

        {(() => {
          const detailJob = detailJobId ? detailJobById.get(detailJobId) : undefined;
          if (!detailJob) return null;
          const { vehicleId, driverId } = !jobById.has(detailJob.id)
            ? { vehicleId: detailJob.vehicle_id, driverId: detailJob.driver_id }
            : draftAssignment(
            detailJob.id,
            laneOrders,
            laneDrivers
          );
          const vehicleLabel = vehicleId
            ? (vehicles.find((v) => v.id === vehicleId)?.registration ?? "Unknown")
            : null;
          const driverLabel =
            vehicleId && driverId
              ? (drivers.find((d) => d.id === driverId)?.name ?? "Unknown")
              : null;
          return (
            <JobDetailDialog
              job={detailJob}
              vehicleLabel={vehicleLabel}
              driverLabel={driverLabel}
              timeZone={planningTimeZone}
              planningContext={planningTenantId ? { tenantId: planningTenantId, date,
                planId: stagedSavedPlan?.id || null, vehicleId } : undefined}
              geocodeSettled={geocodeSettled && !geocodeUnavailable}
              onClose={() => setDetailJobId(null)}
              onAccept={(jobId) => {
                setDetailJobId(null);
                openAcceptance(jobId);
              }}
            />
          );
        })()}
      </div>
    </TenantGate>
  );
}
