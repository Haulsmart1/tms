import type {
  FastPlotVisit,
} from "./fastPlot";

export type MasterRouteGraphNode = {
  visit: FastPlotVisit;
  predecessors: ReadonlySet<string>;
  successors: ReadonlySet<string>;
};

export type MasterRouteGraph = {
  nodes: ReadonlyMap<string, MasterRouteGraphNode>;
  visitCount: number;
  edgeCount: number;
};

export type MasterRouteBuildResult =
  | {
      ok: true;
      route: FastPlotVisit[];
      graph: MasterRouteGraph;
    }
  | {
      ok: false;
      reason:
        | "duplicate_visit_key"
        | "invalid_requirement"
        | "precedence_cycle";
    };

type MutableGraphNode = {
  visit: FastPlotVisit;
  predecessors: Set<string>;
  successors: Set<string>;
};

type JobRequirement = {
  visitKey: string;
  stopIndex: number;
};

function compareVisitKeys(
  left: FastPlotVisit,
  right: FastPlotVisit
): number {
  return left.key.localeCompare(right.key);
}

function collectJobRequirements(
  visits: FastPlotVisit[]
): Map<string, JobRequirement[]> | null {
  const requirementsByJob =
    new Map<string, JobRequirement[]>();

  for (const visit of visits) {
    for (
      const [
        jobId,
        stopIndexes,
      ] of Object.entries(
        visit.requirements
      )
    ) {
      for (const stopIndex of stopIndexes) {
        if (
          !Number.isInteger(stopIndex) ||
          stopIndex < 0
        ) {
          return null;
        }

        const requirements =
          requirementsByJob.get(jobId) ?? [];

        requirements.push({
          visitKey: visit.key,
          stopIndex,
        });

        requirementsByJob.set(
          jobId,
          requirements
        );
      }
    }
  }

  return requirementsByJob;
}

function addEdge(
  nodes: Map<string, MutableGraphNode>,
  fromKey: string,
  toKey: string
): boolean {
  if (fromKey === toKey) {
    return false;
  }

  const from = nodes.get(fromKey);
  const to = nodes.get(toKey);

  if (!from || !to) {
    return false;
  }

  if (from.successors.has(toKey)) {
    return false;
  }

  from.successors.add(toKey);
  to.predecessors.add(fromKey);

  return true;
}

export function buildMasterRouteGraph(
  visits: FastPlotVisit[]
): MasterRouteGraph | null {
  const nodes =
    new Map<string, MutableGraphNode>();

  for (const visit of visits) {
    if (nodes.has(visit.key)) {
      return null;
    }

    nodes.set(visit.key, {
      visit,
      predecessors: new Set<string>(),
      successors: new Set<string>(),
    });
  }

  const requirementsByJob =
    collectJobRequirements(visits);

  if (!requirementsByJob) {
    return null;
  }

  let edgeCount = 0;

  for (
    const requirements
    of requirementsByJob.values()
  ) {
    requirements.sort(
      (left, right) =>
        left.stopIndex -
          right.stopIndex ||
        left.visitKey.localeCompare(
          right.visitKey
        )
    );

    /*
     * A physical visit may satisfy consecutive stops for one job. Collapse
     * those requirements before adding precedence edges so a shared physical
     * location never creates a self-edge.
     */
    const orderedVisitKeys: string[] = [];

    for (const requirement of requirements) {
      if (
        orderedVisitKeys.at(-1) !==
        requirement.visitKey
      ) {
        orderedVisitKeys.push(
          requirement.visitKey
        );
      }
    }

    for (
      let index = 1;
      index < orderedVisitKeys.length;
      index++
    ) {
      if (
        addEdge(
          nodes,
          orderedVisitKeys[index - 1],
          orderedVisitKeys[index]
        )
      ) {
        edgeCount++;
      }
    }
  }

  return {
    nodes,
    visitCount: nodes.size,
    edgeCount,
  };
}

export function routeMaintainsMasterPrecedence(
  route: FastPlotVisit[],
  graph: MasterRouteGraph
): boolean {
  if (
    route.length !== graph.visitCount
  ) {
    return false;
  }

  const positions =
    new Map<string, number>();

  for (
    let index = 0;
    index < route.length;
    index++
  ) {
    const key = route[index].key;

    if (
      positions.has(key) ||
      !graph.nodes.has(key)
    ) {
      return false;
    }

    positions.set(key, index);
  }

  for (
    const [
      key,
      node,
    ] of graph.nodes
  ) {
    const position = positions.get(key);

    if (position === undefined) {
      return false;
    }

    for (
      const predecessor
      of node.predecessors
    ) {
      const predecessorPosition =
        positions.get(predecessor);

      if (
        predecessorPosition === undefined ||
        predecessorPosition >= position
      ) {
        return false;
      }
    }
  }

  return true;
}

