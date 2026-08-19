"use client";

import type { DragEvent } from "react";
import PlanJobCard, { JOB_ID_MIME } from "./PlanJobCard";
import type { PlanJob } from "../../lib/planning/types";

type Props = {
  vehicle: { id: string; registration: string };
  jobs: PlanJob[];
  driverId: string | null;
  drivers: { id: string; name: string }[];
  selected: boolean;
  /** e.g. "3 jobs · 92 km · 2 h 41 m", or null before this lane has a route. */
  summary: string | null;
  geocodeSettled: boolean;
  /** True when the lane's jobs arrived carrying more than one distinct driver,
      so the single lane driver above is a normalisation the user should see. */
  driverConflict?: boolean;
  onSelect: () => void;
  onDriverChange: (driverId: string | null) => void;
  /** beforeJobId null means append to the end of the lane. */
  onDropJob: (draggedJobId: string, beforeJobId: string | null) => void;
};

export default function VehicleLane({
  vehicle, jobs, driverId, drivers, selected, summary, geocodeSettled,
  driverConflict, onSelect, onDriverChange, onDropJob,
}: Props) {
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(JOB_ID_MIME);
    if (draggedId) onDropJob(draggedId, null);
  }

  return (
    <section
      aria-label={`Route for ${vehicle.registration}`}
      onClick={onSelect}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`cursor-pointer rounded-lg border p-3 transition-colors ${
        selected ? "border-primary bg-surface" : "border-line bg-surface-2 hover:bg-surface"
      }`}
    >
      <header className="mb-2 flex items-center gap-3">
        <h3 className="text-sm font-semibold text-ink">{vehicle.registration}</h3>
        <select
          aria-label={`Driver for ${vehicle.registration}`}
          value={driverId ?? ""}
          onChange={(e) => onDriverChange(e.target.value || null)}
          onClick={(e) => e.stopPropagation()}
          className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-ink"
        >
          <option value="">No driver</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {driverConflict ? (
          <span
            className="rounded border border-line px-1 text-xs text-warning"
            title="Jobs in this lane arrived with different drivers. Saving applies the picked driver to every job in the lane."
          >
            mixed drivers
          </span>
        ) : null}
        <span className="ml-auto text-xs text-ink-3">
          {summary ?? `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}
        </span>
      </header>

      <div className="flex flex-wrap items-stretch gap-2">
        {jobs.map((job, index) => (
          <PlanJobCard
            key={job.id}
            job={job}
            sequence={index + 1}
            geocodeSettled={geocodeSettled}
            onDropBefore={(draggedId) => onDropJob(draggedId, job.id)}
          />
        ))}
        <div
          className="flex min-h-[52px] min-w-[110px] items-center justify-center rounded-md border border-dashed border-line px-2 text-xs text-ink-3"
          aria-hidden
        >
          drop a job here
        </div>
      </div>
    </section>
  );
}
