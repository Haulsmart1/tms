import type { TrackingJob } from "./types";

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

/* Tones are the ones components/Badge.tsx actually defines. "info" is the
   primary-tinted tone; there is no tone called "primary". */
export const PHASE_TONE: Record<Phase, "danger" | "info" | "warning"> = {
  late: "danger",
  in_progress: "info",
  due: "warning",
};

/* jobs.scheduled_date is a `date` column, so it arrives as "YYYY-MM-DD" with
   no time and no zone. Comparing it against a UTC-formatted today would drop a
   job from the rail every evening in any zone ahead of UTC, so today is
   formatted from the LOCAL calendar day. */
export function localDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isOnTheRoad(job: TrackingJob, now: Date): boolean {
  if (job.status !== "planned") return false;
  if (!job.vehicle_id) return false;
  // A job with no date cannot be shown to be due. Treating undated jobs as due
  // would fill the rail with work nobody scheduled.
  if (!job.scheduled_date) return false;
  // Lexicographic comparison is correct for "YYYY-MM-DD".
  if (job.scheduled_date > localDay(now)) return false;

  const deliveries = job.stops.filter((s) => s.type === "delivery");
  if (deliveries.length === 0) return false;
  return deliveries.some((s) => s.pod_status !== "delivered");
}

export function jobPhase(job: TrackingJob, now: Date): Phase {
  // Late is checked first and outranks progress: a job running a day behind is
  // still the thing a dispatcher needs to see, however many stops it has done.
  if (job.scheduled_date && job.scheduled_date < localDay(now)) return "late";
  const anyDone = job.stops.some((s) => s.pod_status === "delivered");
  return anyDone ? "in_progress" : "due";
}

function toRailRow(job: TrackingJob, now: Date): RailRow {
  const ordered = [...job.stops].sort((a, b) => a.stop_order - b.stop_order);
  const collection = ordered.find((s) => s.type === "collection");
  // The LAST delivery, not the first: on a multi-drop job the destination is
  // where it finishes.
  const delivery = [...ordered].reverse().find((s) => s.type === "delivery");

  return {
    jobId: job.id,
    reference: job.reference ?? "—",
    registration: job.vehicle_registration ?? "—",
    driverName: job.driver_name,
    originCity: collection?.city ?? "—",
    destinationCity: delivery?.city ?? "—",
    scheduledDate: job.scheduled_date,
    phase: jobPhase(job, now),
  };
}

export function buildRail(jobs: TrackingJob[], now: Date): RailRow[] {
  const rows = jobs.filter((j) => isOnTheRoad(j, now)).map((j) => toRailRow(j, now));

  /* Late first, then oldest scheduled date, then reference. The reference
     tiebreak is load-bearing rather than cosmetic: without a total order the
     rail can reshuffle on every 30 second poll, which moves the row under the
     dispatcher's cursor. */
  rows.sort((a, b) => {
    const lateDiff = Number(b.phase === "late") - Number(a.phase === "late");
    if (lateDiff !== 0) return lateDiff;
    const dateDiff = (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? "");
    if (dateDiff !== 0) return dateDiff;
    return a.reference.localeCompare(b.reference);
  });

  return rows;
}
