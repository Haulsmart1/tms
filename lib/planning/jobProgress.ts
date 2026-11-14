import type { PlanStop } from "./types";

type ProgressStop = Pick<PlanStop, "type" | "status" | "pod_status" | "collected_at" | "delivered_at">;
type ProgressJob = { status?: string | null; stops?: ProgressStop[] };

const normalise = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

function stopFinished(stop: ProgressStop): boolean {
  const status = normalise(stop.status);
  const podStatus = normalise(stop.pod_status);
  if ([status, podStatus].some((value) => ["failed", "cancelled", "canceled"].includes(value))) return false;
  if (stop.type === "collection") {
    // Older collection PODs used delivered_at / delivered before collected
    // gained its own timestamp and status.
    return Boolean(stop.collected_at || stop.delivered_at) ||
      [status, podStatus].some((value) => ["collected", "completed", "delivered"].includes(value));
  }
  return Boolean(stop.delivered_at) ||
    [status, podStatus].some((value) => ["completed", "delivered"].includes(value));
}

/** Stop evidence drives progress even while the overall job stays accepted.
 * A partial delivery is never shown as fully delivered. */
export function planningJobProgress(job: ProgressJob): "pending" | "part_collected" | "collected" | "delivered" {
  const status = normalise(job.status);
  if (["cancelled", "canceled"].includes(status)) return "pending";
  if (["completed", "delivered"].includes(status)) return "delivered";
  const deliveries = (job.stops ?? []).filter((stop) => stop.type === "delivery");
  if (deliveries.length > 0 && deliveries.every(stopFinished)) return "delivered";
  const collections = (job.stops ?? []).filter((stop) => stop.type === "collection");
  const collected = collections.filter(stopFinished).length;
  if (collections.length > 0 && collected === collections.length) return "collected";
  if (collected > 0) return "part_collected";
  return status === "collected" ? "collected" : "pending";
}

export function canUndoPlanningCollection(job: ProgressJob): boolean {
  const progress = planningJobProgress(job);
  return (progress === "collected" || progress === "part_collected") &&
    !(job.stops ?? []).some((stop) => stop.type === "delivery" && stopFinished(stop));
}
