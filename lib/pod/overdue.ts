/* The single definition of "awaiting POD" and "how old is it".

   Both /pod and /dashboard answer these questions about the same rows. When
   they answered them separately, they could disagree about the same stop, which
   is the kind of inconsistency nobody reports and everybody quietly stops
   trusting. lib/dashboard/aggregate.ts and app/dashboard/page.tsx both consume
   this module. */

/** Hours past planned_at before a POD counts as overdue. */
export const POD_OVERDUE_HOURS = 48;

export type AwaitingInput = {
  type: string | null;
  pod_status: string | null;
  /** jobs.status for the stop's parent job. */
  jobStatus: string | null;
};

/* planned_at is NOT a real planned time: app/jobs/page.tsx writes it as
   `${scheduled_date}T08:00:00`, a derived 8am stamp. Ages are therefore
   accurate to the day, not the hour. It is also null whenever the job has no
   scheduled_date, which is why this returns null rather than a number: a
   caller that wants to treat undated stops as fresh, or as ancient, has to say
   so explicitly instead of inheriting whichever we happened to pick. */
export function podAgeHours(plannedAt: string | null, now: Date): number | null {
  if (!plannedAt) return null;
  const t = new Date(plannedAt).getTime();
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 36e5;
}

/* Mirrors app/dashboard/page.tsx's awaiting set exactly: a delivery stop, not
   yet delivered, on a job still marked planned. The job-status condition looks
   redundant because the delivered-cascade only completes a job once every
   delivery stop is delivered, so the excluded set should normally be empty.
   Keeping it means the two pages agree even when the data is not normal. */
export function isAwaitingPod(input: AwaitingInput): boolean {
  return (
    input.type === "delivery" &&
    input.pod_status !== "delivered" &&
    input.jobStatus === "planned"
  );
}

export function isPodOverdue(plannedAt: string | null, now: Date): boolean {
  const age = podAgeHours(plannedAt, now);
  return age !== null && age > POD_OVERDUE_HOURS;
}
