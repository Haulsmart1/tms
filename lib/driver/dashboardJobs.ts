export type DriverJobDateFields = {
  job_date: string | null;
  scheduled_date: string | null;
  planning_date: string | null;
};

export function getDriverJobOperationalDate(
  job: DriverJobDateFields
): string | null {
  // Planning can move a job without changing its original scheduled date.
  return job.planning_date ?? job.scheduled_date ?? job.job_date;
}

export function isDriverJobForDate(
  job: DriverJobDateFields,
  date: string
): boolean {
  return getDriverJobOperationalDate(job) === date;
}

/** Both lists are fresh, authorized server reads. Today's planned route can
 * include carried-over jobs outside the limited recent-history query. Keep
 * it first so bounded offline preparation prioritizes today's assignments.
 * Never populate assignments from the POD mutation queue. */
export function dashboardAssignedJobs<T extends { id: string }>(data: {
  jobs: T[];
  todayJobs?: T[];
}): T[] {
  const seen = new Set<string>();
  return [...(data.todayJobs ?? []), ...data.jobs].filter((job) => {
    if (seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
}
