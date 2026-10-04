"use client";

import { useEffect, useMemo, useState } from "react";

import type { PlanningServiceStop } from "../../lib/planning/physicalItinerary";
import type { PlanningDriverSchedulePreview } from "../../lib/planning/planningDriverSchedule";
import {
  buildEditableSevenDayPlan,
  moveEditablePlanRange,
  stopsForEditableDay,
  type EditableRouteDay,
  type EditableSevenDayPlan,
  type TaskPrecedence,
  UNSCHEDULED_ROUTE_DAY,
} from "../../lib/planning/sevenDayPlanEditor";

type JobStop = {
  id: string;
  stop_order: number;
  type?: string | null;
  address_line?: string | null;
  city?: string | null;
  postcode?: string | null;
  booked_from?: string | null;
  booked_to?: string | null;
};

type PlanningEditorJob = {
  id: string;
  reference?: string | null;
  stops: JobStop[];
};

type Props = {
  preview: PlanningDriverSchedulePreview;
  serviceStops: PlanningServiceStop[];
  jobs: PlanningEditorJob[];
};

type Selection = {
  firstTaskId: string;
  lastTaskId: string;
};

const ROUTE_DAYS: EditableRouteDay[] = [1, 2, 3, 4, 5, 6, 7];

function taskIdForStop(stop: PlanningServiceStop): string {
  return `stop:${stop.stopId}`;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatStopType(value?: string | null): string {
  const type = (value ?? "").trim().toLowerCase();

  if (type.includes("collect")) return "Collection";
  if (type.includes("deliver")) return "Delivery";

  return value?.trim() || "Stop";
}

function formatAddress(stop?: JobStop): string {
  if (!stop) return "";

  return [stop.address_line, stop.city, stop.postcode]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(", ");
}

function formatBookedWindow(stop?: JobStop): string | null {
  if (!stop) return null;

  if (stop.booked_from && stop.booked_to) {
    return `${stop.booked_from} – ${stop.booked_to}`;
  }

  return stop.booked_from ?? stop.booked_to ?? null;
}

export default function SevenDayPlanEditor({
  preview,
  serviceStops,
  jobs,
}: Props) {
  const canonicalTaskIds = useMemo(
    () => serviceStops.map(taskIdForStop),
    [serviceStops]
  );

  const canonicalSignature = canonicalTaskIds.join("\u001f");

  const calculatedPlan = useMemo(
    () => buildEditableSevenDayPlan(canonicalTaskIds, preview),
    [canonicalTaskIds, preview]
  );

  /*
   * keying this state by canonicalSignature is intentional:
   * preview refreshes must not erase dispatcher edits, while an actual
   * Smart Optimize route change must create a fresh draft.
   */
  const [draft, setDraft] = useState<{
    signature: string;
    plan: EditableSevenDayPlan;
    edited: boolean;
  }>(() => ({
    signature: canonicalSignature,
    plan: calculatedPlan,
    edited: false,
  }));

  const plan =
    draft.signature === canonicalSignature
      ? draft.plan
      : calculatedPlan;

  const edited =
    draft.signature === canonicalSignature && draft.edited;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [targetDay, setTargetDay] =
    useState<EditableRouteDay>(UNSCHEDULED_ROUTE_DAY);
  const [expandedDay, setExpandedDay] =
    useState<EditableRouteDay | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (draft.signature === canonicalSignature) return;

    setDraft({
      signature: canonicalSignature,
      plan: calculatedPlan,
      edited: false,
    });
    setSelection(null);
    setExpandedDay(null);
    setNotice(null);
  }, [
    calculatedPlan,
    canonicalSignature,
    draft.signature,
  ]);

  const serviceByTaskId = useMemo(
    () =>
      new Map(
        serviceStops.map(
          (stop) => [taskIdForStop(stop), stop] as const
        )
      ),
    [serviceStops]
  );

  const jobById = useMemo(
    () => new Map(jobs.map((job) => [job.id, job] as const)),
    [jobs]
  );

  const rawStopById = useMemo(() => {
    const map = new Map<string, JobStop>();

    for (const job of jobs) {
      for (const stop of job.stops) {
        map.set(stop.id, stop);
      }
    }

    return map;
  }, [jobs]);

  const precedence = useMemo<TaskPrecedence[]>(
    () =>
      canonicalTaskIds.map((taskId, index) => ({
        taskId,
        precedenceTaskIds:
          index === 0 ? [] : [canonicalTaskIds[index - 1]],
      })),
    [canonicalTaskIds]
  );

  const baselineByDay = useMemo(
    () =>
      new Map(
        preview.routeDays.map((routeDay) => [
          routeDay.day,
          routeDay.scheduleDay,
        ])
      ),
    [preview.routeDays]
  );

  function visitBounds(taskId: string): Selection | null {
    const service = serviceByTaskId.get(taskId);
    if (!service) return null;

    const visitStops = serviceStops.filter(
      (candidate) =>
        candidate.visitSequenceNumber === service.visitSequenceNumber
    );

    if (visitStops.length === 0) return null;

    return {
      firstTaskId: taskIdForStop(visitStops[0]),
      lastTaskId: taskIdForStop(visitStops[visitStops.length - 1]),
    };
  }

  function expandRange(
    firstTaskId: string,
    lastTaskId: string
  ): Selection | null {
    const first = plan.stops.find(
      (stop) => stop.taskId === firstTaskId
    );
    const last = plan.stops.find(
      (stop) => stop.taskId === lastTaskId
    );

    if (!first || !last || first.day !== last.day) return null;

    const low = Math.min(first.canonicalIndex, last.canonicalIndex);
    const high = Math.max(first.canonicalIndex, last.canonicalIndex);

    const lowStop = plan.stops.find(
      (stop) => stop.canonicalIndex === low
    );
    const highStop = plan.stops.find(
      (stop) => stop.canonicalIndex === high
    );

    if (!lowStop || !highStop) return null;

    const firstVisit = visitBounds(lowStop.taskId);
    const lastVisit = visitBounds(highStop.taskId);

    if (!firstVisit || !lastVisit) return null;

    return {
      firstTaskId: firstVisit.firstTaskId,
      lastTaskId: lastVisit.lastTaskId,
    };
  }

  function selectTask(taskId: string): void {
    const visit = visitBounds(taskId);

    if (!visit) {
      setNotice("That physical visit cannot be resolved.");
      return;
    }

    if (!selection) {
      setSelection(visit);
      setNotice(null);
      return;
    }

    const first = plan.stops.find(
      (stop) => stop.taskId === selection.firstTaskId
    );
    const clicked = plan.stops.find(
      (stop) => stop.taskId === taskId
    );

    if (!first || !clicked || first.day !== clicked.day) {
      setSelection(visit);
      setNotice(
        "The selected range must remain inside one planning day."
      );
      return;
    }

    const expanded = expandRange(selection.firstTaskId, taskId);

    if (!expanded) {
      setNotice("That range cannot be selected.");
      return;
    }

    setSelection(expanded);
    setNotice(null);
  }

  function isSelected(taskId: string): boolean {
    if (!selection) return false;

    const first = plan.stops.find(
      (stop) => stop.taskId === selection.firstTaskId
    );
    const last = plan.stops.find(
      (stop) => stop.taskId === selection.lastTaskId
    );
    const current = plan.stops.find(
      (stop) => stop.taskId === taskId
    );

    if (!first || !last || !current) return false;
    if (current.day !== first.day || current.day !== last.day) {
      return false;
    }

    const low = Math.min(first.canonicalIndex, last.canonicalIndex);
    const high = Math.max(first.canonicalIndex, last.canonicalIndex);

    return (
      current.canonicalIndex >= low &&
      current.canonicalIndex <= high
    );
  }

  function moveSelection(): void {
    if (!selection) {
      setNotice("Select a job stop or contiguous range first.");
      return;
    }

    const expanded = expandRange(
      selection.firstTaskId,
      selection.lastTaskId
    );

    if (!expanded) {
      setNotice("That range cannot be moved.");
      return;
    }

    const moved = moveEditablePlanRange(
      plan,
      expanded.firstTaskId,
      expanded.lastTaskId,
      targetDay,
      precedence
    );

    if (!moved.ok) {
      setNotice(
        moved.reason === "precedence_conflict"
          ? "That move would break the canonical collection/delivery sequence. Move a contiguous day boundary instead."
          : "That range cannot be moved."
      );
      return;
    }

    setDraft({
      signature: canonicalSignature,
      plan: moved.plan,
      edited: true,
    });
    setSelection(null);
    setExpandedDay(targetDay);
    setNotice(
      "Draft allocation retained. Driver-hours values marked Baseline must be recalculated before this edited plan is treated as workable."
    );
  }

  function resetPlan(): void {
    setDraft({
      signature: canonicalSignature,
      plan: calculatedPlan,
      edited: false,
    });
    setSelection(null);
    setNotice(null);
  }

  const days: EditableRouteDay[] = [
    ...ROUTE_DAYS,
    UNSCHEDULED_ROUTE_DAY,
  ];

  return (
    <section
      className="mt-4 rounded-lg border border-line bg-surface p-3"
      data-testid="seven-day-plan-editor"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            Plan editor
          </h3>
          <p className="mt-1 text-xs text-ink-3">
            Day cards count jobs separately from collection/delivery
            service stops. Click a card to inspect and edit it.
          </p>
        </div>

        <button
          type="button"
          disabled={!edited}
          onClick={resetPlan}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
        >
          Reset calculated plan
        </button>
      </div>

      {edited ? (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-ink-2">
          <strong>Edited draft.</strong> Manual moves are retained
          while this canonical route remains selected. Baseline
          driver-hours figures are not recalculated yet.
        </div>
      ) : null}

      {notice ? (
        <div
          className="mt-3 rounded-md border border-line bg-surface-2 p-2 text-xs text-ink-2"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-ink-2">
          Move selected range to
          <select
            value={targetDay}
            onChange={(event) =>
              setTargetDay(
                Number(event.target.value) as EditableRouteDay
              )
            }
            className="ml-2 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink"
          >
            {ROUTE_DAYS.map((day) => (
              <option key={day} value={day}>
                Day {day}
              </option>
            ))}
            <option value={UNSCHEDULED_ROUTE_DAY}>
              Unscheduled
            </option>
          </select>
        </label>

        <button
          type="button"
          disabled={!selection}
          onClick={moveSelection}
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
        >
          Move
        </button>

        {selection ? (
          <button
            type="button"
            onClick={() => setSelection(null)}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {days.map((day) => {
          const editableStops = stopsForEditableDay(plan, day);

          const services = editableStops
            .map((stop) => serviceByTaskId.get(stop.taskId))
            .filter(
              (stop): stop is PlanningServiceStop => Boolean(stop)
            );

          const jobIds = new Set(
            services.map((service) => service.jobId)
          );

          let collections = 0;
          let deliveries = 0;

          for (const service of services) {
            const rawStop = rawStopById.get(service.stopId);
            const type = (rawStop?.type ?? "").toLowerCase();

            if (type.includes("collect")) collections += 1;
            if (type.includes("deliver")) deliveries += 1;
          }

          const serviceSeconds = services.reduce(
            (total, stop) => total + stop.serviceSeconds,
            0
          );

          const baseline =
            day === UNSCHEDULED_ROUTE_DAY
              ? undefined
              : baselineByDay.get(day);

          const expanded = expandedDay === day;

          return (
            <article
              key={day}
              className="rounded-lg border border-line bg-surface-2"
            >
              <button
                type="button"
                className="w-full p-3 text-left"
                onClick={() =>
                  setExpandedDay(expanded ? null : day)
                }
                aria-expanded={expanded}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-ink">
                      {day === UNSCHEDULED_ROUTE_DAY
                        ? "Unscheduled"
                        : `Day ${day}`}
                    </h4>
                    <p className="mt-1 text-xs text-ink-3">
                      {jobIds.size}{" "}
                      {jobIds.size === 1 ? "job" : "jobs"} ·{" "}
                      {services.length}{" "}
                      {services.length === 1 ? "stop" : "stops"} ·{" "}
                      {collections} collections · {deliveries} deliveries
                    </p>
                  </div>

                  <span className="text-xs font-medium text-ink-3">
                    {expanded ? "Collapse" : "Expand / edit"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <span className="text-ink-3">Service</span>
                    <p className="font-semibold text-ink">
                      {formatDuration(serviceSeconds)}
                    </p>
                  </div>

                  {baseline ? (
                    <>
                      <div>
                        <span className="text-ink-3">
                          {edited ? "Baseline drive" : "Driving"}
                        </span>
                        <p className="font-semibold text-ink">
                          {formatDuration(baseline.drivingSeconds)}
                        </p>
                      </div>

                      <div>
                        <span className="text-ink-3">
                          {edited ? "Baseline duty" : "Duty"}
                        </span>
                        <p className="font-semibold text-ink">
                          {formatDuration(
                            baseline.drivingSeconds +
                              baseline.serviceSeconds
                          )}
                        </p>
                      </div>

                      <div>
                        <span className="text-ink-3">
                          {edited ? "Baseline breaks" : "Breaks"}
                        </span>
                        <p className="font-semibold text-ink">
                          {formatDuration(baseline.breakSeconds)}
                        </p>
                      </div>

                      <div>
                        <span className="text-ink-3">Status</span>
                        <p className="font-semibold text-ink">
                          {edited ? "Needs recalculation" : "Calculated"}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div>
                      <span className="text-ink-3">Status</span>
                      <p className="font-semibold text-warning">
                        Holding
                      </p>
                    </div>
                  )}
                </div>
              </button>

              {expanded ? (
                <div className="border-t border-line p-3">
                  {jobIds.size === 0 ? (
                    <p className="text-xs text-ink-3">
                      No allocated work.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {[...jobIds].map((jobId) => {
                        const job = jobById.get(jobId);

                        const jobServices = services.filter(
                          (service) => service.jobId === jobId
                        );

                        return (
                          <div
                            key={jobId}
                            className="rounded-md border border-line bg-surface p-2"
                          >
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <strong className="text-xs text-ink">
                                {job?.reference || jobId}
                              </strong>
                              <span className="text-[11px] text-ink-3">
                                {jobServices.length}{" "}
                                {jobServices.length === 1
                                  ? "stop"
                                  : "stops"}
                              </span>
                            </div>

                            <div className="space-y-1">
                              {jobServices.map((service) => {
                                const rawStop =
                                  rawStopById.get(service.stopId);
                                const active = isSelected(
                                  taskIdForStop(service)
                                );
                                const booked =
                                  formatBookedWindow(rawStop);
                                const address =
                                  formatAddress(rawStop);

                                return (
                                  <button
                                    key={service.stopId}
                                    type="button"
                                    onClick={() =>
                                      selectTask(
                                        taskIdForStop(service)
                                      )
                                    }
                                    aria-pressed={active}
                                    className={[
                                      "block w-full rounded border p-2 text-left text-xs",
                                      active
                                        ? "border-warning bg-warning/10"
                                        : "border-line bg-surface-2",
                                    ].join(" ")}
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-semibold text-ink">
                                        {formatStopType(rawStop?.type)} · Drop{" "}
                                        {service.serviceSequenceNumber}
                                      </span>
                                      <span className="text-ink-3">
                                        {formatDuration(
                                          service.serviceSeconds
                                        )} service
                                      </span>
                                    </div>

                                    {address ? (
                                      <div className="mt-1 text-ink-2">
                                        {address}
                                      </div>
                                    ) : null}

                                    {booked ? (
                                      <div className="mt-1 text-ink-3">
                                        Booked: {booked}
                                      </div>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}