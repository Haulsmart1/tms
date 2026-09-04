import type { LatLng, PlanJob } from "./types";
import {
  buildDriverTravelMatrix,
  type DriverTravelMatrix,
} from "./travelMatrix";
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

const FAST_PLOT_BEAM_WIDTH = 96;

/**
 * V5 operational-routing preferences.
 *
 * Clusters are deliberately soft preferences rather than precedence rules.
 * 35 km is large enough to treat a metropolitan/local working area as one
 * routing region without merging widely separated Scottish cities.
 */
const FAST_PLOT_CLUSTER_RADIUS_KM = 35;
const FAST_PLOT_CLUSTER_REENTRY_SECONDS = 3 * 60 * 60;
const FAST_PLOT_EARLY_CLUSTER_EXIT_SECONDS = 2 * 60 * 60;

type FastPlotCostTable = DriverTravelMatrix;
type FastPlotClusterMap = Map<string, number>;

type FastPlotSearchState = {
  route: FastPlotVisit[];
  visited: Set<string>;
  progress: Map<string, number>;
  cost: number;
  operationalPenalty: number;
  score: number;
  currentCluster: number | null;
  exitedClusters: Set<number>;
};

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function haversineKm(left: LatLng, right: LatLng): number {
  const earthRadiusKm = 6371;
  const lat1 = degreesToRadians(left.lat);
  const lat2 = degreesToRadians(right.lat);
  const deltaLat = degreesToRadians(right.lat - left.lat);
  const deltaLng = degreesToRadians(right.lng - left.lng);

  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const a =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * earthRadiusKm * Math.asin(
    Math.min(1, Math.sqrt(a))
  );
}

/**
 * Build deterministic connected geographic areas.
 *
 * If A is near B and B is near C, all three belong to one operating area.
 * Cluster membership never changes job precedence or visit eligibility.
 */
function buildFastPlotClusters(
  visits: FastPlotVisit[]
): FastPlotClusterMap {
  const clusters: FastPlotClusterMap = new Map();
  const adjacency = new Map<string, string[]>();

  for (const visit of visits) {
    adjacency.set(visit.key, []);
  }

  for (let leftIndex = 0; leftIndex < visits.length; leftIndex++) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < visits.length;
      rightIndex++
    ) {
      const left = visits[leftIndex];
      const right = visits[rightIndex];

      if (
        haversineKm(left.point, right.point) <=
        FAST_PLOT_CLUSTER_RADIUS_KM
      ) {
        adjacency.get(left.key)?.push(right.key);
        adjacency.get(right.key)?.push(left.key);
      }
    }
  }

  let clusterId = 0;

  for (const visit of visits) {
    if (clusters.has(visit.key)) continue;

    const queue = [visit.key];
    clusters.set(visit.key, clusterId);

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const key = queue[cursor];

      for (const neighbor of adjacency.get(key) ?? []) {
        if (clusters.has(neighbor)) continue;
        clusters.set(neighbor, clusterId);
        queue.push(neighbor);
      }
    }

    clusterId++;
  }

  return clusters;
}

function tableCost(
  table: FastPlotCostTable,
  from: FastPlotVisit,
  to: FastPlotVisit
): number {
  return finiteCost(
    table.travelSecondsBetween(from.key, to.key)
  );
}

async function loadFastPlotCostTable(
  visits: FastPlotVisit[],
  loadCosts: FastPlotCostLoader
): Promise<FastPlotCostTable | null> {
  return buildDriverTravelMatrix(
    visits.map((visit) => ({
      id: visit.key,
      point: visit.point,
    })),
    loadCosts,
  );
}

function cloneProgress(
  progress: Map<string, number>
): Map<string, number> {
  return new Map(progress);
}

function remainingVisitsForState(
  visits: FastPlotVisit[],
  visited: Set<string>
): FastPlotVisit[] {
  return visits.filter((visit) => !visited.has(visit.key));
}

/** Relaxed remaining-route lower bound used only to rank beam states.

    It deliberately ignores precedence. Every unfinished path needs an edge
    from its current point and all but one remaining visit need an outgoing
    edge. Allowing duplicate destinations makes this optimistic rather than
    accidentally excluding a potentially good legal route. */
function remainingCostLowerBound(
  current: FastPlotVisit | null,
  remaining: FastPlotVisit[],
  table: FastPlotCostTable
): number {
  if (!current || remaining.length === 0) return 0;

  let currentMinimum = Number.POSITIVE_INFINITY;

  for (const candidate of remaining) {
    currentMinimum = Math.min(
      currentMinimum,
      tableCost(table, current, candidate)
    );
  }

  if (!Number.isFinite(currentMinimum)) {
    return Number.POSITIVE_INFINITY;
  }

  if (remaining.length === 1) {
    return currentMinimum;
  }

  const outgoingMinimums: number[] = [];

  for (const from of remaining) {
    let minimum = Number.POSITIVE_INFINITY;

    for (const to of remaining) {
      if (from.key === to.key) continue;
      minimum = Math.min(minimum, tableCost(table, from, to));
    }

    if (!Number.isFinite(minimum)) {
      minimum = 0;
    }

    outgoingMinimums.push(minimum);
  }

  const total = outgoingMinimums.reduce(
    (sum, value) => sum + value,
    0
  );
  const largest = Math.max(...outgoingMinimums);

  return currentMinimum + total - largest;
}

