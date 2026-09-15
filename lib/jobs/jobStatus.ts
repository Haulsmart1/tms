/*
  Which job statuses still accept delivery work (review POD-12).

  None of the completion paths used to check the job's status, so a cancelled
  job, or one nobody had accepted yet, could be completed and then shared as a
  POD. Driver routes and the console save both gate on this list, and the
  database writes carry the same list as a precondition so a status change
  that lands mid-request is not overwritten.

  An allowlist on purpose: an unexpected status is refused, not assumed fine.
*/

export const WORKABLE_JOB_STATUSES = [
  "planned",
  "assigned",
  "in_progress",
  "collected",
  "en_route",
] as const;

export function isWorkableJobStatus(status: unknown): boolean {
  return typeof status === "string" && (WORKABLE_JOB_STATUSES as readonly string[]).includes(status);
}

export function jobNotWorkableMessage(status: unknown): string {
  switch (status) {
    case "cancelled":
      return "This job has been cancelled, so it can no longer be updated.";
    case "pending_acceptance":
    case "awaiting_acceptance":
      return "This job has not been accepted yet, so delivery work cannot be recorded.";
    case "completed":
    case "delivered":
      return "This job is already completed.";
    default:
      return "This job is not open for delivery updates.";
  }
}
