"use client";

import { useId, useState, type DragEvent } from "react";
import CollectionEmailDialog from "./CollectionEmailDialog";
import type { CollectionEmailKind, CollectionEmailOptions } from "../../lib/planning/collectionEmail";
import PlanJobCard, { JOB_ID_MIME } from "./PlanJobCard";
import VehicleLabelPrinter from "./VehicleLabelPrinter";
import type { PlanJob } from "../../lib/planning/types";
import type { PlanningCompliance } from "../../lib/planning/compliance";
import {
  regimeLabel,
  type LaneRegimeSummary,
} from "../../lib/planning/laneRegime";
import { formatDuration } from "../../lib/planning/format";
import { jobsInCanonicalDropOrder } from "../../lib/planning/canonicalLaneOrder";

type Props = {
  vehicle: { id: string; registration: string };
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onMoveVehicle?: (offset: -1 | 1) => void;
  canMoveVehicleUp?: boolean;
  canMoveVehicleDown?: boolean;
  jobs: PlanJob[];
  completedJobs?: PlanJob[];
  planningDate?: string;
  emailEnabled?: boolean;
  canonicalDropNumbersByJobId?: Record<string, number[]>;
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
  onMoveJob: (jobId: string, offset: -1 | 1) => void;
  /** beforeJobId null means append to the end of the lane. */
  onDropJob: (draggedJobId: string, beforeJobId: string | null) => void;
};

