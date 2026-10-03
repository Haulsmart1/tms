import {
  scheduleDriverRoute,
  type DriverPlanningProfile,
  type DriverScheduleDay,
  type DriverScheduleEvent,
  type DriverScheduleInitialDrivingState,
  type DriverScheduleStatus,
  type DriverScheduleTask,
  type DriverTravelResolver,
} from "./driverSchedule";
import type { DriverRuleProfile } from "./driverRules";

export const MAX_ROUTE_DAYS = 7;

export type SevenDayRouteDay = {
  day: number;
  scheduleDay: DriverScheduleDay;
  events: DriverScheduleEvent[];
  taskIds: string[];
  firstTaskIndex: number | null;
  lastTaskIndex: number | null;
};

export type SevenDayPlanSuccess = {
  ok: true;
  status: DriverScheduleStatus;
  planningAssumption: boolean;
  days: SevenDayRouteDay[];
  warnings: string[];
  completedTaskIds: string[];
};

export type SevenDayPlanFailureReason =
  | "horizon_exceeded"
  | "unschedulable"
  | "canonical_order_mismatch";

export type SevenDayPlanFailure = {
  ok: false;
  reason: SevenDayPlanFailureReason;
  days: SevenDayRouteDay[];
  warnings: string[];
  completedTaskIds: string[];
  unscheduledTaskIds: string[];
};

export type SevenDayPlanResult =
  | SevenDayPlanSuccess
  | SevenDayPlanFailure;

export type SevenDayPlanInput = {
  planningProfile: DriverPlanningProfile;
  ruleProfile: DriverRuleProfile;
  startTimeSeconds?: number;
  startLocationId: string;
  baseLocationId?: string | null;
  activityDataAvailable: boolean;
  initialDrivingState?: DriverScheduleInitialDrivingState;
  tasks: DriverScheduleTask[];
  travelSecondsBetween: DriverTravelResolver;
  maxDays?: number;
};

function buildTaskDayMap(
  events: DriverScheduleEvent[],
): ReadonlyMap<string, number> {
  const taskDays = new Map<string, number>();

  for (const event of events) {
    if (
      event.taskId &&
      (event.kind === "drive" || event.kind === "service")
    ) {
      const existingDay = taskDays.get(event.taskId);

      if (existingDay !== undefined && existingDay !== event.day) {
        throw new Error(
          `Scheduled task ${event.taskId} spans multiple route days.`,
        );
      }

      taskDays.set(event.taskId, event.day);
    }
  }

  return taskDays;
}

function buildRouteDays(
  scheduleDays: DriverScheduleDay[],
  events: DriverScheduleEvent[],
  canonicalTaskIds: string[],
  completedTaskIds: string[],
): SevenDayRouteDay[] {
  const taskIndex = new Map(
    canonicalTaskIds.map((id, index) => [id, index] as const),
  );
  const taskDays = buildTaskDayMap(events);

  const completedWithDays = completedTaskIds.map(
    (taskId, completedIndex) => {
      const canonicalIndex = taskIndex.get(taskId);

      if (canonicalIndex === undefined) {
        throw new Error(
          `Scheduled task ${taskId} is not present in the canonical route.`,
        );
      }

      const explicitDay = taskDays.get(taskId);

      if (explicitDay !== undefined) {
        return {
          taskId,
          canonicalIndex,
          day: explicitDay,
        };
      }

      const previousTaskId =
        completedIndex > 0
          ? completedTaskIds[completedIndex - 1]
          : null;
      const nextTaskId =
        completedIndex + 1 < completedTaskIds.length
          ? completedTaskIds[completedIndex + 1]
          : null;

      const previousDay = previousTaskId
        ? taskDays.get(previousTaskId)
        : undefined;
      const nextDay = nextTaskId
        ? taskDays.get(nextTaskId)
        : undefined;

      const day =
        previousDay ??
        nextDay ??
        scheduleDays[0]?.day;

      if (day === undefined) {
        throw new Error(
          `Unable to determine route day for scheduled task ${taskId}.`,
        );
      }

      return {
        taskId,
        canonicalIndex,
        day,
      };
    },
  );

  return scheduleDays.map((scheduleDay) => {
    const dayEvents = events.filter(
      (event) => event.day === scheduleDay.day,
    );
    const dayTasks = completedWithDays.filter(
      (task) => task.day === scheduleDay.day,
    );
    const taskIds = dayTasks.map((task) => task.taskId);
    const indexes = dayTasks.map(
      (task) => task.canonicalIndex,
    );

    return {
      day: scheduleDay.day,
      scheduleDay,
      events: dayEvents,
      taskIds,
      firstTaskIndex:
        indexes.length > 0 ? indexes[0] : null,
      lastTaskIndex:
        indexes.length > 0
          ? indexes[indexes.length - 1]
          : null,
    };
  });
}

