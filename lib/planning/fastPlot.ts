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

export type AnchoredFastPlotResult =
  | {
      ok: true;
      route: LatLng[];
      firstTravelSeconds: number;
    }
  | {
      ok: false;
      reason:
        | "no_routable_visits"
        | "no_reachable_first_visit"
        | "start_cost_unavailable"
        | "route_cost_unavailable"
        | "unsupported_physical_route";
    };

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
 * Complete TomTom matrices are retained for smaller routes because the V5
 * beam search benefits from knowing every directed edge. Above this threshold
 * Fast Plot switches to bounded, on-demand candidate loading.
 *
 * 60 physical visits require 36 10x10 matrix requests with the shared matrix
 * builder. That stays below the 40-request optimization budget.
 */
const FAST_PLOT_COMPLETE_MATRIX_MAX_VISITS = 60;
const FAST_PLOT_SPARSE_REQUEST_BUDGET = 32;
const FAST_PLOT_SPARSE_CANDIDATE_LIMIT = 100;

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


type AnchoredFirstVisitResult =
  | {
      ok: true;
      visit: FastPlotVisit;
      travelSeconds: number;
    }
  | {
      ok: false;
      reason: "no_reachable_first_visit" | "start_cost_unavailable";
    };

async function chooseAnchoredFirstVisit(
  visits: FastPlotVisit[],
  counts: Map<string, number>,
  startPoint: LatLng,
  loadCosts: FastPlotCostLoader
): Promise<AnchoredFirstVisitResult> {
  const eligible = eligibleVisits(
    visits,
    new Map<string, number>()
  );

  if (eligible.length === 0) {
    return { ok: false, reason: "no_reachable_first_visit" };
  }

  let bestVisit: FastPlotVisit | null = null;
  let bestTravelSeconds = Number.POSITIVE_INFINITY;

  for (
    let offset = 0;
    offset < eligible.length;
    offset += FAST_PLOT_SPARSE_CANDIDATE_LIMIT
  ) {
    const candidates = eligible.slice(
      offset,
      offset + FAST_PLOT_SPARSE_CANDIDATE_LIMIT
    );

    let loaded: number[][] | null = null;

    try {
      loaded = await loadCosts(
        [startPoint],
        candidates.map((candidate) => candidate.point)
      );
    } catch {
      return { ok: false, reason: "start_cost_unavailable" };
    }

    if (
      !Array.isArray(loaded) ||
      loaded.length !== 1 ||
      !Array.isArray(loaded[0]) ||
      loaded[0].length !== candidates.length
    ) {
      return { ok: false, reason: "start_cost_unavailable" };
    }

    for (let index = 0; index < candidates.length; index++) {
      const raw = loaded[0][index];
      const travelSeconds =
        typeof raw === "number" &&
        Number.isFinite(raw) &&
        raw >= 0
          ? raw
          : null;

      if (travelSeconds === null) continue;

      const candidate = candidates[index];

      if (
        travelSeconds < bestTravelSeconds ||
        (
          travelSeconds === bestTravelSeconds &&
          candidate.key < (bestVisit?.key ?? "\uffff")
        )
      ) {
        bestVisit = candidate;
        bestTravelSeconds = travelSeconds;
      }
    }
  }

  if (!bestVisit) {
    return { ok: false, reason: "no_reachable_first_visit" };
  }

  // Defensive assertion: an initial visit must be legal at progress zero.
  if (!visitIsEligible(bestVisit, new Map<string, number>())) {
    return { ok: false, reason: "no_reachable_first_visit" };
  }

  return {
    ok: true,
    visit: bestVisit,
    travelSeconds: bestTravelSeconds,
  };
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
  table: FastPlotCostTable,
  firstVisit: FastPlotVisit | null = null
): Promise<LatLng[] | null> {
  const clusters = buildFastPlotClusters(visits);
  const initialProgress = new Map<string, number>();
  const initialVisited = new Set<string>();
  const initialRoute: FastPlotVisit[] = [];

  if (firstVisit) {
    applyVisit(firstVisit, initialProgress, counts);
    initialVisited.add(firstVisit.key);
    initialRoute.push(firstVisit);
  }

  const initialRemaining = remainingVisitsForState(
    visits,
    initialVisited
  );

  let beam: FastPlotSearchState[] = [{
    route: initialRoute,
    visited: initialVisited,
    progress: initialProgress,
    cost: 0,
    operationalPenalty: 0,
    score: firstVisit
      ? remainingCostLowerBound(
          firstVisit,
          initialRemaining,
          table
        )
      : 0,
    currentCluster: firstVisit
      ? clusters.get(firstVisit.key) ?? null
      : null,
    exitedClusters: new Set<number>(),
  }];

  for (
    let depth = firstVisit ? 1 : 0;
    depth < visits.length;
    depth++
  ) {
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

function sparseTransitionPenalty(
  currentCluster: number | null,
  candidateCluster: number | null,
  eligible: FastPlotVisit[],
  candidate: FastPlotVisit,
  exitedClusters: Set<number>,
  clusters: FastPlotClusterMap
): number {
  if (
    currentCluster === null ||
    candidateCluster === null ||
    currentCluster === candidateCluster
  ) {
    return 0;
  }

  let penalty = 0;

  const leavesEligibleWorkBehind = eligible.some(
    (visit) =>
      visit.key !== candidate.key &&
      clusters.get(visit.key) === currentCluster
  );

  if (leavesEligibleWorkBehind) {
    penalty += FAST_PLOT_EARLY_CLUSTER_EXIT_SECONDS;
  }

  if (exitedClusters.has(candidateCluster)) {
    penalty += FAST_PLOT_CLUSTER_REENTRY_SECONDS;
  }

  return penalty;
}

function compareGeographicCandidates(
  current: FastPlotVisit,
  left: FastPlotVisit,
  right: FastPlotVisit
): number {
  const leftDistance = haversineKm(current.point, left.point);
  const rightDistance = haversineKm(current.point, right.point);

  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }

  return left.key.localeCompare(right.key);
}

function chooseGeographicSparseCandidate(
  current: FastPlotVisit,
  eligible: FastPlotVisit[],
  currentCluster: number | null,
  exitedClusters: Set<number>,
  clusters: FastPlotClusterMap
): FastPlotVisit {
  return eligible
    .slice()
    .sort((left, right) => {
      const leftCluster = clusters.get(left.key) ?? null;
      const rightCluster = clusters.get(right.key) ?? null;

      const leftPenalty = sparseTransitionPenalty(
        currentCluster,
        leftCluster,
        eligible,
        left,
        exitedClusters,
        clusters
      );
      const rightPenalty = sparseTransitionPenalty(
        currentCluster,
        rightCluster,
        eligible,
        right,
        exitedClusters,
        clusters
      );

      if (leftPenalty !== rightPenalty) {
        return leftPenalty - rightPenalty;
      }

      return compareGeographicCandidates(current, left, right);
    })[0];
}

function validSparseCosts(
  value: unknown,
  expectedColumns: number
): value is number[][] {
  if (!Array.isArray(value) || value.length !== 1) {
    return false;
  }

  const row = value[0];

  if (!Array.isArray(row) || row.length !== expectedColumns) {
    return false;
  }

  return row.every(
    (cost) =>
      typeof cost === "number" &&
      Number.isFinite(cost) &&
      cost >= 0
  );
}

/**
 * Large-route Fast Plot mode.
 *
 * It deliberately avoids an all-to-all TomTom matrix. At each route step the
 * currently legal physical visits are ranked geographically, then at most 100
 * candidates are evaluated in one directed 1xN TomTom request. Loading stops
 * after a hard request budget. Missing/unavailable TomTom data never becomes
 * invented travel seconds: once loading is unavailable/exhausted, deterministic
 * geographic ordering is used while the same precedence and cluster rules
 * continue to apply.
 */
async function sparseFastPlotOrder(
  visits: FastPlotVisit[],
  counts: Map<string, number>,
  loadCosts: FastPlotCostLoader,
  firstVisit: FastPlotVisit | null = null
): Promise<LatLng[] | null> {
  const clusters = buildFastPlotClusters(visits);
  const progress = new Map<string, number>();
  const visited = new Set<string>();
  const exitedClusters = new Set<number>();
  const route: FastPlotVisit[] = [];

  if (firstVisit) {
    applyVisit(firstVisit, progress, counts);
    visited.add(firstVisit.key);
    route.push(firstVisit);
  }

  let currentCluster: number | null = firstVisit
    ? clusters.get(firstVisit.key) ?? null
    : null;
  let requestsUsed = 0;
  let loadingAvailable = true;

  while (route.length < visits.length) {
    const remaining = visits.filter(
      (visit) => !visited.has(visit.key)
    );
    const eligible = eligibleVisits(remaining, progress);

    if (eligible.length === 0) {
      return null;
    }

    const current = route.at(-1) ?? null;
    let chosen: FastPlotVisit;

    if (!current) {
      // No vehicle/start coordinate is supplied to Fast Plot V5 yet.
      // Preserve deterministic lane order for the first legal physical visit.
      chosen = eligible[0];
    } else {
      let tomTomChoice: FastPlotVisit | null = null;

      if (
        loadingAvailable &&
        requestsUsed < FAST_PLOT_SPARSE_REQUEST_BUDGET
      ) {
        const candidates = eligible
          .slice()
          .sort((left, right) =>
            compareGeographicCandidates(current, left, right)
          )
          .slice(0, FAST_PLOT_SPARSE_CANDIDATE_LIMIT);

        if (candidates.length > 0) {
          requestsUsed++;

          let loaded: number[][] | null = null;

          try {
            loaded = await loadCosts(
              [current.point],
              candidates.map((candidate) => candidate.point)
            );
          } catch {
            loaded = null;
          }

          if (validSparseCosts(loaded, candidates.length)) {
            const row = loaded[0];

            tomTomChoice = candidates
              .map((candidate, index) => {
                const candidateCluster =
                  clusters.get(candidate.key) ?? null;

                return {
                  candidate,
                  cost:
                    row[index] +
                    sparseTransitionPenalty(
                      currentCluster,
                      candidateCluster,
                      eligible,
                      candidate,
                      exitedClusters,
                      clusters
                    ),
                };
              })
              .sort((left, right) => {
                if (left.cost !== right.cost) {
                  return left.cost - right.cost;
                }

                return left.candidate.key.localeCompare(
                  right.candidate.key
                );
              })[0]?.candidate ?? null;
          } else {
            // A null/malformed response includes rate-limit and upstream
            // failures from the UI loader. Stop expanding requests immediately.
            loadingAvailable = false;
          }
        }
      }

      chosen =
        tomTomChoice ??
        chooseGeographicSparseCandidate(
          current,
          eligible,
          currentCluster,
          exitedClusters,
          clusters
        );
    }

    const chosenCluster = clusters.get(chosen.key) ?? null;

    if (
      currentCluster !== null &&
      chosenCluster !== null &&
      currentCluster !== chosenCluster
    ) {
      exitedClusters.add(currentCluster);
    }

    applyVisit(chosen, progress, counts);
    visited.add(chosen.key);
    route.push(chosen);
    currentCluster = chosenCluster;
  }

  return route.map((visit) => visit.point);
}

/** Build a low-cost physical route while enforcing every job's stop_order.

    V5 preloads the bounded TomTom physical-stop cost graph and performs
    beam search across legal complete routes. Geographic operating areas are
    soft scoring preferences: the search discourages leaving currently available
    work behind and strongly discourages returning to an area after leaving it,
    without weakening stop precedence.

    TomTom remains advisory: malformed/unavailable matrices fall back to the
    deterministic precedence-safe sequence. */
/**
 * Convert a physical Fast Plot route back to the lane's job-level route_order.
 *
 * jobs.route_order cannot represent physical stop interleaving. Each routable
 * job is therefore positioned by the first occurrence of its first physical
 * stop in the optimized route. Existing lane order is the deterministic
 * tiebreaker for shared/unmatched entry locations. Unroutable jobs remain
 * after all routable jobs in their existing order.
 */
export function jobsInFastPlotOrder(
  jobs: PlanJob[],
  route: LatLng[]
): string[] {
  const firstRouteIndex = new Map<string, number>();

  for (let index = 0; index < route.length; index++) {
    const key = pointKey(route[index]);

    if (!firstRouteIndex.has(key)) {
      firstRouteIndex.set(key, index);
    }
  }

  const routable = jobs
    .map((job, laneIndex) => {
      if (!isRoutable(job)) return null;

      const firstStop = sortedStops(job)[0];
      const routeIndex = firstStop
        ? firstRouteIndex.get(pointKey(stopPoint(firstStop)))
        : undefined;

      return {
        id: job.id,
        laneIndex,
        routeIndex:
          routeIndex === undefined
            ? Number.POSITIVE_INFINITY
            : routeIndex,
      };
    })
    .filter(
      (
        value
      ): value is {
        id: string;
        laneIndex: number;
        routeIndex: number;
      } => value !== null
    )
    .sort((left, right) => {
      if (left.routeIndex !== right.routeIndex) {
        return left.routeIndex - right.routeIndex;
      }

      return left.laneIndex - right.laneIndex;
    })
    .map((value) => value.id);

  const unroutable = jobs
    .filter((job) => !isRoutable(job))
    .map((job) => job.id);

  return [...routable, ...unroutable];
}


export async function optimizeFastPlotOrderFromStart(
  jobs: PlanJob[],
  startPoint: LatLng,
  loadCosts: FastPlotCostLoader
): Promise<AnchoredFastPlotResult> {
  if (
    requiresPhysicalRevisit(jobs) ||
    hasPhysicalPrecedenceCycle(jobs)
  ) {
    return { ok: false, reason: "unsupported_physical_route" };
  }

  const visits = buildFastPlotVisits(jobs);

  if (visits.length === 0) {
    return { ok: false, reason: "no_routable_visits" };
  }

  const counts = jobStopCounts(jobs);
  const first = await chooseAnchoredFirstVisit(
    visits,
    counts,
    startPoint,
    loadCosts
  );

  if (!first.ok) {
    return first;
  }

  if (visits.length === 1) {
    return {
      ok: true,
      route: [first.visit.point],
      firstTravelSeconds: first.travelSeconds,
    };
  }

  let route: LatLng[] | null;

  if (visits.length > FAST_PLOT_COMPLETE_MATRIX_MAX_VISITS) {
    route = await sparseFastPlotOrder(
      visits,
      counts,
      loadCosts,
      first.visit
    );
  } else {
    const table = await loadFastPlotCostTable(
      visits,
      loadCosts
    );

    if (!table) {
      return { ok: false, reason: "route_cost_unavailable" };
    }

    route = await beamSearchFastPlotOrder(
      visits,
      counts,
      table,
      first.visit
    );
  }

  if (!route || route.length !== visits.length) {
    return { ok: false, reason: "route_cost_unavailable" };
  }

  return {
    ok: true,
    route,
    firstTravelSeconds: first.travelSeconds,
  };
}

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

  if (visits.length > FAST_PLOT_COMPLETE_MATRIX_MAX_VISITS) {
    const optimized = await sparseFastPlotOrder(
      visits,
      counts,
      loadCosts
    );

    return optimized ?? fallbackFastPlotOrder(jobs);
  }

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
