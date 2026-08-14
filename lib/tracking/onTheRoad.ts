import { operatorDay } from "../time";
import type { TrackingJob, TrackingStop } from "./types";
import type { Tone } from "../../components/Badge";

/* THE SINGLE DEFINITION OF "ON THE ROAD".

   Nothing else in the app may redefine it, the same way lib/pod/overdue.ts
   owns "awaiting POD". If a second page ever needs this list, it imports from
   here rather than writing its own filter.

   The mockup this page is built from filters jobs on statuses called transit,
   loading and late. Those do not exist in this database. Real jobs.status is
   effectively binary: "planned" on create, "completed" once every delivery
   stop is signed off. job_stops.status is written as "planned" at insert and
   never updated by anything. So the rail is derived, and the phase below is
   deliberately coarser than the mockup's. Loading versus moving is a
   distinction only a live position can make. */

export type Phase = "late" | "in_progress" | "due";

export type RailRow = {
  jobId: string;
  reference: string;
  registration: string;
  driverName: string | null;
  originCity: string;
  destinationCity: string;
  scheduledDate: string | null;
  phase: Phase;
};

export const PHASE_LABEL: Record<Phase, string> = {
  late: "Late",
  in_progress: "In progress",
  due: "Due today",
};

/* Typed against Badge's own Tone union rather than a hand copy of it, so that
   renaming a tone in components/Badge.tsx fails the build here instead of
   rendering an undefined class with the suite still green. "info" is the
   primary-tinted tone; there is no tone called "primary". */
export const PHASE_TONE: Record<Phase, Tone> = {
  late: "danger",
  in_progress: "info",
  due: "warning",
};

/* jobs.scheduled_date is a `date` column, so it arrives as "YYYY-MM-DD" with
   no time and no zone. Comparing it against a UTC-formatted today would drop a
   job from the rail every evening in any zone ahead of UTC, so today comes
   from operatorDay in lib/time.ts, which is pinned to the operator's zone and
   therefore gives the same answer on a dispatcher's laptop, on Vercel's UTC
   runtime, and in a test. */
export function isOnTheRoad(job: TrackingJob, now: Date): boolean {
  if (job.status !== "planned") return false;
  if (!job.vehicle_id) return false;
  // A job with no date cannot be shown to be due. Treating undated jobs as due
  // would fill the rail with work nobody scheduled.
  if (!job.scheduled_date) return false;
  // Lexicographic comparison is correct for "YYYY-MM-DD".
  if (job.scheduled_date > operatorDay(now)) return false;

  const deliveries = job.stops.filter((s) => s.type === "delivery");
  if (deliveries.length === 0) return false;
  return deliveries.some((s) => s.pod_status !== "delivered");
}

export function jobPhase(job: TrackingJob, now: Date): Phase {
  // Late is checked first and outranks progress: a job running a day behind is
  // still the thing a dispatcher needs to see, however many stops it has done.
  if (job.scheduled_date && job.scheduled_date < operatorDay(now)) return "late";
  // ANY stop counts, including a collection, deliberately. A job whose goods
  // are collected is under way even before the first drop. Note this is a
  // wider net than isOnTheRoad, which filters to delivery stops: that is
  // intentional, not an oversight.
  const anyDone = job.stops.some((s) => s.pod_status === "delivered");
  return anyDone ? "in_progress" : "due";
}

/* Origin and destination for a job's route. Exported because the rail row and
   the header card both render it, on the same screen at the same time, so two
   copies could only ever disagree visibly. lib/pod/overdue.ts documents the
   same reasoning for "awaiting POD". */
export function routeEndpoints(stops: TrackingStop[]): { origin: string; destination: string } {
  const ordered = [...stops].sort((a, b) => a.stop_order - b.stop_order);
  const collection = ordered.find((s) => s.type === "collection");
  // The LAST delivery, not the first: on a multi-drop job the destination is
  // where it finishes.
  const delivery = [...ordered].reverse().find((s) => s.type === "delivery");

  return {
    origin: collection?.city ?? "—",
    destination: delivery?.city ?? "—",
  };
}

function toRailRow(job: TrackingJob, now: Date): RailRow {
  const { origin, destination } = routeEndpoints(job.stops);

  return {
    jobId: job.id,
    reference: job.reference ?? "—",
    registration: job.vehicle_registration ?? "—",
    driverName: job.driver_name,
    originCity: origin,
    destinationCity: destination,
    scheduledDate: job.scheduled_date,
    phase: jobPhase(job, now),
  };
}

export function buildRail(jobs: TrackingJob[], now: Date): RailRow[] {
  const rows = jobs.filter((j) => isOnTheRoad(j, now)).map((j) => toRailRow(j, now));

  /* Late first, then oldest scheduled date, then reference, then jobId. The
     rail can reshuffle on every 30 second poll otherwise, which moves the row
     under the dispatcher's cursor. */
  rows.sort((a, b) => {
    const lateDiff = Number(b.phase === "late") - Number(a.phase === "late");
    if (lateDiff !== 0) return lateDiff;
    // isOnTheRoad already guarantees a non-null scheduled_date for every job
    // that reaches this sort, so no fallback is needed here. `<`/`>` mirror
    // the comparison isOnTheRoad itself uses on the same "YYYY-MM-DD" shape.
    if (a.scheduledDate! < b.scheduledDate!) return -1;
    if (a.scheduledDate! > b.scheduledDate!) return 1;
    const refDiff = a.reference.localeCompare(b.reference);
    if (refDiff !== 0) return refDiff;
    // reference is free text with no unique constraint, so two jobs can tie on
    // it. jobId is the primary key, which makes the ordering total and stops
    // the rail reshuffling under the cursor between polls.
    return a.jobId.localeCompare(b.jobId);
  });

  return rows;
}
