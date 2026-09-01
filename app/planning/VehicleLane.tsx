"use client";

import type { DragEvent } from "react";
import PlanJobCard, { JOB_ID_MIME } from "./PlanJobCard";
import type { PlanJob } from "../../lib/planning/types";
import type { PlanningCompliance } from "../../lib/planning/compliance";
import {
  regimeLabel,
  type LaneRegimeSummary,
} from "../../lib/planning/laneRegime";
import { formatDuration } from "../../lib/planning/format";

type Props = {
  vehicle: { id: string; registration: string };
  jobs: PlanJob[];
  driverId: string | null;
  drivers: { id: string; name: string }[];
  selected: boolean;
  /** e.g. "3 jobs · 92 km · 2 h 41 m", or null before this lane has a route. */
  summary: string | null;
  regimeSummary: LaneRegimeSummary;
  compliance: PlanningCompliance;
  geocodeSettled: boolean;
  /** True when the lane's jobs arrived carrying more than one distinct driver,
      so the single lane driver above is a normalisation the user should see. */
  driverConflict?: boolean;
  onSelect: () => void;
  onDriverChange: (driverId: string | null) => void;
  onOpenJob: (jobId: string) => void;
  onAcceptJob: (jobId: string) => void;
  /** beforeJobId null means append to the end of the lane. */
  onDropJob: (draggedJobId: string, beforeJobId: string | null) => void;
};

export default function VehicleLane({
  vehicle, jobs, driverId, drivers, selected, summary, regimeSummary,
  compliance,
  geocodeSettled, driverConflict, onSelect, onDriverChange, onOpenJob,
  onAcceptJob, onDropJob,
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

      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded border border-line bg-surface px-1.5 py-0.5 text-ink-2">
          {regimeSummary.status === "mixed"
            ? "Mixed regimes"
            : regimeLabel(regimeSummary.regime)}
        </span>

        {regimeSummary.reviewRequired ? (
          <span
            className="rounded border border-line px-1.5 py-0.5 text-warning"
            title="One or more jobs have incomplete regime facts or missing required classification metadata."
          >
            Review required
          </span>
        ) : null}

        {regimeSummary.hasOverrides ? (
          <span
            className="rounded border border-line px-1.5 py-0.5 text-ink-2"
            title="One or more job classifications use a documented operator override."
          >
            Override
          </span>
        ) : null}

        {regimeSummary.warningCount > 0 ? (
          <span
            className="text-warning"
            title={`${regimeSummary.warningCount} regime classification warning${
              regimeSummary.warningCount === 1 ? "" : "s"
            }`}
          >
            {regimeSummary.warningCount} regime warning
            {regimeSummary.warningCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      <div className="mb-2 rounded-md border border-line bg-surface p-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={`text-xs font-semibold ${
              compliance.status === "warning"
                ? "text-warning"
                : compliance.status === "incomplete"
                  ? "text-ink-3"
                  : "text-ink-2"
            }`}
          >
            Wizard: {compliance.statusLabel}
          </span>

          <span className="text-xs text-ink-2">
            Planned drive{" "}
            {compliance.plannedDrivingSeconds === null
              ? "route pending"
              : formatDuration(compliance.plannedDrivingSeconds)}
          </span>

          <span className="text-xs text-ink-3">
            Actual drive{" "}
            {compliance.dataComplete
              ? "available"
              : "no activity data"}
          </span>

          <span className="text-xs text-ink-3">
            Break due{" "}
            {compliance.dataComplete
              ? "calculated"
              : "cannot calculate"}
          </span>

          <span className="text-xs text-ink-3">
            WTD{" "}
            {compliance.dataComplete
              ? "calculated"
              : "cannot calculate"}
          </span>
        </div>

        {compliance.warnings.length > 0 ? (
          <p className="mt-1 text-xs text-warning">
            {compliance.warnings.join(" ? ")}
          </p>
        ) : null}

        {compliance.missing.length > 0 ? (
          <p className="mt-1 text-xs text-ink-3">
            Missing: {compliance.missing.join(" ? ")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-stretch gap-2">
        {jobs.map((job, index) => (
          <PlanJobCard
            key={job.id}
            job={job}
            sequence={index + 1}
            geocodeSettled={geocodeSettled}
            onOpen={onOpenJob}
            onAccept={onAcceptJob}
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