export type MasterRoutePoint = {
  lat: number;
  lng: number;
};

export type GeographicMasterRouteOptions = {
  start: MasterRoutePoint;
};

function masterRouteHaversineKm(
  left: MasterRoutePoint,
  right: MasterRoutePoint
): number {
  const earthRadiusKm = 6371;

  const toRadians = (
    degrees: number
  ): number =>
    (degrees * Math.PI) / 180;

  const latitudeDelta = toRadians(
    right.lat - left.lat
  );

  const longitudeDelta = toRadians(
    right.lng - left.lng
  );

  const leftLatitude = toRadians(
    left.lat
  );

  const rightLatitude = toRadians(
    right.lat
  );

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    earthRadiusKm *
    2 *
    Math.atan2(
      Math.sqrt(haversine),
      Math.sqrt(1 - haversine)
    )
  );
}

function backboneInsertionCostKm(
  previous: MasterRoutePoint,
  candidate: MasterRoutePoint,
  next: MasterRoutePoint
): number {
  return (
    masterRouteHaversineKm(
      previous,
      candidate
    ) +
    masterRouteHaversineKm(
      candidate,
      next
    ) -
    masterRouteHaversineKm(
      previous,
      next
    )
  );
}

function chooseMandatoryTerminal(
  graph: MasterRouteGraph
): FastPlotVisit | null {
  let chosen: MasterRouteGraphNode | null =
    null;

  const minimumTerminalFanIn = 8;

  for (
    const node
    of graph.nodes.values()
  ) {
    if (
      node.successors.size !== 0 ||
      node.predecessors.size <
        minimumTerminalFanIn
    ) {
      continue;
    }

    if (
      !chosen ||
      node.predecessors.size >
        chosen.predecessors.size ||
      (
        node.predecessors.size ===
          chosen.predecessors.size &&
        node.visit.key.localeCompare(
          chosen.visit.key
        ) < 0
      )
    ) {
      chosen = node;
    }
  }

  return chosen?.visit ?? null;
}

