import type { LatLng, PlanJob } from "./types";
import {
  isRoutable,
  jobWaypoints,
  sortedStops,
} from "./waypoints";

export type FastPlotVisit = {
  key: string;
  point: LatLng;
  requirements: Record<string, number[]>;
};

export type FastPlotCostLoader = (
  origins: LatLng[],
  destinations: LatLng[]
) => Promise<number[][] | null>;

function pointKey(point: LatLng): string {
  return `${point.lat},${point.lng}`;
}

function stopPoint(
  stop: ReturnType<typeof sortedStops>[number]
): LatLng {
  return { lat: stop.lat as number, lng: stop.lng as number };
}

/** Build unique physical visits while retaining each job's stop precedence.

    requirements[jobId] is the zero-based stop index that must be reached for
    that job before this physical location is eligible. If consecutive stops
    of one job share a coordinate, visiting it satisfies all of them at once. */
export function buildFastPlotVisits(jobs: PlanJob[]): FastPlotVisit[] {
  const visits = new Map<string, FastPlotVisit>();

  for (const job of jobs) {
    if (!isRoutable(job)) continue;

    const stops = sortedStops(job);

    for (let index = 0; index < stops.length; index++) {
      const point = stopPoint(stops[index]);
      const key = pointKey(point);
      const existing = visits.get(key);

      if (existing) {
        const requirements = existing.requirements[job.id] ?? [];
        if (!requirements.includes(index)) {
          requirements.push(index);
          requirements.sort((a, b) => a - b);
        }
        existing.requirements[job.id] = requirements;
      } else {
        visits.set(key, {
          key,
          point,
          requirements: { [job.id]: [index] },
        });
      }
    }
  }

  return [...visits.values()];
}

/** True when exact physical deduplication would destroy required stop order.

    Consecutive duplicates are safe to collapse, but A -> B -> A requires a
    genuine second visit to A and therefore cannot use the unique-visit graph. */
export function requiresPhysicalRevisit(jobs: PlanJob[]): boolean {
  for (const job of jobs) {
    if (!isRoutable(job)) continue;

    const collapsedKeys: string[] = [];

    for (const stop of sortedStops(job)) {
      const key = pointKey(stopPoint(stop));

      if (collapsedKeys.at(-1) !== key) {
        collapsedKeys.push(key);
      }
    }

    const seen = new Set<string>();

    for (const key of collapsedKeys) {
      if (seen.has(key)) return true;
      seen.add(key);
    }
  }

  return false;
}

function literalJobWaypoints(jobs: PlanJob[]): LatLng[] {
  return jobs.flatMap(jobWaypoints);
}

/** Detect whether unique physical visits contain contradictory precedence.

    Each job contributes edges between consecutive distinct physical stops.
    A directed cycle means no route can visit every physical location exactly
    once while preserving every job's stop order. */
