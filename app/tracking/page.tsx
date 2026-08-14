"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import TrackingRail from "./TrackingRail";
import TrackingHeader from "./TrackingHeader";
import TrackingMap from "./TrackingMap";
import JourneyTimeline from "./JourneyTimeline";
import ActivityFeed from "./ActivityFeed";
import { buildRail, jobPhase, localDay } from "../../lib/tracking/onTheRoad";
import { buildJourney } from "../../lib/tracking/journey";
import { buildActivity } from "../../lib/tracking/activity";
import { createSupabasePositionSource } from "../../lib/tracking/supabasePositions";
import { pingLabel, type PositionReading } from "../../lib/tracking/position";
import type { TrackingJob } from "../../lib/tracking/types";
import { OPERATOR_TIME_ZONE } from "../../lib/time";

/* The old page polled every 10 seconds and fetched every vehicle_locations row
   ever recorded on each pass. 30 seconds matches the design's own footnote, and
   the poll pauses while the tab is hidden so a forgotten background tab stops
   issuing queries against a live database. */
const POLL_MS = 30_000;

/* Supabase returns an embedded relation as an object or as a one-element array
   depending on how it infers the relationship. Both shapes have appeared in
   this codebase, so this normalises rather than assuming. */
function rel(value: any): any {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

// Same operator calendar as the journey timeline and /pod. See lib/time.ts.
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: OPERATOR_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
});

