import { isAwaitingPod, isPodOverdue, podAgeHours } from "./overdue";

export type PodStop = {
  id: string;
  stop_order: number;
  type: string | null;
  city: string | null;
  postcode: string | null;
  pod_status: string | null;
  planned_at: string | null;
  delivered_at: string | null;
  pod_photo_url: string | null;
  pod_document_url: string | null;
};

export type PodJob = {
  id: string;
  reference: string | null;
  status: string | null;
  scheduled_date: string | null;
  customer_name: string | null;
  vehicle_registration: string | null;
  vehicle_model: string | null;
  driver_name: string | null;
  customer_price: number | null;
  stops: PodStop[];
};

export type QueueRow = {
  stopId: string;
  jobId: string;
  jobReference: string;
  customerName: string;
  originCity: string | null;
  destinationCity: string;
  destinationPostcode: string;
  vehicleRegistration: string | null;
  vehicleModel: string | null;
  driverName: string | null;
  dropCount: number;
  hasPhoto: boolean;
  hasDocument: boolean;
  ageHours: number | null;
  isOverdue: boolean;
  deliveredAt: string | null;
  stops: PodStop[];
};

function firstCollectionCity(stops: PodStop[]): string | null {
  const c = [...stops].sort((a, b) => a.stop_order - b.stop_order)
    .find((s) => s.type === "collection");
  return c?.city ?? null;
}

/* Fallbacks are deliberately not uniform. An em-dash reads correctly in a
   narrow mono column (reference, city), a phrase reads better in a wide prose
   cell ("No customer"), and an empty string is right for the postcode because
   it is appended to other text rather than standing alone. The rest of this
   codebase is inconsistent here too; this at least is inconsistent on purpose. */
function toRow(job: PodJob, stop: PodStop, now: Date): QueueRow {
  return {
    stopId: stop.id,
    jobId: job.id,
    jobReference: job.reference ?? "—",
    customerName: job.customer_name ?? "No customer",
    originCity: firstCollectionCity(job.stops),
    destinationCity: stop.city ?? "—",
    destinationPostcode: stop.postcode ?? "",
    vehicleRegistration: job.vehicle_registration,
    vehicleModel: job.vehicle_model,
    driverName: job.driver_name,
    dropCount: job.stops.filter((s) => s.type === "delivery").length,
    hasPhoto: Boolean(stop.pod_photo_url),
    hasDocument: Boolean(stop.pod_document_url),
    ageHours: podAgeHours(stop.planned_at, now),
    isOverdue: isPodOverdue(stop.planned_at, now),
    deliveredAt: stop.delivered_at,
    stops: [...job.stops].sort((a, b) => a.stop_order - b.stop_order),
  };
}

/* Awaiting applies the dashboard's full predicate, including jobs.status ===
   "planned", so the two pages report the same count. Completed deliberately
   does NOT: delivered stops live on completed jobs, so applying the job filter
   there would empty the tab. */
export function splitDeliveryStops(
  jobs: PodJob[],
  now: Date,
): { awaiting: QueueRow[]; completed: QueueRow[] } {
  const awaiting: QueueRow[] = [];
  const completed: QueueRow[] = [];

  for (const job of jobs) {
    for (const stop of job.stops) {
      if (stop.type !== "delivery") continue;

      if (stop.pod_status === "delivered") {
        completed.push(toRow(job, stop, now));
        continue;
      }
      if (isAwaitingPod({ type: stop.type, pod_status: stop.pod_status, jobStatus: job.status })) {
        awaiting.push(toRow(job, stop, now));
      }
    }
  }

  // Oldest first. Unknown age sorts last: an undated stop is not urgent, it is
  // unmeasured, and putting it at the top would push real problems down.
  // The equal-nulls branch is load-bearing, not defensive: without it the
  // comparator returns 1 in both directions for two null ages, never 0, which
  // is not a strict weak ordering and leaves the result implementation-defined.
  awaiting.sort((a, b) => {
    if (a.ageHours === null && b.ageHours === null) return 0;
    if (a.ageHours === null) return 1;
    if (b.ageHours === null) return -1;
    return b.ageHours - a.ageHours;
  });
  completed.sort((a, b) => (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? ""));

  return { awaiting, completed };
}

export function waitingLabel(ageHours: number | null): string {
  if (ageHours === null) return "—";
  // A negative age means planned_at is in the future: the job is scheduled for
  // a later date, so the stop is in the queue but not actually late yet.
  // Clamping this to "0 m" made it indistinguishable from a stop that became
  // due seconds ago, which is a real misread for a dispatcher scanning the
  // queue rather than a cosmetic nit.
  if (ageHours < 0) return "not due";
  if (ageHours < 1) return `${Math.floor(ageHours * 60)} m`;
  if (ageHours < 24) return `${Math.floor(ageHours)} h`;
  return `${Math.floor(ageHours / 24)} d ${Math.floor(ageHours % 24)} h`;
}