function stateRouteKey(state: FastPlotSearchState): string {
  return state.route.map((visit) => visit.key).join("|");
}

function compareSearchStates(
  left: FastPlotSearchState,
  right: FastPlotSearchState
): number {
  if (left.score !== right.score) {
    return left.score - right.score;
  }

  if (left.cost !== right.cost) {
    return left.cost - right.cost;
  }

  return stateRouteKey(left).localeCompare(stateRouteKey(right));
}

function expandSearchState(
  state: FastPlotSearchState,
  visits: FastPlotVisit[],
  counts: Map<string, number>,
  table: FastPlotCostTable,
  clusters: FastPlotClusterMap
): FastPlotSearchState[] {
  const remaining = remainingVisitsForState(
    visits,
    state.visited
  );

  const eligible = eligibleVisits(
    remaining,
    state.progress
  );

  if (eligible.length === 0) return [];

  const current = state.route.at(-1) ?? null;
  const expanded: FastPlotSearchState[] = [];

  for (const candidate of eligible) {
    const edgeCost = current
      ? tableCost(table, current, candidate)
      : 0;

    if (!Number.isFinite(edgeCost)) continue;

    const progress = cloneProgress(state.progress);
    applyVisit(candidate, progress, counts);

    const visited = new Set(state.visited);
    visited.add(candidate.key);

    const route = [...state.route, candidate];
    const cost = state.cost + edgeCost;
    const after = visits.filter(
      (visit) => !visited.has(visit.key)
    );

    const candidateCluster = clusters.get(candidate.key) ?? null;
    const exitedClusters = new Set(state.exitedClusters);
    let operationalPenalty = state.operationalPenalty;

    if (
      state.currentCluster !== null &&
      candidateCluster !== null &&
      state.currentCluster !== candidateCluster
    ) {
      const hasEligibleWorkInCurrentCluster = eligible.some(
        (visit) =>
          visit.key !== candidate.key &&
          clusters.get(visit.key) === state.currentCluster
      );

      if (hasEligibleWorkInCurrentCluster) {
        operationalPenalty += FAST_PLOT_EARLY_CLUSTER_EXIT_SECONDS;
      }

      exitedClusters.add(state.currentCluster);

      if (exitedClusters.has(candidateCluster)) {
        operationalPenalty += FAST_PLOT_CLUSTER_REENTRY_SECONDS;
      }
    }

    expanded.push({
      route,
      visited,
      progress,
      cost,
      operationalPenalty,
      currentCluster: candidateCluster,
      exitedClusters,
      score:
        cost +
        operationalPenalty +
        remainingCostLowerBound(
          candidate,
          after,
          table
        ),
    });
  }

  return expanded;
}

function bestBeamStates(
  states: FastPlotSearchState[]
): FastPlotSearchState[] {
  states.sort(compareSearchStates);
  return states.slice(0, FAST_PLOT_BEAM_WIDTH);
}

async function beamSearchFastPlotOrder(
  visits: FastPlotVisit[],
  counts: Map<string, number>,
  table: FastPlotCostTable
): Promise<LatLng[] | null> {
  const clusters = buildFastPlotClusters(visits);

  let beam: FastPlotSearchState[] = [{
    route: [],
    visited: new Set<string>(),
    progress: new Map<string, number>(),
    cost: 0,
    operationalPenalty: 0,
    score: 0,
    currentCluster: null,
    exitedClusters: new Set<number>(),
  }];

  for (let depth = 0; depth < visits.length; depth++) {
    const next: FastPlotSearchState[] = [];

    for (const state of beam) {
      next.push(
        ...expandSearchState(
          state,
          visits,
          counts,
          table,
          clusters
        )
      );
    }

    if (next.length === 0) {
      return null;
    }

    beam = bestBeamStates(next);
  }

  const complete = beam
    .filter((state) => state.route.length === visits.length)
    .sort((left, right) => {
      const leftOperational =
        left.cost + left.operationalPenalty;
      const rightOperational =
        right.cost + right.operationalPenalty;

      if (leftOperational !== rightOperational) {
        return leftOperational - rightOperational;
      }

      if (left.cost !== right.cost) {
        return left.cost - right.cost;
      }

      return stateRouteKey(left).localeCompare(
        stateRouteKey(right)
      );
    });

  const best = complete[0];

  if (!best) return null;

  return best.route.map((visit) => visit.point);
}

/** Build a low-cost physical route while enforcing every job's stop_order.

    V5 preloads the bounded TomTom physical-stop cost graph and performs
    beam search across legal complete routes. Geographic operating areas are
    soft scoring preferences: the search discourages leaving currently available
    work behind and strongly discourages returning to an area after leaving it,
    without weakening stop precedence.

    TomTom remains advisory: malformed/unavailable matrices fall back to the
    deterministic precedence-safe sequence. */
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

  if (visits.length <= 1) {
    return visits.map((visit) => visit.point);
  }

  const counts = jobStopCounts(jobs);
  const table = await loadFastPlotCostTable(
    visits,
    loadCosts
  );

  if (!table) {
    return fallbackFastPlotOrder(jobs);
  }

  const optimized = await beamSearchFastPlotOrder(
    visits,
    counts,
    table
  );

  return optimized ?? fallbackFastPlotOrder(jobs);
}
