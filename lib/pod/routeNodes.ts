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

  const nodes: RouteNode[] = ordered.map((s) => ({
    id: s.id,
    state:
      s.id === focusedStopId
        ? "current"
        : s.pod_status === "delivered"
          ? "done"
          : "upcoming",
  }));

  const focused = ordered.find((s) => s.id === focusedStopId);
  const arrowState: ArrowState =
    focused?.pod_status === "delivered" ? "delivered" : focusedIsOverdue ? "overdue" : "pending";

  return { nodes, arrowState };
}
