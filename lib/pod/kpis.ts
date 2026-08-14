import { OPERATOR_TIME_ZONE } from "../time";
import type { QueueRow } from "./queue";

export type PodKpis = {
  awaiting: number;
  deliveredToday: number;
  overdue: number;
  valueAwaiting: number;
  valueOverdue: number;
  valueRecent: number;
};

/* en-CA formats as YYYY-MM-DD, which compares correctly as a plain string. */
function operatorDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATOR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function isSameOperatorDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return operatorDateKey(d) === operatorDateKey(now);
}

/* jobPrices maps jobId to customer_price. Value is summed per JOB, not per
   stop: a two-drop job has two awaiting stops but one price, and summing per
   stop would report double the money actually at risk. A job counts as overdue
   value if ANY of its awaiting stops is overdue. */
export function podKpis(
  awaiting: QueueRow[],
  completed: QueueRow[],
  jobPrices: Map<string, number>,
  now: Date,
): PodKpis {
  const jobIsOverdue = new Map<string, boolean>();
  for (const r of awaiting) {
    jobIsOverdue.set(r.jobId, (jobIsOverdue.get(r.jobId) ?? false) || r.isOverdue);
  }

  let valueOverdue = 0;
  let valueRecent = 0;
  for (const [jobId, overdue] of jobIsOverdue) {
    const price = jobPrices.get(jobId) ?? 0;
    if (overdue) valueOverdue += price;
    else valueRecent += price;
  }

  return {
    awaiting: awaiting.length,
    deliveredToday: completed.filter((r) => r.deliveredAt && isSameOperatorDay(r.deliveredAt, now)).length,
    overdue: awaiting.filter((r) => r.isOverdue).length,
    valueAwaiting: valueOverdue + valueRecent,
    valueOverdue,
    valueRecent,
  };
}

export type AttentionEntry = {
  stopId: string;
  jobReference: string;
  destinationCity: string;
  ageHours: number | null;
  missing: string;
};

export function attentionItems(awaiting: QueueRow[]): AttentionEntry[] {
  return awaiting
    .filter((r) => r.isOverdue)
    .sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0))
    .map((r) => ({
      stopId: r.stopId,
      jobReference: r.jobReference,
      destinationCity: r.destinationCity,
      ageHours: r.ageHours,
      missing:
        r.hasPhoto && r.hasDocument
          ? "evidence attached"
          : r.hasPhoto
            ? "photo only"
            : r.hasDocument
              ? "document only"
              : "no photo, no document",
    }));
}
