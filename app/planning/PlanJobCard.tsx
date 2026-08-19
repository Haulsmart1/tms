"use client";

import type { DragEvent } from "react";
import { isRoutable, sortedStops } from "../../lib/planning/waypoints";
import type { PlanJob } from "../../lib/planning/types";

type Props = {
  job: PlanJob;
  /** 1-based position in its lane; null in the unassigned pool. */
  sequence: number | null;
  /** True once geocoding has been attempted, so the badge means "failed",
      never "still loading". */
  geocodeSettled: boolean;
  /** Set when this job arrived assigned to a now-inactive vehicle; saving any
      change to the plan will clear that assignment. */
  note?: string;
  onDropBefore?: (draggedJobId: string) => void;
};

export const JOB_ID_MIME = "text/plain";

export default function PlanJobCard({ job, sequence, geocodeSettled, note, onDropBefore }: Props) {
  const stops = sortedStops(job);
  const first = stops[0];
  const last = stops[stops.length - 1];
  const placeSummary =
    stops.length === 0
      ? "No stops"
      : `${stops.length} ${stops.length === 1 ? "stop" : "stops"} · ${first.city ?? first.postcode ?? "?"}${
          stops.length > 1 ? ` → ${last.city ?? last.postcode ?? "?"}` : ""
        }`;
  const warn = geocodeSettled && !isRoutable(job);

  function handleDragStart(e: DragEvent) {
    e.dataTransfer.setData(JOB_ID_MIME, job.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: DragEvent) {
    if (onDropBefore) e.preventDefault();
  }

  function handleDrop(e: DragEvent) {
    if (!onDropBefore) return;
    e.preventDefault();
    e.stopPropagation(); // the lane's own drop handler would otherwise append
    const draggedId = e.dataTransfer.getData(JOB_ID_MIME);
    if (draggedId && draggedId !== job.id) onDropBefore(draggedId);
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="cursor-grab rounded-md border border-line bg-surface px-2.5 py-2 text-sm shadow-sm active:cursor-grabbing"
    >
      <p className="font-semibold text-ink">
        {sequence !== null ? `${sequence} · ` : ""}
        {job.reference ?? "No reference"}
        {warn ? (
          <span
            className="ml-1.5 rounded border border-line px-1 text-xs font-normal text-warning"
            title="One or more stops could not be geocoded; this job is excluded from the route."
          >
            no map fix
          </span>
        ) : null}
        {note ? (
          <span
            className="ml-1.5 rounded border border-line px-1 text-xs font-normal text-warning"
            title="This job arrived assigned to an inactive vehicle. Saving any change to the plan will clear that assignment."
          >
            {note}
          </span>
        ) : null}
      </p>
      <p className="text-xs text-ink-3">
        {job.customer_name ?? "No customer"} · {placeSummary}
      </p>
    </div>
  );
}
