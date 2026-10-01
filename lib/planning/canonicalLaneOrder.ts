import type { PlanJob } from "./types";

/**
 * Present whole-job cards in the order their first physical service occurs.
 *
 * The canonical itinerary remains the authority for physical stop/drop order.
 * This helper only prevents the whole-job lane presentation from contradicting
 * that itinerary. Jobs without a mapped canonical service remain after mapped
 * jobs in their existing lane order.
 */
export function jobsInCanonicalDropOrder(
  jobs: PlanJob[],
  dropNumbersByJobId?: Record<string, number[]>
): PlanJob[] {
  if (!dropNumbersByJobId) {
    return jobs;
  }

  return jobs
    .map((job, laneIndex) => {
      const drops = dropNumbersByJobId[job.id] ?? [];
      const firstDrop =
        drops.length > 0
          ? Math.min(...drops.filter(Number.isFinite))
          : Number.POSITIVE_INFINITY;

      return {
        job,
        laneIndex,
        firstDrop,
      };
    })
    .sort((left, right) => {
      if (left.firstDrop !== right.firstDrop) {
        return left.firstDrop - right.firstDrop;
      }

      return left.laneIndex - right.laneIndex;
    })
    .map(({ job }) => job);
}