function buildGeographicBackbone(
  visits: FastPlotVisit[],
  start: MasterRoutePoint,
  terminal: FastPlotVisit | null
): FastPlotVisit[] {
  if (visits.length === 0) {
    return [];
  }

  const remaining =
    new Map<string, FastPlotVisit>();

  for (const visit of visits) {
    if (
      terminal &&
      visit.key === terminal.key
    ) {
      continue;
    }

    remaining.set(
      visit.key,
      visit
    );
  }

  if (terminal) {
    const route: FastPlotVisit[] = [
      terminal,
    ];

    const nearestBackboneKm =
      new Map<string, number>();

    for (
      const visit
      of remaining.values()
    ) {
      nearestBackboneKm.set(
        visit.key,
        Math.min(
          masterRouteHaversineKm(
            start,
            visit.point
          ),
          masterRouteHaversineKm(
            terminal.point,
            visit.point
          )
        )
      );
    }

    while (remaining.size > 0) {
      let selected:
        FastPlotVisit | null = null;

      let selectedDistance =
        Number.NEGATIVE_INFINITY;

      for (
        const candidate
        of remaining.values()
      ) {
        const distance =
          nearestBackboneKm.get(
            candidate.key
          ) ??
          Number.NEGATIVE_INFINITY;

        if (
          !selected ||
          distance >
            selectedDistance ||
          (
            distance ===
              selectedDistance &&
            candidate.key.localeCompare(
              selected.key
            ) < 0
          )
        ) {
          selected = candidate;
          selectedDistance = distance;
        }
      }

      if (!selected) {
        break;
      }

      let bestInsertionIndex = 0;
      let bestInsertionCost =
        Number.POSITIVE_INFINITY;

      for (
        let insertionIndex = 0;
        insertionIndex < route.length;
        insertionIndex++
      ) {
        const previous =
          insertionIndex === 0
            ? start
            : route[
                insertionIndex - 1
              ].point;

        const next =
          route[
            insertionIndex
          ].point;

        const cost =
          backboneInsertionCostKm(
            previous,
            selected.point,
            next
          );

        if (
          cost <
            bestInsertionCost ||
          (
            cost ===
              bestInsertionCost &&
            insertionIndex <
              bestInsertionIndex
          )
        ) {
          bestInsertionIndex =
            insertionIndex;

          bestInsertionCost =
            cost;
        }
      }

      route.splice(
        bestInsertionIndex,
        0,
        selected
      );

      remaining.delete(
        selected.key
      );

      nearestBackboneKm.delete(
        selected.key
      );

      for (
        const candidate
        of remaining.values()
      ) {
        const existing =
          nearestBackboneKm.get(
            candidate.key
          ) ??
          Number.POSITIVE_INFINITY;

        const distance =
          masterRouteHaversineKm(
            selected.point,
            candidate.point
          );

        if (distance < existing) {
          nearestBackboneKm.set(
            candidate.key,
            distance
          );
        }
      }
    }

    return route;
  }

  let first: FastPlotVisit | null =
    null;

  let firstDistance =
    Number.POSITIVE_INFINITY;

  for (
    const visit
    of remaining.values()
  ) {
    const distance =
      masterRouteHaversineKm(
        start,
        visit.point
      );

    if (
      !first ||
      distance < firstDistance ||
      (
        distance === firstDistance &&
        visit.key.localeCompare(
          first.key
        ) < 0
      )
    ) {
      first = visit;
      firstDistance = distance;
    }
  }

  if (!first) {
    return [];
  }

  const route: FastPlotVisit[] = [
    first,
  ];

  remaining.delete(first.key);

  const nearestBackboneKm =
    new Map<string, number>();

  for (
    const visit
    of remaining.values()
  ) {
    nearestBackboneKm.set(
      visit.key,
      Math.min(
        masterRouteHaversineKm(
          start,
          visit.point
        ),
        masterRouteHaversineKm(
          first.point,
          visit.point
        )
      )
    );
  }

  while (remaining.size > 0) {
    let selected:
      FastPlotVisit | null = null;

    let selectedDistance =
      Number.NEGATIVE_INFINITY;

    for (
      const candidate
      of remaining.values()
    ) {
      const distance =
        nearestBackboneKm.get(
          candidate.key
        ) ??
        Number.NEGATIVE_INFINITY;

      if (
        !selected ||
        distance >
          selectedDistance ||
        (
          distance ===
            selectedDistance &&
          candidate.key.localeCompare(
            selected.key
          ) < 0
        )
      ) {
        selected = candidate;
        selectedDistance = distance;
      }
    }

    if (!selected) {
      break;
    }

    let bestInsertionIndex = 0;
    let bestInsertionCost =
      Number.POSITIVE_INFINITY;

    for (
      let insertionIndex = 0;
      insertionIndex <= route.length;
      insertionIndex++
    ) {
      const previous =
        insertionIndex === 0
          ? start
          : route[
              insertionIndex - 1
            ].point;

      if (
        insertionIndex ===
        route.length
      ) {
        const cost =
          masterRouteHaversineKm(
            previous,
            selected.point
          );

        if (
          cost <
            bestInsertionCost ||
          (
            cost ===
              bestInsertionCost &&
            insertionIndex <
              bestInsertionIndex
          )
        ) {
          bestInsertionIndex =
            insertionIndex;

          bestInsertionCost =
            cost;
        }

        continue;
      }

      const next =
        route[
          insertionIndex
        ].point;

      const cost =
        backboneInsertionCostKm(
          previous,
          selected.point,
          next
        );

      if (
        cost <
          bestInsertionCost ||
        (
          cost ===
            bestInsertionCost &&
          insertionIndex <
            bestInsertionIndex
        )
      ) {
        bestInsertionIndex =
          insertionIndex;

        bestInsertionCost =
          cost;
      }
    }

    route.splice(
      bestInsertionIndex,
      0,
      selected
    );

    remaining.delete(
      selected.key
    );

    nearestBackboneKm.delete(
      selected.key
    );

    for (
      const candidate
      of remaining.values()
    ) {
      const existing =
        nearestBackboneKm.get(
          candidate.key
        ) ??
        Number.POSITIVE_INFINITY;

      const distance =
        masterRouteHaversineKm(
          selected.point,
          candidate.point
        );

      if (distance < existing) {
        nearestBackboneKm.set(
          candidate.key,
          distance
        );
      }
    }
  }

  return route;
}

function buildBackboneRank(
  backbone: FastPlotVisit[]
): ReadonlyMap<string, number> {
  const rank =
    new Map<string, number>();

  backbone.forEach(
    (visit, index) => {
      rank.set(
        visit.key,
        index
      );
    }
  );

  return rank;
}

