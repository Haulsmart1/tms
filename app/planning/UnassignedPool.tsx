"use client";

import type { DragEvent } from "react";
import PlanJobCard, { JOB_ID_MIME } from "./PlanJobCard";
import type { PlanJob } from "../../lib/planning/types";

type Props = {
  jobs: PlanJob[];
  subcontracted: PlanJob[];
  geocodeSettled: boolean;
  onDropJob: (draggedJobId: string) => void;
};

export default function UnassignedPool({ jobs, subcontracted, geocodeSettled, onDropJob }: Props) {
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(JOB_ID_MIME);
    if (draggedId) onDropJob(draggedId);
  }

  return (
    <section
      aria-label="Unassigned jobs"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="flex w-[240px] flex-none flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3"
    >
      <h3 className="text-sm font-semibold text-ink">Unassigned · {jobs.length}</h3>
      {jobs.length === 0 ? (
        <p className="text-xs text-ink-3">Every job for this date is assigned.</p>
      ) : (
        jobs.map((job) => (
          <PlanJobCard key={job.id} job={job} sequence={null} geocodeSettled={geocodeSettled} />
        ))
      )}

      {subcontracted.length > 0 ? (
        <>
          <h3 className="mt-2 text-sm font-semibold text-ink">
            Subcontracted · {subcontracted.length}
          </h3>
          {/* Read-only: visible so the day's full picture is here, but routed
              by the subcontractor, not by this operator's fleet. */}
          {subcontracted.map((job) => (
            <div key={job.id} className="rounded-md border border-line bg-surface px-2.5 py-2 text-sm opacity-70">
              <p className="font-semibold text-ink">{job.reference ?? "No reference"}</p>
              <p className="text-xs text-ink-3">{job.customer_name ?? "No customer"}</p>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}
