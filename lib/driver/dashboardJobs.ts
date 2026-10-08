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