export default function TrackingPage() {
  const supabase = createClient();
  const tenant = useTenant();

  const [jobs, setJobs] = useState<TrackingJob[]>([]);
  const [positions, setPositions] = useState<Map<string, PositionReading>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // `cancelled` guards against setting state after the tenant changes or the
    // page unmounts mid-request. The old page had no such guard.
    let cancelled = false;

    async function load(showSkeleton: boolean) {
      if (showSkeleton) setLoading(true);

      /* createSupabasePositionSource THROWS on a query error rather than
         returning an empty map, and load() is called unawaited from both the
         first render and the interval. Without this catch that rejection
         escapes the effect entirely: nothing clears `loading`, so a failed
         position query leaves the skeleton on screen forever with no retry.
         Catching here is what turns a throw into the error state. */
      try {
        const today = localDay(new Date());

        /* Narrowed server-side on the three cheap conditions before
           isOnTheRoad applies the rest client-side. The stop-level condition
           cannot be expressed here, which is why the predicate still runs. */
        const { data, error } = await tenant
          .filterByTenant(
            supabase.from("jobs").select(`
              id,
              reference,
              status,
              scheduled_date,
              created_at,
              vehicle_id,
              subcontractor_id,
              customers ( name ),
              vehicles ( registration ),
              drivers ( name, phone ),
              job_stops (
                id, stop_order, type, address_line, city, postcode,
                planned_at, delivered_at, pod_status, recipient_name,
                pod_updated_at, pod_photo_url, pod_document_url
              )
            `),
          )
          .eq("status", "planned")
          .not("vehicle_id", "is", null)
          .lte("scheduled_date", today);

        if (cancelled) return;

        if (error) {
          setLoadFailed(true);
          setLoading(false);
          return;
        }

        const mapped: TrackingJob[] = (data ?? []).map((row: any) => {
          const vehicle = rel(row.vehicles);
          const driver = rel(row.drivers);
          return {
            id: row.id,
            reference: row.reference,
            status: row.status,
            scheduled_date: row.scheduled_date,
            created_at: row.created_at,
            customer_name: rel(row.customers)?.name ?? null,
            vehicle_id: row.vehicle_id,
            vehicle_registration: vehicle?.registration ?? null,
            driver_name: driver?.name ?? null,
            driver_phone: driver?.phone ?? null,
            subcontractor_id: row.subcontractor_id,
            stops: [...(row.job_stops ?? [])].sort(
              (a: any, b: any) => a.stop_order - b.stop_order,
            ),
          };
        });

        const now = new Date();
        const vehicleIds = Array.from(
          new Set(
            buildRail(mapped, now)
              .map((r) => mapped.find((j) => j.id === r.jobId)?.vehicle_id)
              .filter((id): id is string => Boolean(id)),
          ),
        );

        const source = createSupabasePositionSource(supabase, tenant);
        const readings = await source.getPositions(vehicleIds);

        if (cancelled) return;

        setJobs(mapped);
        setPositions(readings);
        setLoadFailed(false);
        setLoading(false);
        setLastLoadedAt(new Date());
      } catch {
        if (cancelled) return;
        setLoadFailed(true);
        setLoading(false);
      }
    }

    load(true);

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, POLL_MS);

    function onVisibility() {
      if (document.visibilityState === "visible") load(false);
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tenant.activeTenantId, reloadToken]);

  // One `now` per load, injected into every pure function, so the rail order,
  // the phase badge and the staleness pill cannot disagree by milliseconds
  // about what "today" or "stale" means. Same reasoning as app/pod/page.tsx.
  const now = useMemo(() => new Date(), [jobs]);

  const rail = useMemo(() => buildRail(jobs, now), [jobs, now]);

  // Falling back to the first row means a fresh load, or a poll that removes
  // the selected job, always leaves something selected rather than blanking
  // the detail column.
  const selected = useMemo(
    () => rail.find((r) => r.jobId === selectedId) ?? rail[0] ?? null,
    [rail, selectedId],
  );

  const selectedJob = useMemo(
    () => (selected ? jobs.find((j) => j.id === selected.jobId) ?? null : null),
    [jobs, selected],
  );

  const reading = selectedJob?.vehicle_id ? positions.get(selectedJob.vehicle_id) ?? null : null;

  const journey = useMemo(
    () => (selectedJob ? buildJourney(selectedJob.stops, reading, now) : []),
    [selectedJob, reading, now],
  );

  const activity = useMemo(
    () => (selectedJob ? buildActivity(selectedJob) : []),
    [selectedJob],
  );

  const footNote = lastLoadedAt
    ? `Auto-refresh 30 s · updated ${CLOCK.format(lastLoadedAt)}`
    : "Auto-refresh 30 s";

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <div className="text-kicker uppercase text-ink-3">Tracking</div>
          <h1 className="mb-4 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Jobs on the road
          </h1>

          {loading ? (
            <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
              <p className="text-sm text-ink-3">Loading jobs…</p>
            </div>
          ) : loadFailed ? (
            <div className="rounded-lg border border-danger-border bg-danger-tint p-6 shadow-sm">
              <p className="text-sm font-semibold text-danger-strong">Could not load tracking</p>
              <p className="mt-1 text-sm text-ink-2">
                The jobs query failed. Nothing has been changed.
              </p>
              <button
                type="button"
                onClick={() => setReloadToken((t) => t + 1)}
                className="mt-3 rounded-sm border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-line-strong hover:bg-surface-2"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
              <div className="max-h-[40vh] overflow-y-auto xl:max-h-none xl:overflow-visible">
                <TrackingRail
                  rows={rail}
                  selectedJobId={selected?.jobId ?? null}
                  onSelect={setSelectedId}
                  footNote={footNote}
                />
              </div>

              <div className="grid min-w-0 gap-3">
                {selectedJob && selected ? (
                  <>
                    <TrackingHeader
                      job={selectedJob}
                      phase={jobPhase(selectedJob, now)}
                      journey={journey}
                      reading={reading}
                      now={now}
                    />
                    <TrackingMap stops={selectedJob.stops} reading={reading} now={now} />
                    <JourneyTimeline
                      nodes={journey}
                      note={reading ? `Position ${pingLabel(reading, now)}` : "No position reported"}
                    />
                    <ActivityFeed events={activity} />
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-surface px-6 py-16 text-center shadow-sm">
                    <p className="text-md font-semibold text-ink">No jobs on the road</p>
                    <p className="max-w-[46ch] text-sm text-ink-2">
                      Assigned jobs appear here once they are due and still have a delivery
                      outstanding.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </TenantGate>
  );
}
