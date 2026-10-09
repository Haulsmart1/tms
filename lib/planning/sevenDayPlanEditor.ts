import type { PlanningDriverSchedulePreview } from "./planningDriverSchedule";
import { buildSevenDayPresentation, remainingSevenDayTaskIds } from "./sevenDayPresentation";

export const EDITABLE_ROUTE_DAYS = 7 as const;
export const UNSCHEDULED_ROUTE_DAY = 0 as const;

export type EditableRouteDay =
  | typeof UNSCHEDULED_ROUTE_DAY
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7;

export type EditablePlanStop = {
  taskId: string;
  canonicalIndex: number;
  day: EditableRouteDay;
};

export type EditableSevenDayPlan = {
  stops: EditablePlanStop[];
};

export type SevenDayPlanEditorDraft = {
  signature: string;
  plan: EditableSevenDayPlan;
  edited: boolean;
};

export function parseSevenDayEditorDrafts(value: unknown): Record<string, SevenDayPlanEditorDraft> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, SevenDayPlanEditorDraft> = {};
  for (const [vehicleId, raw] of Object.entries(value)) {
    const draft = raw as SevenDayPlanEditorDraft;
    if (!draft || typeof draft.signature !== "string" || typeof draft.edited !== "boolean" || !Array.isArray(draft.plan?.stops)) return null;
    const ids = draft.plan.stops.map((stop) => stop?.taskId);
    if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !id.startsWith("stop:"))) return null;
    if (draft.signature.split("\u001f").slice(3).join("\u001f") !== ids.join("\u001f")) return null;
    if (draft.plan.stops.some((stop, index) => stop.canonicalIndex !== index || !validDay(stop.day))) return null;
    // Day allocation must preserve the complete canonical sequence.
    if (!respectsPrecedence(draft.plan, ids.map((taskId, index) => ({ taskId, precedenceTaskIds: index ? [ids[index - 1]] : [] })))) return null;
    result[vehicleId] = JSON.parse(JSON.stringify(draft));
  }
  return result;
}

export type EditablePlanMove =
  | {
      ok: true;
      plan: EditableSevenDayPlan;
    }
  | {
      ok: false;
      reason:
        | "invalid_day"
        | "unknown_task"
        | "invalid_range"
        | "precedence_conflict";
    };

export type TaskPrecedence = {
  taskId: string;
  precedenceTaskIds: string[];
};

function validDay(day: number): day is EditableRouteDay {
  return (
    day === UNSCHEDULED_ROUTE_DAY ||
    (day >= 1 &&
      day <= EDITABLE_ROUTE_DAYS &&
      Number.isInteger(day))
  );
}

function taskIdsForPreviewDay(
  preview: PlanningDriverSchedulePreview,
  day: number
): Set<string> {
  return new Set(
    buildSevenDayPresentation(preview).find(
      (routeDay) => routeDay.day === day
    )?.taskIds ?? []
  );
}

export function buildEditableSevenDayPlan(
  canonicalTaskIds: string[],
  preview: PlanningDriverSchedulePreview
): EditableSevenDayPlan {
  const canonicalSet = new Set(canonicalTaskIds);

  if (canonicalSet.size !== canonicalTaskIds.length) {
    throw new Error(
      "Canonical task IDs must be unique."
    );
  }

  const assignedDay = new Map<string, EditableRouteDay>();

  for (let day = 1; day <= EDITABLE_ROUTE_DAYS; day += 1) {
    for (const taskId of taskIdsForPreviewDay(preview, day)) {
      if (!canonicalSet.has(taskId)) {
        throw new Error(
          `Preview contains unknown task ${taskId}.`
        );
      }

      if (assignedDay.has(taskId)) {
        throw new Error(
          `Preview assigns task ${taskId} more than once.`
        );
      }

      assignedDay.set(
        taskId,
        day as EditableRouteDay
      );
    }
  }

  for (const taskId of remainingSevenDayTaskIds(preview, canonicalTaskIds)) {
    if (!canonicalSet.has(taskId)) {
      throw new Error(
        `Preview contains unknown remaining task ${taskId}.`
      );
    }

    if (assignedDay.has(taskId)) {
      throw new Error(
        `Task ${taskId} is both scheduled and remaining.`
      );
    }

    assignedDay.set(
      taskId,
      UNSCHEDULED_ROUTE_DAY
    );
  }

  return {
    stops: canonicalTaskIds.map(
      (taskId, canonicalIndex) => ({
        taskId,
        canonicalIndex,
        day:
          assignedDay.get(taskId) ??
          UNSCHEDULED_ROUTE_DAY,
      })
    ),
  };
}

export function stopsForEditableDay(
  plan: EditableSevenDayPlan,
  day: EditableRouteDay
): EditablePlanStop[] {
  return plan.stops
    .filter((stop) => stop.day === day)
    .sort(
      (left, right) =>
        left.canonicalIndex - right.canonicalIndex
    );
}

function respectsPrecedence(
  plan: EditableSevenDayPlan,
  precedence: TaskPrecedence[]
): boolean {
  const byTaskId = new Map(
    plan.stops.map((stop) => [stop.taskId, stop])
  );

  for (const rule of precedence) {
    const task = byTaskId.get(rule.taskId);

    if (!task) continue;

    for (const predecessorId of rule.precedenceTaskIds) {
      const predecessor = byTaskId.get(predecessorId);

      if (!predecessor) continue;

      if (
        task.day !== UNSCHEDULED_ROUTE_DAY &&
        predecessor.day === UNSCHEDULED_ROUTE_DAY
      ) {
        return false;
      }

      if (
        task.day !== UNSCHEDULED_ROUTE_DAY &&
        predecessor.day !== UNSCHEDULED_ROUTE_DAY &&
        predecessor.day > task.day
      ) {
        return false;
      }

      if (
        task.day === predecessor.day &&
        predecessor.canonicalIndex >
          task.canonicalIndex
      ) {
        return false;
      }
    }
  }

  return true;
}

export function moveEditablePlanRange(
  plan: EditableSevenDayPlan,
  firstTaskId: string,
  lastTaskId: string,
  targetDay: number,
  precedence: TaskPrecedence[] = []
): EditablePlanMove {
  if (!validDay(targetDay)) {
    return {
      ok: false,
      reason: "invalid_day",
    };
  }

  const first = plan.stops.find(
    (stop) => stop.taskId === firstTaskId
  );
  const last = plan.stops.find(
    (stop) => stop.taskId === lastTaskId
  );

  if (!first || !last) {
    return {
      ok: false,
      reason: "unknown_task",
    };
  }

  const start = Math.min(
    first.canonicalIndex,
    last.canonicalIndex
  );
  const end = Math.max(
    first.canonicalIndex,
    last.canonicalIndex
  );

  const selected = plan.stops.filter(
    (stop) =>
      stop.canonicalIndex >= start &&
      stop.canonicalIndex <= end
  );

  if (
    selected.length !== end - start + 1
  ) {
    return {
      ok: false,
      reason: "invalid_range",
    };
  }

  const selectedIds = new Set(
    selected.map((stop) => stop.taskId)
  );

  const candidate: EditableSevenDayPlan = {
    stops: plan.stops.map((stop) =>
      selectedIds.has(stop.taskId)
        ? {
            ...stop,
            day: targetDay,
          }
        : stop
    ),
  };

  if (!respectsPrecedence(candidate, precedence)) {
    return {
      ok: false,
      reason: "precedence_conflict",
    };
  }

  return {
    ok: true,
    plan: candidate,
  };
}