export function buildGeographicMasterRoute(
  visits: FastPlotVisit[],
  options: GeographicMasterRouteOptions
): MasterRouteBuildResult {
  const graph =
    buildMasterRouteGraph(visits);

  if (!graph) {
    return buildMasterRoute(visits);
  }

  const terminal =
    chooseMandatoryTerminal(
      graph
    );

  const backbone =
    buildGeographicBackbone(
      visits,
      options.start,
      terminal
    );

  if (
    backbone.length !==
    graph.visitCount
  ) {
    return {
      ok: false,
      reason: "precedence_cycle",
    };
  }

  const backboneRank =
    buildBackboneRank(
      backbone
    );

  const indegree =
    new Map<string, number>();

  for (
    const [key, node]
    of graph.nodes
  ) {
    indegree.set(
      key,
      node.predecessors.size
    );
  }

  const eligible =
    new Map<string, FastPlotVisit>();

  for (
    const node
    of graph.nodes.values()
  ) {
    if (
      node.predecessors.size === 0
    ) {
      eligible.set(
        node.visit.key,
        node.visit
      );
    }
  }

  const route: FastPlotVisit[] = [];

  while (eligible.size > 0) {
    let chosen:
      FastPlotVisit | null = null;

    let chosenRank =
      Number.POSITIVE_INFINITY;

    for (
      const candidate
      of eligible.values()
    ) {
      const rank =
        backboneRank.get(
          candidate.key
        ) ??
        Number.POSITIVE_INFINITY;

      if (
        !chosen ||
        rank < chosenRank ||
        (
          rank === chosenRank &&
          candidate.key.localeCompare(
            chosen.key
          ) < 0
        )
      ) {
        chosen = candidate;
        chosenRank = rank;
      }
    }

    if (!chosen) {
      break;
    }

    eligible.delete(
      chosen.key
    );

    route.push(chosen);

    const node =
      graph.nodes.get(
        chosen.key
      );

    if (!node) {
      return {
        ok: false,
        reason: "precedence_cycle",
      };
    }

    for (
      const successorKey
      of node.successors
    ) {
      const remaining =
        (
          indegree.get(
            successorKey
          ) ?? 0
        ) - 1;

      indegree.set(
        successorKey,
        remaining
      );

      if (remaining !== 0) {
        continue;
      }

      const successor =
        graph.nodes.get(
          successorKey
        );

      if (successor) {
        eligible.set(
          successorKey,
          successor.visit
        );
      }
    }
  }

  if (
    route.length !==
      graph.visitCount ||
    !routeMaintainsMasterPrecedence(
      route,
      graph
    )
  ) {
    return {
      ok: false,
      reason: "precedence_cycle",
    };
  }

  return {
    ok: true,
    route,
    graph,
  };
}
export function buildMasterRoute(
  visits: FastPlotVisit[]
): MasterRouteBuildResult {
  const graph =
    buildMasterRouteGraph(visits);

  if (!graph) {
    const keys = new Set<string>();

    for (const visit of visits) {
      if (keys.has(visit.key)) {
        return {
          ok: false,
          reason: "duplicate_visit_key",
        };
      }

      keys.add(visit.key);

      for (
        const stopIndexes
        of Object.values(
          visit.requirements
        )
      ) {
        for (const stopIndex of stopIndexes) {
          if (
            !Number.isInteger(stopIndex) ||
            stopIndex < 0
          ) {
            return {
              ok: false,
              reason: "invalid_requirement",
            };
          }
        }
      }
    }

    return {
      ok: false,
      reason: "invalid_requirement",
    };
  }

  const indegree =
    new Map<string, number>();

  for (
    const [key, node]
    of graph.nodes
  ) {
    indegree.set(
      key,
      node.predecessors.size
    );
  }

  let eligible =
    [...graph.nodes.values()]
      .filter(
        (node) =>
          node.predecessors.size === 0
      )
      .map((node) => node.visit)
      .sort(compareVisitKeys);

  const route: FastPlotVisit[] = [];

  while (eligible.length > 0) {
    const chosen = eligible.shift();

    if (!chosen) {
      break;
    }

    route.push(chosen);

    const node =
      graph.nodes.get(chosen.key);

    if (!node) {
      return {
        ok: false,
        reason: "precedence_cycle",
      };
    }

    for (const successorKey of node.successors) {
      const remaining =
        (indegree.get(successorKey) ?? 0) -
        1;

      indegree.set(
        successorKey,
        remaining
      );

      if (remaining === 0) {
        const successor =
          graph.nodes.get(
            successorKey
          );

        if (successor) {
          eligible.push(
            successor.visit
          );
        }
      }
    }

    eligible.sort(compareVisitKeys);
  }

  if (
    route.length !== graph.visitCount ||
    !routeMaintainsMasterPrecedence(
      route,
      graph
    )
  ) {
    return {
      ok: false,
      reason: "precedence_cycle",
    };
  }

  return {
    ok: true,
    route,
    graph,
  };
}