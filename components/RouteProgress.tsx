import type { ArrowState, RouteNode } from "../lib/pod/routeNodes";

/* The plotted-route motif from the design system, as a status glyph.

   Fixed width by design: a four-stop job compresses its dotted spans rather
   than widening the column, so the table cannot reflow when a job has more
   stops. That is what lets every column be a fixed width, which is what stops
   a gap opening anywhere in the row. */

const NODE_FILL: Record<RouteNode["state"], string> = {
  done: "bg-success",
  current: "bg-surface",
  upcoming: "bg-surface",
};

const NODE_RING: Record<RouteNode["state"], string> = {
  done: "border-success",
  current: "border-warning",
  upcoming: "border-line-strong",
};

const ARROW: Record<ArrowState, string> = {
  pending: "border-l-warning",
  overdue: "border-l-danger",
  delivered: "border-l-success",
};

type Props = {
  nodes: RouteNode[];
  arrowState: ArrowState;
  /** Describes the route for screen readers, e.g. "Leeds to Hull, stop 2 of 2, awaiting POD". */
  label: string;
};

export default function RouteProgress({ nodes, arrowState, label }: Props) {
  return (
    <span role="img" aria-label={label} className="flex w-[68px] items-center">
      {nodes.map((node, i) => (
        <span key={node.id} className="flex flex-1 items-center last:flex-none">
          <span
            className={`h-2 w-2 flex-none rounded-full border-2 ${NODE_FILL[node.state]} ${NODE_RING[node.state]}`}
          />
          {i < nodes.length - 1 ? (
            <span
              className={`h-0 flex-1 border-t-2 border-dotted ${
                node.state === "done" ? "border-success-border" : "border-line-strong"
              }`}
            />
          ) : null}
        </span>
      ))}
      <span
        aria-hidden
        className={`ml-0.5 h-0 w-0 flex-none border-y-[5px] border-l-[8px] border-y-transparent ${ARROW[arrowState]}`}
      />
    </span>
  );
}
