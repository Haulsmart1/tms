"use client";

import { useRef, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
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
  onOpen?: (jobId: string) => void;
  onAccept?: (jobId: string) => void;
};

export const JOB_ID_MIME = "text/plain";

export default function PlanJobCard({
  job,
  sequence,
  geocodeSettled,
  note,
  onDropBefore,
  onOpen,
  onAccept,
}: Props) {
  const dragged = useRef(false);
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
    dragged.current = true;
    e.dataTransfer.setData(JOB_ID_MIME, job.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragEnd() {
    window.setTimeout(() => {
      dragged.current = false;
    }, 0);
  }

  function handleClick(e: MouseEvent) {
    e.stopPropagation();

    if (dragged.current || !onOpen) {
      return;
    }

    onOpen(job.id);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!onOpen || (e.key !== "Enter" && e.key !== " ")) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    onOpen(job.id);
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
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
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

      {job.status === "pending_acceptance" ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="rounded border border-line px-1.5 py-0.5 text-xs text-warning">
            {sequence !== null
              ? "Assigned · Awaiting acceptance"
              : "Awaiting acceptance"}
          </span>

          {onAccept ? (
            <button
              type="button"
              draggable={false}
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink hover:bg-surface-2"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAccept(job.id);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              Accept
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