export default function VehicleLane({
  vehicle, jobs, completedJobs = [], canonicalDropNumbersByJobId, driverId, drivers, selected, summary, regimeSummary,
  compliance,
  geocodeSettled, driverConflict, onSelect, onDriverChange, onOpenJob,
  onAcceptJob, onMoveJob, onDropJob, planningDate, emailEnabled = false,
  collapsed = false, onToggleCollapsed, onMoveVehicle, canMoveVehicleUp = false, canMoveVehicleDown = false,
}: Props) {
  const contentId = useId();
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [emailTarget, setEmailTarget] = useState<{ jobs: PlanJob[]; kind: CollectionEmailKind; window?: CollectionEmailOptions["window"] } | null>(null);
  const selectedOnVan = jobs.filter((job) => selectedJobs.has(job.id));
  const displayedJobs = jobsInCanonicalDropOrder(
    jobs,
    canonicalDropNumbersByJobId
  );
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
      className={`min-w-0 max-w-full cursor-pointer break-words [overflow-wrap:anywhere] rounded-lg border p-3 transition-colors ${
        selected ? "border-primary bg-surface" : "border-line bg-surface-2 hover:bg-surface"
      }`}
    >
      <header className="mb-2 flex min-w-0 flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-ink">{vehicle.registration}</h3>
        <div className="flex flex-wrap gap-2" onClick={event => event.stopPropagation()}>
          {onToggleCollapsed && <button type="button" aria-expanded={!collapsed} aria-controls={contentId}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${vehicle.registration}`}
            className="min-h-11 rounded-md border border-line px-3 text-sm text-ink" onClick={onToggleCollapsed}>
            {collapsed ? "Expand" : "Collapse"}
          </button>}
          {onMoveVehicle && <>
            <button type="button" aria-label={`Move ${vehicle.registration} up one level`} disabled={!canMoveVehicleUp}
              className="min-h-11 rounded-md border border-line px-3 text-sm text-ink disabled:opacity-40" onClick={() => onMoveVehicle(-1)}>↑ Up</button>
            <button type="button" aria-label={`Move ${vehicle.registration} down one level`} disabled={!canMoveVehicleDown}
              className="min-h-11 rounded-md border border-line px-3 text-sm text-ink disabled:opacity-40" onClick={() => onMoveVehicle(1)}>↓ Down</button>
          </>}
        </div>
        <select
          aria-label={`Driver for ${vehicle.registration}`}
          value={driverId ?? ""}
          onChange={(e) => onDriverChange(e.target.value || null)}
          onClick={(e) => e.stopPropagation()}
          className="min-h-11 min-w-0 w-full max-w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-ink sm:w-auto sm:max-w-[16rem]"
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
        <div
          className="flex min-w-0 w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto [&_button]:min-h-11"
          onClick={(event) => event.stopPropagation()}
        >
          <VehicleLabelPrinter
            vehicleRegistration={vehicle.registration}
            jobs={jobs}
          />
          <span className="text-xs text-ink-3">
            {summary ?? `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}
            {completedJobs.length > 0 ? ` · ${completedJobs.length} delivered` : ""}
          </span>
        </div>
      </header>

      <div id={contentId} hidden={collapsed}>
      {emailEnabled && jobs.length > 0 ? <div className="mb-3 flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm text-ink" onClick={() => setSelectedJobs(new Set(jobs.map((job) => job.id)))}>Select all on van</button>
        <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm text-ink" onClick={() => setSelectedJobs(new Set())}>Clear</button>
        <span className="text-sm text-ink-3">{selectedOnVan.length} selected</span>
        <button type="button" disabled={selectedOnVan.length === 0} className="min-h-11 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink disabled:opacity-40"
          onClick={() => setEmailTarget({ jobs: selectedOnVan, kind: "planned_window" })}>Email collection / delivery times</button>
      </div> : null}

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
            Driver hours: {compliance.statusLabel}
          </span>

          <span
            className="text-xs text-ink-2"
            title="Car-routing estimate without traffic between this lane's stops. HGV speeds, restrictions and travel to the first stop are not included."
          >
            Planned drive (car estimate){" "}
            {compliance.plannedDrivingSeconds === null
              ? "route pending"
              : formatDuration(compliance.plannedDrivingSeconds)}
          </span>

          {/* Real values from the driver's recorded hours, or plainly unknown.
              These used to read "calculated" when nothing was (PLAN-1). */}
          <span className="text-xs text-ink-3">
            Daily drive left{" "}
            {compliance.dailyDrivingRemainingSeconds === null
              ? "unknown"
              : formatDuration(compliance.dailyDrivingRemainingSeconds)}
          </span>

          <span className="text-xs text-ink-3">
            Break due after{" "}
            {compliance.breakDueAfterSeconds === null
              ? "unknown"
              : formatDuration(compliance.breakDueAfterSeconds)}
          </span>

          <span className="text-xs text-ink-3">
            Rest and WTD not checked
          </span>
        </div>

        {compliance.warnings.length > 0 ? (
          <p className="mt-1 text-xs text-warning">
            {compliance.warnings.join(" · ")}
          </p>
        ) : null}

        {compliance.missing.length > 0 ? (
          <p className="mt-1 text-xs text-ink-3">
            Missing: {compliance.missing.join(" · ")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-stretch gap-2">
        {displayedJobs.map((job, index) => (
          <PlanJobCard
            key={job.id}
            job={job}
            sequence={index + 1}
            dropNumbers={
              canonicalDropNumbersByJobId === undefined
                ? undefined
                : canonicalDropNumbersByJobId[job.id] ?? []
            }
            geocodeSettled={geocodeSettled}
            onOpen={onOpenJob}
            onAccept={onAcceptJob}
            selected={selectedJobs.has(job.id)}
            onSelectedChange={emailEnabled ? (checked) => setSelectedJobs((previous) => {
              const next = new Set(previous); if (checked) next.add(job.id); else next.delete(job.id); return next;
            }) : undefined}
            onCollectionReceipt={emailEnabled ? () => setEmailTarget({ jobs: [job], kind: "collection_receipt" }) : undefined}
            onAppointmentEmail={emailEnabled ? () => setEmailTarget({ jobs: [job], kind: "planned_window", window: "CUSTOM" }) : undefined}
            canMoveUp={canonicalDropNumbersByJobId === undefined && index > 0}
            canMoveDown={canonicalDropNumbersByJobId === undefined && index < displayedJobs.length - 1}
            onMoveUp={() => onMoveJob(job.id, -1)}
            onMoveDown={() => onMoveJob(job.id, 1)}
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
      {completedJobs.length > 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          <h4 className="mb-2 text-xs font-semibold text-success">Delivered · {completedJobs.length}</h4>
          <div className="flex flex-wrap items-stretch gap-2">
            {completedJobs.map((job) => (
              <PlanJobCard key={job.id} job={job} sequence={null} geocodeSettled={false} onOpen={onOpenJob} readOnly />
            ))}
          </div>
        </div>
      ) : null}
      </div>
      {emailTarget ? <CollectionEmailDialog jobs={emailTarget.jobs} kind={emailTarget.kind} date={planningDate ?? ""}
        initialWindow={emailTarget.window}
        vehicleRegistration={vehicle.registration} onClose={() => setEmailTarget(null)} /> : null}
    </section>
  );
}
