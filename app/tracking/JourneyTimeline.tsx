import type { JourneyNode } from "../../lib/tracking/journey";

type Props = { nodes: JourneyNode[]; note: string };

const DOT: Record<"done" | "current" | "upcoming", string> = {
  done: "bg-success border-success",
  current: "bg-primary border-primary-tint-border",
  upcoming: "bg-surface border-line-strong",
};

export default function JourneyTimeline({ nodes, note }: Props) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <header className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <h2 className="flex-1 text-sm font-semibold text-ink">Journey</h2>
        <span className="text-xs text-ink-3">{note}</span>
      </header>

      <ol className="m-0 list-none px-5 py-4">
        {nodes.map((node, i) => {
          const last = i === nodes.length - 1;

          if (node.kind === "live") {
            return (
              <li key={node.id} className="grid grid-cols-[22px_minmax(0,1fr)] gap-3.5">
                <div className="flex flex-col items-center">
                  <span aria-hidden className="ds-pulse block h-3 w-3 rounded-full border-2 border-primary-tint-border bg-primary" />
                  {last ? null : <span aria-hidden className="w-0 flex-1 border-l-2 border-dotted border-line-strong" />}
                </div>
                <div className="min-w-0 pb-4">
                  <span className="inline-flex items-center gap-2 rounded-sm border border-primary-tint-border bg-primary-tint px-2.5 py-1.5">
                    <span className="font-mono text-data-sm tabular-nums text-primary-deep">{node.speedLabel}</span>
                    <span aria-hidden className="block h-3 w-px bg-primary-tint-border" />
                    <span className="text-xs text-primary-deep">{node.pingLabel}</span>
                  </span>
                </div>
              </li>
            );
          }

          return (
            <li key={node.id} className="grid grid-cols-[22px_minmax(0,1fr)] gap-3.5">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={`mt-1 block h-2.5 w-2.5 flex-none rounded-full border-2 ${DOT[node.state]}`}
                />
                {last ? null : (
                  <span
                    aria-hidden
                    className={`mt-1 w-0 flex-1 border-l-2 ${
                      node.state === "done" ? "border-solid border-success-border" : "border-dotted border-line-strong"
                    }`}
                  />
                )}
              </div>

              <div className="min-w-0 pb-4">
                <div className="flex items-baseline gap-2.5">
                  <span className="min-w-0 truncate text-sm font-semibold text-ink">{node.label}</span>
                  <span className="flex-1" />
                  <span className="whitespace-nowrap font-mono text-data-sm tabular-nums text-ink-2">
                    {node.when}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-3">
                  {node.caption}
                  {node.addressLine ? ` · ${node.addressLine}` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
