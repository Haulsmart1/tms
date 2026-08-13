import type { ReactNode } from "react";
import DataTable, { type Column } from "../../components/DataTable";
import Badge from "../../components/Badge";
import RouteProgress from "../../components/RouteProgress";
import { waitingLabel, type QueueRow } from "../../lib/pod/queue";
import { routeNodes } from "../../lib/pod/routeNodes";

/* Every width is fixed and they sum to 1056. A single flexible column would
   absorb all leftover width and open a large gap mid-row, which is exactly the
   bug this layout was redesigned to remove. Free-text cells truncate rather
   than overflow into the next column. */
const WIDTHS = {
  job: "84px",
  route: "320px",
  progress: "92px",
  vehicle: "232px",
  evidence: "128px",
  status: "200px",
} as const;

function EvidenceDot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`block text-xs ${on ? "text-success-strong" : "text-ink-4"}`}>
      <span aria-hidden>{on ? "●" : "○"}</span>{" "}
      <span className="sr-only">{on ? `${label} attached` : `${label} missing`}</span>
      <span aria-hidden>{label}</span>
    </span>
  );
}

export function podColumns(): Column<QueueRow>[] {
  return [
    {
      header: "Job",
      width: WIDTHS.job,
      cell: (r) => <span className="font-mono text-data tabular-nums text-ink">{r.jobReference}</span>,
    },
    {
      header: "Route",
      width: WIDTHS.route,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate text-sm text-ink">
            {r.originCity ? `${r.originCity} → ${r.destinationCity}` : r.destinationCity}
          </span>
          <span className="block truncate font-mono text-data-sm text-ink-3">
            {[r.destinationPostcode, r.dropCount > 1 ? `${r.dropCount} drops` : null, r.customerName]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      ),
    },
    {
      header: "Progress",
      width: WIDTHS.progress,
      cell: (r) => {
        const { nodes, arrowState } = routeNodes(r.stops, r.stopId, r.isOverdue);
        return (
          <RouteProgress
            nodes={nodes}
            arrowState={arrowState}
            label={`${r.originCity ?? "origin"} to ${r.destinationCity}, ${nodes.length} stops, ${
              arrowState === "delivered" ? "delivered" : arrowState === "overdue" ? "overdue" : "awaiting POD"
            }`}
          />
        );
      },
    },
    {
      header: "Vehicle & driver",
      width: WIDTHS.vehicle,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-mono text-data text-ink">
            {r.vehicleRegistration ?? "—"}
          </span>
          <span className="block truncate text-xs text-ink-3">
            {[r.vehicleModel, r.driverName].filter(Boolean).join(" · ") || "Unassigned"}
          </span>
        </span>
      ),
    },
    {
      header: "Evidence",
      width: WIDTHS.evidence,
      cell: (r) => (
        <span className="block">
          <EvidenceDot on={r.hasPhoto} label="photo" />
          <EvidenceDot on={r.hasDocument} label="doc" />
        </span>
      ),
    },
    {
      header: "Status",
      width: WIDTHS.status,
      align: "right",
      cell: (r) => (
        <span className="block">
          <Badge tone={r.isOverdue ? "danger" : r.deliveredAt ? "success" : "warning"}>
            {r.deliveredAt ? "Delivered" : r.isOverdue ? "Overdue" : "Pending"}
          </Badge>
          <span
            className={`mt-0.5 block font-mono text-data-sm tabular-nums ${
              r.isOverdue ? "text-danger-strong" : "text-ink-3"
            }`}
          >
            {waitingLabel(r.ageHours)}
          </span>
        </span>
      ),
    },
  ];
}

type Props = {
  rows: QueueRow[];
  state: "loading" | "error" | "empty" | "ready";
  expandedStopId: string | null;
  onRowClick: (row: QueueRow) => void;
  renderExpanded: (row: QueueRow) => ReactNode;
  onRetry: () => void;
  emptyTitle: string;
};

export default function PodQueue({
  rows, state, expandedStopId, onRowClick, renderExpanded, onRetry, emptyTitle,
}: Props) {
  return (
    <DataTable
      columns={podColumns()}
      rows={rows}
      rowKey={(r) => r.stopId}
      state={state}
      onRowClick={onRowClick}
      expandedKey={expandedStopId}
      renderExpanded={renderExpanded}
      onRetry={onRetry}
      errorMessage="Couldn't load proof of delivery."
      emptyTitle={emptyTitle}
    />
  );
}