export function hasPhysicalPrecedenceCycle(jobs: PlanJob[]): boolean {
  const adjacency = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  function ensureNode(key: string): void {
    if (!adjacency.has(key)) adjacency.set(key, new Set());
    if (!indegree.has(key)) indegree.set(key, 0);
  }

  for (const job of jobs) {
    if (!isRoutable(job)) continue;

    const keys: string[] = [];

    for (const stop of sortedStops(job)) {
      const key = pointKey(stopPoint(stop));

      if (keys.at(-1) !== key) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      ensureNode(key);
    }

    for (let index = 1; index < keys.length; index++) {
      const from = keys[index - 1];
      const to = keys[index];

      if (from === to) continue;

      const outgoing = adjacency.get(from);
      if (!outgoing) continue;

      if (!outgoing.has(to)) {
        outgoing.add(to);
        indegree.set(to, (indegree.get(to) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];

  for (const [key, degree] of indegree) {
    if (degree === 0) queue.push(key);
  }

  let visited = 0;
  let cursor = 0;

  while (cursor < queue.length) {
    const key = queue[cursor++];
    visited++;

    for (const next of adjacency.get(key) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);

      if (degree === 0) {
        queue.push(next);
      }
    }
  }

  return visited !== indegree.size;
}

function jobStopCounts(jobs: PlanJob[]): Map<string, number> {
  const result = new Map<string, number>();

  for (const job of jobs) {
    if (isRoutable(job)) {
      result.set(job.id, sortedStops(job).length);
    }
  }

  return result;
}

function visitIsEligible(
  visit: FastPlotVisit,
  progress: Map<string, number>
): boolean {
  const requirements = Object.entries(visit.requirements);

  return (
    requirements.length > 0 &&
    requirements.every(
      ([jobId, requiredIndexes]) =>
        requiredIndexes.includes(progress.get(jobId) ?? 0)
    )
  );
}

/** Apply one physical visit.

    A location can satisfy several consecutive stops of a job when they share
    the same coordinate. It can also satisfy multiple different jobs at once. */
function applyVisit(
  visit: FastPlotVisit,
  progress: Map<string, number>,
  counts: Map<string, number>
): void {
  let changed = true;

  while (changed) {
    changed = false;

    for (const [jobId, requiredIndexes] of Object.entries(visit.requirements)) {
      const current = progress.get(jobId) ?? 0;
      const count = counts.get(jobId) ?? 0;

      if (current < count && requiredIndexes.includes(current)) {
        progress.set(jobId, current + 1);
        changed = true;
      }
    }
  }
}

function eligibleVisits(
  remaining: FastPlotVisit[],
  progress: Map<string, number>
): FastPlotVisit[] {
  return remaining.filter((visit) => visitIsEligible(visit, progress));
}

function removeVisit(
  remaining: FastPlotVisit[],
  key: string
): FastPlotVisit[] {
  return remaining.filter((visit) => visit.key !== key);
}

/** Deterministic precedence-safe fallback requiring no routing service.

    Lane/job order determines ties, but a delivery cannot appear before its
    own preceding collection/intermediate stop. */
export function fallbackFastPlotOrder(jobs: PlanJob[]): LatLng[] {
  const visits = buildFastPlotVisits(jobs);
  const counts = jobStopCounts(jobs);
  const progress = new Map<string, number>();
  const result: LatLng[] = [];
  let remaining = visits.slice();

  while (remaining.length > 0) {
    const eligible = eligibleVisits(remaining, progress);
    if (eligible.length === 0) break;

    const chosen = eligible[0];
    result.push(chosen.point);
    applyVisit(chosen, progress, counts);
    remaining = removeVisit(remaining, chosen.key);
  }

  return result;
}

function finiteCost(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : Number.POSITIVE_INFINITY;
}

async function chooseFirstVisit(
  candidates: FastPlotVisit[],
  loadCosts: FastPlotCostLoader
): Promise<FastPlotVisit> {
  if (candidates.length <= 1) return candidates[0];

  // Score every legal starting point against every other legal point.
  // 10 x 10 chunks keep each TomTom matrix within the 100-cell contract.
  const scores = new Map<string, number>();

  for (const candidate of candidates) {
    scores.set(candidate.key, Number.POSITIVE_INFINITY);
  }

  for (
    let originOffset = 0;
    originOffset < candidates.length;
    originOffset += 10
  ) {
    const origins = candidates.slice(originOffset, originOffset + 10);

    for (
      let destinationOffset = 0;
      destinationOffset < candidates.length;
      destinationOffset += 10
    ) {
      const destinations = candidates.slice(
        destinationOffset,
        destinationOffset + 10
      );

      const matrix = await loadCosts(
        origins.map((visit) => visit.point),
        destinations.map((visit) => visit.point)
      );

      if (!matrix) continue;

      for (let originIndex = 0; originIndex < origins.length; originIndex++) {
        const origin = origins[originIndex];
        let score =
          scores.get(origin.key) ?? Number.POSITIVE_INFINITY;

        for (
          let destinationIndex = 0;
          destinationIndex < destinations.length;
          destinationIndex++
        ) {
          const destination = destinations[destinationIndex];

          if (destination.key === origin.key) continue;

          score = Math.min(
            score,
            finiteCost(matrix[originIndex]?.[destinationIndex])
          );
        }

        scores.set(origin.key, score);
      }
    }
  }

  let best = candidates[0];
  let bestScore =
    scores.get(best.key) ?? Number.POSITIVE_INFINITY;

  for (const candidate of candidates.slice(1)) {
    const score =
      scores.get(candidate.key) ?? Number.POSITIVE_INFINITY;

    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

async function chooseNearestVisit(
  current: FastPlotVisit,
  candidates: FastPlotVisit[],
  loadCosts: FastPlotCostLoader
): Promise<FastPlotVisit | null> {
  let best: FastPlotVisit | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  // 1 x 100 is the largest useful request under Matrix v2's 100-cell cap.
  for (let offset = 0; offset < candidates.length; offset += 100) {
    const chunk = candidates.slice(offset, offset + 100);
    const matrix = await loadCosts(
      [current.point],
      chunk.map((visit) => visit.point)
    );

    if (!matrix || !matrix[0]) continue;

    for (let index = 0; index < chunk.length; index++) {
      const cost = finiteCost(matrix[0][index]);
      if (cost < bestCost) {
        best = chunk[index];
        bestCost = cost;
      }
    }
  }

  return best;
}

/** Build a low-cost physical route while enforcing every job's stop_order.

    TomTom is advisory: malformed/unavailable matrices fall back to the first
    legal visit, so Fast Plot always retains a deterministic safe sequence. */
export async function optimizeFastPlotOrder(
  jobs: PlanJob[],
  loadCosts: FastPlotCostLoader
): Promise<LatLng[]> {
  if (
    requiresPhysicalRevisit(jobs) ||
    hasPhysicalPrecedenceCycle(jobs)
  ) {
    return literalJobWaypoints(jobs);
  }

  const visits = buildFastPlotVisits(jobs);
  if (visits.length <= 1) return visits.map((visit) => visit.point);

  const counts = jobStopCounts(jobs);
  const progress = new Map<string, number>();
  const result: LatLng[] = [];
  let remaining = visits.slice();
  let current: FastPlotVisit | null = null;

  while (remaining.length > 0) {
    const eligible = eligibleVisits(remaining, progress);
    if (eligible.length === 0) {
      return fallbackFastPlotOrder(jobs);
    }

    let chosen: FastPlotVisit;

    try {
      if (!current) {
        chosen = await chooseFirstVisit(eligible, loadCosts);
      } else {
        chosen =
          (await chooseNearestVisit(current, eligible, loadCosts)) ??
          eligible[0];
      }
    } catch {
      chosen = eligible[0];
    }

    result.push(chosen.point);
    applyVisit(chosen, progress, counts);
    remaining = removeVisit(remaining, chosen.key);
    current = chosen;
  }

  return result;
}