function isCanonicalPrefix(
  completedTaskIds: string[],
  canonicalTaskIds: string[],
): boolean {
  if (completedTaskIds.length > canonicalTaskIds.length) {
    return false;
  }

  return completedTaskIds.every(
    (id, index) => id === canonicalTaskIds[index],
  );
}

function daysAreContiguous(
  days: SevenDayRouteDay[],
  canonicalTaskIds: string[],
): boolean {
  let expectedIndex = 0;

  for (const day of days) {
    for (const taskId of day.taskIds) {
      if (canonicalTaskIds[expectedIndex] !== taskId) {
        return false;
      }

      expectedIndex += 1;
    }
  }

  return true;
}

/**
 * Applies working-time/driver-rule scheduling to an already canonical route.
 *
 * This function never optimizes or reorders physical stops. The supplied
 * task order is authoritative; compliance may only insert breaks/rests and
 * divide that sequence into route days.
 */
export function planCanonicalRouteAcrossDays(
  input: SevenDayPlanInput,
): SevenDayPlanResult {
  const maxDays = input.maxDays ?? MAX_ROUTE_DAYS;

  if (
    !Number.isInteger(maxDays) ||
    maxDays < 1 ||
    maxDays > MAX_ROUTE_DAYS
  ) {
    throw new Error(
      `maxDays must be an integer from 1 to ${MAX_ROUTE_DAYS}.`,
    );
  }

  const canonicalTaskIds = input.tasks.map((task) => task.id);

  const schedule = scheduleDriverRoute({
    planningProfile: input.planningProfile,
    ruleProfile: input.ruleProfile,
    startTimeSeconds: input.startTimeSeconds,
    startLocationId: input.startLocationId,
    baseLocationId: input.baseLocationId,
    activityDataAvailable: input.activityDataAvailable,
    initialDrivingState: input.initialDrivingState,
    tasks: input.tasks,
    travelSecondsBetween: input.travelSecondsBetween,
  });

  let days: SevenDayRouteDay[];

  try {
    days = buildRouteDays(
      schedule.days,
      schedule.events,
      canonicalTaskIds,
      schedule.completedTaskIds,
    );
  } catch (error) {
    return {
      ok: false,
      reason: "canonical_order_mismatch",
      days: [],
      warnings: [
        ...schedule.warnings,
        error instanceof Error
          ? error.message
          : "Scheduled route does not match the canonical route.",
      ],
      completedTaskIds: schedule.completedTaskIds,
      unscheduledTaskIds: schedule.unscheduledTaskIds,
    };
  }

  if (
    !isCanonicalPrefix(
      schedule.completedTaskIds,
      canonicalTaskIds,
    ) ||
    !daysAreContiguous(days, canonicalTaskIds)
  ) {
    return {
      ok: false,
      reason: "canonical_order_mismatch",
      days,
      warnings: [
        ...schedule.warnings,
        "Driver schedule changed the canonical task order.",
      ],
      completedTaskIds: schedule.completedTaskIds,
      unscheduledTaskIds: schedule.unscheduledTaskIds,
    };
  }

  const daysWithinHorizon = days.filter(
    (day) => day.day <= maxDays,
  );

  const completedWithinHorizon = daysWithinHorizon.flatMap(
    (day) => day.taskIds,
  );

  if (days.some((day) => day.day > maxDays)) {
    return {
      ok: false,
      reason: "horizon_exceeded",
      days: daysWithinHorizon,
      warnings: [
        ...schedule.warnings,
        `Canonical route requires more than ${maxDays} route days.`,
      ],
      completedTaskIds: completedWithinHorizon,
      unscheduledTaskIds: canonicalTaskIds.slice(
        completedWithinHorizon.length,
      ),
    };
  }

  if (
    schedule.status === "unschedulable" ||
    schedule.unscheduledTaskIds.length > 0
  ) {
    return {
      ok: false,
      reason: "unschedulable",
      days,
      warnings: schedule.warnings,
      completedTaskIds: schedule.completedTaskIds,
      unscheduledTaskIds: schedule.unscheduledTaskIds,
    };
  }

  return {
    ok: true,
    status: schedule.status,
    planningAssumption: schedule.planningAssumption,
    days,
    warnings: schedule.warnings,
    completedTaskIds: schedule.completedTaskIds,
  };
}