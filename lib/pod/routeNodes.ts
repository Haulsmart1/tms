import type { PodStop } from "./queue";

export type NodeState = "done" | "current" | "upcoming";
export type ArrowState = "pending" | "overdue" | "delivered";

export type RouteNode = { id: string; state: NodeState };

/* The arrowhead carries the row's state by colour, so the Progress column reads
   as status from across the room before anyone parses the nodes. That is what
   keeps a motif on every row from becoming wallpaper. */
export function routeNodes(
  stops: PodStop[],
  focusedStopId: string,
  focusedIsOverdue: boolean,
): { nodes: RouteNode[]; arrowState: ArrowState } {
  const ordered = [...stops].sort((a, b) => a.stop_order - b.stop_order);

  /* Delivered is checked BEFORE focused, deliberately. On the Completed tab the
     focused stop is always delivered, and the focused-first order made its node
     render as in-progress while the arrowhead rendered as delivered: two status
     indicators disagreeing on every row. A delivered stop is done whether or
     not it is the one you have open. */
  const nodes: RouteNode[] = ordered.map((s) => ({
    id: s.id,
    state:
      s.pod_status === "delivered"
        ? "done"
        : s.id === focusedStopId
          ? "current"
          : "upcoming",
  }));

  /* If focusedStopId matches no stop the result degrades quietly: no node is
     current and the arrow falls back to overdue or pending. That should not be
     reachable, since callers pass a stop id taken from this same job, so it is
     recorded rather than guarded. */
  const focused = ordered.find((s) => s.id === focusedStopId);
  const arrowState: ArrowState =
    focused?.pod_status === "delivered" ? "delivered" : focusedIsOverdue ? "overdue" : "pending";

  return { nodes, arrowState };
}
