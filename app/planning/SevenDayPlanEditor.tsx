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
  UNSCHEDULED_ROUTE_DAY,
} from "../../lib/planning/sevenDayPlanEditor";

type Props = {
  preview: PlanningDriverSchedulePreview;
  serviceStops: PlanningServiceStop[];
};

type Selection = {
  firstTaskId: string;
  lastTaskId: string;
};

const ROUTE_DAYS: EditableRouteDay[] = [1, 2, 3, 4, 5, 6, 7];

function taskIdForStop(stop: PlanningServiceStop): string {
  return `stop:${stop.stopId}`;
}

function dayLabel(day: EditableRouteDay): string {
  return day === UNSCHEDULED_ROUTE_DAY ? "Unscheduled" : `Day ${day}`;
}

export default function SevenDayPlanEditor({
  preview,
  serviceStops,
}: Props) {
  const canonicalTaskIds = useMemo(
    () => serviceStops.map(taskIdForStop),
    [serviceStops]
  );

  const initialPlan = useMemo(
    () => buildEditableSevenDayPlan(canonicalTaskIds, preview),
    [canonicalTaskIds, preview]
  );

  const [plan, setPlan] = useState<EditableSevenDayPlan>(initialPlan);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [targetDay, setTargetDay] = useState<EditableRouteDay>(
    UNSCHEDULED_ROUTE_DAY
  );
  const [edited, setEdited] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setPlan(initialPlan);
    setSelection(null);
    setEdited(false);
    setNotice(null);
  }, [initialPlan]);

  const stopByTaskId = useMemo(
    () =>
      new Map(
        serviceStops.map((stop) => [
          taskIdForStop(stop),
          stop,
        ] as const)
      ),
    [serviceStops]
  );

  function selectStop(taskId: string): void {
    if (!selection) {
      setSelection({
        firstTaskId: taskId,
        lastTaskId: taskId,
      });
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
      setSelection({
        firstTaskId: taskId,
        lastTaskId: taskId,
      });
      setNotice(
        "Range selection must stay inside one current day or the Unscheduled bucket."
      );
      return;
    }

    setSelection({
      firstTaskId: selection.firstTaskId,
      lastTaskId: taskId,
    });
    setNotice(null);
  }

  function moveSelection(): void {
    if (!selection) {
      setNotice("Select a stop or contiguous range first.");
      return;
    }

    const moved = moveEditablePlanRange(
      plan,
      selection.firstTaskId,
      selection.lastTaskId,
      targetDay
    );

    if (!moved.ok) {
      setNotice(
        moved.reason === "precedence_conflict"
          ? "That move would violate canonical stop precedence."
          : "That range cannot be moved."
      );
      return;
    }

    setPlan(moved.plan);
    setSelection(null);
    setEdited(true);
    setNotice(
      "Draft allocation changed. Driver-hours totals must be recalculated before this plan is treated as workable."
    );
  }

  function reset(): void {
    setPlan(initialPlan);
    setSelection(null);
    setEdited(false);
    setNotice(null);
  }

  function selected(taskId: string): boolean {
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
    if (first.day !== current.day || last.day !== current.day) return false;

    const low = Math.min(first.canonicalIndex, last.canonicalIndex);
    const high = Math.max(first.canonicalIndex, last.canonicalIndex);

    return (
      current.canonicalIndex >= low &&
      current.canonicalIndex <= high
    );
  }

  const buckets: EditableRouteDay[] = [
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
          <p className="mt-0.5 max-w-3xl text-xs text-ink-3">
            Move a canonical stop or contiguous range between planning days.
            Geographic Smart Optimize order remains fixed.
          </p>
        </div>

        <button
          type="button"
          onClick={reset}
          disabled={!edited}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset calculated plan
        </button>
      </div>

      {edited ? (
        <div
          className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink-2"
          data-testid="seven-day-editor-dirty-warning"
        >
          <span className="font-semibold text-warning">
            Draft allocation edited.
          </span>{" "}
          Existing driving, break, rest and ETA calculations belong to the
          calculated plan and are not valid for this edited allocation.
        </div>
      ) : null}

      {notice ? (
        <div
          className="mt-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2"
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
          onClick={moveSelection}
          disabled={!selection}
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          Move
        </button>

        {selection ? (
          <button
            type="button"
            onClick={() => {
              setSelection(null);
              setNotice(null);
            }}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-2"
          >
            Clear selection
          </button>
        ) : null}
      </div>

      <p className="mt-2 text-[11px] text-ink-3">
        Select the first stop, then another stop in the same bucket to select
        the entire canonical range between them.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {buckets.map((day) => {
          const stops = stopsForEditableDay(plan, day);

          return (
            <article
              key={day}
              className="min-h-28 rounded-lg border border-line bg-surface-2 p-3"
              data-testid={
                day === UNSCHEDULED_ROUTE_DAY
                  ? "editor-unscheduled"
                  : `editor-day-${day}`
              }
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink">
                  {dayLabel(day)}
                </h4>

                <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-2">
                  {stops.length}
                </span>
              </div>

              {stops.length === 0 ? (
                <p className="mt-3 text-xs text-ink-3">
                  No service stops
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1">
                  {stops.map((editableStop) => {
                    const serviceStop = stopByTaskId.get(
                      editableStop.taskId
                    );

                    const dropNumber =
                      serviceStop?.serviceSequenceNumber ??
                      editableStop.canonicalIndex + 1;

                    const active = selected(editableStop.taskId);

                    return (
                      <button
                        key={editableStop.taskId}
                        type="button"
                        onClick={() =>
                          selectStop(editableStop.taskId)
                        }
                        className={[
                          "rounded border px-1.5 py-0.5 text-xs font-medium",
                          active
                            ? "border-warning bg-warning/10 text-ink"
                            : "border-line bg-surface text-ink",
                        ].join(" ")}
                        title={`Canonical Drop ${dropNumber} · ${editableStop.taskId}`}
                        aria-pressed={active}
                      >
                        {dropNumber}
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}