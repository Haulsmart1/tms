import {
  validateDriverRuleProfile,
  type DriverRuleProfile,
} from "./driverRules";

export type DriverPlanningProfile = "day" | "tramper";

export type DriverScheduleTask = {
  id: string;
  locationId: string;
  serviceSeconds: number;
  precedenceIds?: string[];
};

export type DriverTravelResolver = (
  fromLocationId: string,
  toLocationId: string,
) => number | null;

export type DriverScheduleEventKind =
  | "drive"
  | "service"
  | "break"
  | "daily_rest"
  | "return_to_base";

export type DriverScheduleEvent = {
  kind: DriverScheduleEventKind;
  day: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  locationId: string;
  taskId: string | null;
};

export type DriverScheduleDay = {
  day: number;
  startSeconds: number;
  endSeconds: number;
  drivingSeconds: number;
  serviceSeconds: number;
  breakSeconds: number;
  restSeconds: number;
  startLocationId: string;
  endLocationId: string;
};

export type DriverScheduleStatus =
  | "scheduled"
  | "review_required"
  | "unschedulable";

export type DriverScheduleInput = {
  planningProfile: DriverPlanningProfile;
  ruleProfile: DriverRuleProfile;
  startTimeSeconds?: number;
  startLocationId: string;
  baseLocationId?: string | null;
  activityDataAvailable: boolean;
  tasks: DriverScheduleTask[];
  travelSecondsBetween: DriverTravelResolver;
};

export type DriverScheduleResult = {
  status: DriverScheduleStatus;
  planningAssumption: boolean;
  events: DriverScheduleEvent[];
  days: DriverScheduleDay[];
  warnings: string[];
  completedTaskIds: string[];
  unscheduledTaskIds: string[];
};

type MutableDay = {
  day: number;
  startSeconds: number;
  drivingSeconds: number;
  serviceSeconds: number;
  breakSeconds: number;
  restSeconds: number;
  startLocationId: string;
};

type State = {
  now: number;
  day: number;
  locationId: string;
  continuousDriving: number;
  dailyDriving: number;
  dutyStart: number;
  currentDay: MutableDay;
};

type DrivePlan = {
  driveSeconds: number;
  breakRequired: boolean;
};

const MAX_SCHEDULE_DAYS = 366;

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function durationFits(
  current: number,
  addition: number,
  maximum: number,
): boolean {
  return current + addition <= maximum;
}

function event(
  kind: DriverScheduleEventKind,
  state: State,
  durationSeconds: number,
  locationId: string,
  taskId: string | null,
): DriverScheduleEvent {
  const startSeconds = state.now;
  const endSeconds = startSeconds + durationSeconds;

  return {
    kind,
    day: state.day,
    startSeconds,
    endSeconds,
    durationSeconds,
    locationId,
    taskId,
  };
}

function closeDay(
  state: State,
  days: DriverScheduleDay[],
): void {
  days.push({
    day: state.currentDay.day,
    startSeconds: state.currentDay.startSeconds,
    endSeconds: state.now,
    drivingSeconds: state.currentDay.drivingSeconds,
    serviceSeconds: state.currentDay.serviceSeconds,
    breakSeconds: state.currentDay.breakSeconds,
    restSeconds: state.currentDay.restSeconds,
    startLocationId: state.currentDay.startLocationId,
    endLocationId: state.locationId,
  });
}

function addDrive(
  state: State,
  events: DriverScheduleEvent[],
  seconds: number,
  locationId: string,
  taskId: string | null,
  kind: "drive" | "return_to_base",
): void {
  if (seconds === 0) {
    state.locationId = locationId;
    return;
  }

  const next = event(
    kind,
    state,
    seconds,
    locationId,
    taskId,
  );

  events.push(next);
  state.now = next.endSeconds;
  state.locationId = locationId;
  state.continuousDriving += seconds;
  state.dailyDriving += seconds;
  state.currentDay.drivingSeconds += seconds;
}

function addService(
  state: State,
  events: DriverScheduleEvent[],
  task: DriverScheduleTask,
): void {
  if (task.serviceSeconds === 0) {
    return;
  }

  const next = event(
    "service",
    state,
    task.serviceSeconds,
    state.locationId,
    task.id,
  );

  events.push(next);
  state.now = next.endSeconds;
  state.currentDay.serviceSeconds += task.serviceSeconds;
}

function addBreak(
  state: State,
  events: DriverScheduleEvent[],
  rules: DriverRuleProfile,
): void {
  const next = event(
    "break",
    state,
    rules.qualifyingBreakSeconds,
    state.locationId,
    null,
  );

  events.push(next);
  state.now = next.endSeconds;
  state.continuousDriving = 0;
  state.currentDay.breakSeconds +=
    rules.qualifyingBreakSeconds;
}

function addDailyRest(
  state: State,
  events: DriverScheduleEvent[],
  days: DriverScheduleDay[],
  rules: DriverRuleProfile,
): void {
  const rest = event(
    "daily_rest",
    state,
    rules.dailyRestSeconds,
    state.locationId,
    null,
  );

  events.push(rest);
  state.now = rest.endSeconds;
  state.currentDay.restSeconds += rules.dailyRestSeconds;
  closeDay(state, days);

  state.day += 1;
  state.continuousDriving = 0;
  state.dailyDriving = 0;
  state.dutyStart = state.now;
  state.currentDay = {
    day: state.day,
    startSeconds: state.now,
    drivingSeconds: 0,
    serviceSeconds: 0,
    breakSeconds: 0,
    restSeconds: 0,
    startLocationId: state.locationId,
  };
}

function dutyWouldExceed(
  state: State,
  rules: DriverRuleProfile,
  seconds: number,
): boolean {
  return (
    rules.maxDutyWindowSeconds !== null &&
    state.now - state.dutyStart + seconds >
      rules.maxDutyWindowSeconds
  );
}

function resolveTravel(
  input: DriverScheduleInput,
  fromLocationId: string,
  toLocationId: string,
): number | null {
  if (fromLocationId === toLocationId) {
    return 0;
  }

  let value: number | null;

  try {
    value = input.travelSecondsBetween(
      fromLocationId,
      toLocationId,
    );
  } catch {
    return null;
  }

  return value !== null && isNonNegativeFinite(value)
    ? value
    : null;
}

function planDrive(
  state: State,
  rules: DriverRuleProfile,
  driveSeconds: number,
  reserveAfterDriveSeconds = 0,
): DrivePlan | null {
  if (
    driveSeconds > rules.maxContinuousDrivingSeconds ||
    driveSeconds > rules.maxDailyDrivingSeconds
  ) {
    return null;
  }

  const breakRequired = !durationFits(
    state.continuousDriving,
    driveSeconds,
    rules.maxContinuousDrivingSeconds,
  );

  const breakSeconds = breakRequired
    ? rules.qualifyingBreakSeconds
    : 0;

  if (
    !durationFits(
      state.dailyDriving,
      driveSeconds + reserveAfterDriveSeconds,
      rules.maxDailyDrivingSeconds,
    )
  ) {
    return null;
  }

  if (
    dutyWouldExceed(
      state,
      rules,
      breakSeconds +
        driveSeconds +
        reserveAfterDriveSeconds,
    )
  ) {
    return null;
  }

  return {
    driveSeconds,
    breakRequired,
  };
}

function executeDrivePlan(
  state: State,
  events: DriverScheduleEvent[],
  rules: DriverRuleProfile,
  plan: DrivePlan,
  locationId: string,
  taskId: string | null,
  kind: "drive" | "return_to_base",
): void {
  if (plan.breakRequired) {
    addBreak(state, events, rules);
  }

  addDrive(
    state,
    events,
    plan.driveSeconds,
    locationId,
    taskId,
    kind,
  );
}

function validateTasks(
  tasks: DriverScheduleTask[],
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const task of tasks) {
    if (!task.id.trim()) {
      errors.push("Every task requires an id");
    } else if (ids.has(task.id)) {
      errors.push(`Duplicate task id: ${task.id}`);
    } else {
      ids.add(task.id);
    }

    if (!task.locationId.trim()) {
      errors.push(
        `Task ${task.id || "<unknown>"} requires a locationId`,
      );
    }

    if (!isNonNegativeFinite(task.serviceSeconds)) {
      errors.push(
        `Task ${task.id || "<unknown>"} has invalid serviceSeconds`,
      );
    }
  }

  return errors;
}

function taskPrecedenceSatisfied(
  task: DriverScheduleTask,
  completed: Set<string>,
): boolean {
  return (task.precedenceIds ?? []).every((id) =>
    completed.has(id),
  );
}

function failTravel(
  warnings: string[],
  fromLocationId: string,
  toLocationId: string,
): void {
  warnings.push(
    `Travel time unavailable from ${fromLocationId} to ${toLocationId}`,
  );
}

export function scheduleDriverRoute(
  input: DriverScheduleInput,
): DriverScheduleResult {
  const warnings: string[] = [];
  const events: DriverScheduleEvent[] = [];
  const days: DriverScheduleDay[] = [];
  const completedTaskIds: string[] = [];
  const completed = new Set<string>();

  const ruleValidation = validateDriverRuleProfile(
    input.ruleProfile,
  );

  if (!ruleValidation.ok) {
    return {
      status: "unschedulable",
      planningAssumption: true,
      events,
      days,
      warnings: ruleValidation.errors,
      completedTaskIds,
      unscheduledTaskIds: input.tasks.map((task) => task.id),
    };
  }

  const taskErrors = validateTasks(input.tasks);

  if (!input.startLocationId.trim()) {
    taskErrors.push("startLocationId is required");
  }

  if (
    input.planningProfile === "day" &&
    !input.baseLocationId?.trim()
  ) {
    taskErrors.push(
      "Day-driver planning requires a baseLocationId",
    );
  }

  if (
    input.startTimeSeconds !== undefined &&
    !isNonNegativeFinite(input.startTimeSeconds)
  ) {
    taskErrors.push(
      "startTimeSeconds must be a non-negative finite number",
    );
  }

  if (typeof input.travelSecondsBetween !== "function") {
    taskErrors.push("travelSecondsBetween is required");
  }

  if (taskErrors.length > 0) {
    return {
      status: "unschedulable",
      planningAssumption: true,
      events,
      days,
      warnings: taskErrors,
      completedTaskIds,
      unscheduledTaskIds: input.tasks.map((task) => task.id),
    };
  }

  const planningAssumption =
    !input.activityDataAvailable ||
    !input.ruleProfile.verified;

  if (!input.activityDataAvailable) {
    warnings.push(
      "Driver activity data unavailable; schedule is a planning assumption",
    );
  }

  if (!input.ruleProfile.verified) {
    warnings.push(
      "Driver rule profile is not verified; legal compliance is not asserted",
    );
  }

  const start = input.startTimeSeconds ?? 0;

  const state: State = {
    now: start,
    day: 1,
    locationId: input.startLocationId,
    continuousDriving: 0,
    dailyDriving: 0,
    dutyStart: start,
    currentDay: {
      day: 1,
      startSeconds: start,
      drivingSeconds: 0,
      serviceSeconds: 0,
      breakSeconds: 0,
      restSeconds: 0,
      startLocationId: input.startLocationId,
    },
  };

  let index = 0;

  while (index < input.tasks.length) {
    if (state.day > MAX_SCHEDULE_DAYS) {
      warnings.push(
        "Schedule exceeded the maximum planning horizon",
      );
      break;
    }

    const task = input.tasks[index];

    if (!taskPrecedenceSatisfied(task, completed)) {
      warnings.push(
        `Task ${task.id} has unsatisfied precedence`,
      );
      break;
    }

    const travelSeconds = resolveTravel(
      input,
      state.locationId,
      task.locationId,
    );

    if (travelSeconds === null) {
      failTravel(
        warnings,
        state.locationId,
        task.locationId,
      );
      break;
    }

    let returnSeconds = 0;

    if (input.planningProfile === "day") {
      const resolvedReturn = resolveTravel(
        input,
        task.locationId,
        input.baseLocationId!,
      );

      if (resolvedReturn === null) {
        failTravel(
          warnings,
          task.locationId,
          input.baseLocationId!,
        );
        break;
      }

      returnSeconds = resolvedReturn;
    }

    const taskDutySeconds =
      travelSeconds +
      task.serviceSeconds +
      returnSeconds;

    const taskCanFitFreshDay =
      travelSeconds <=
        input.ruleProfile.maxContinuousDrivingSeconds &&
      returnSeconds <=
        input.ruleProfile.maxContinuousDrivingSeconds &&
      travelSeconds + returnSeconds <=
        input.ruleProfile.maxDailyDrivingSeconds &&
      (
        input.ruleProfile.maxDutyWindowSeconds === null ||
        taskDutySeconds <=
          input.ruleProfile.maxDutyWindowSeconds
      );

    if (!taskCanFitFreshDay) {
      warnings.push(
        `Task ${task.id} cannot fit within the supplied planning rules`,
      );
      break;
    }

    const drivePlan = planDrive(
      state,
      input.ruleProfile,
      travelSeconds,
      returnSeconds,
    );

    const breakSeconds =
      drivePlan?.breakRequired
        ? input.ruleProfile.qualifyingBreakSeconds
        : 0;

    const taskFitsCurrentDuty =
      drivePlan !== null &&
      !dutyWouldExceed(
        state,
        input.ruleProfile,
        breakSeconds +
          travelSeconds +
          task.serviceSeconds +
          returnSeconds,
      );

    if (!taskFitsCurrentDuty) {
      if (
        input.planningProfile === "day" &&
        state.locationId !== input.baseLocationId
      ) {
        const back = resolveTravel(
          input,
          state.locationId,
          input.baseLocationId!,
        );

        if (back === null) {
          failTravel(
            warnings,
            state.locationId,
            input.baseLocationId!,
          );
          break;
        }

        const returnPlan = planDrive(
          state,
          input.ruleProfile,
          back,
        );

        if (returnPlan === null) {
          warnings.push(
            "Day driver cannot return to base within the supplied planning rules",
          );
          break;
        }

        executeDrivePlan(
          state,
          events,
          input.ruleProfile,
          returnPlan,
          input.baseLocationId!,
          null,
          "return_to_base",
        );
      }

      addDailyRest(
        state,
        events,
        days,
        input.ruleProfile,
      );

      if (input.planningProfile === "day") {
        state.locationId = input.baseLocationId!;
        state.currentDay.startLocationId =
          input.baseLocationId!;
      }

      continue;
    }

    executeDrivePlan(
      state,
      events,
      input.ruleProfile,
      drivePlan,
      task.locationId,
      task.id,
      "drive",
    );

    if (
      dutyWouldExceed(
        state,
        input.ruleProfile,
        task.serviceSeconds + returnSeconds,
      )
    ) {
      warnings.push(
        `Task ${task.id} service would exceed the supplied duty window`,
      );
      break;
    }

    addService(state, events, task);

    completed.add(task.id);
    completedTaskIds.push(task.id);
    index += 1;
  }

  if (
    index === input.tasks.length &&
    input.planningProfile === "day" &&
    input.tasks.length > 0 &&
    state.locationId !== input.baseLocationId
  ) {
    const back = resolveTravel(
      input,
      state.locationId,
      input.baseLocationId!,
    );

    if (back === null) {
      failTravel(
        warnings,
        state.locationId,
        input.baseLocationId!,
      );
    } else {
      const returnPlan = planDrive(
        state,
        input.ruleProfile,
        back,
      );

      if (returnPlan === null) {
        warnings.push(
          "Day driver cannot complete the final return to base within the supplied planning rules",
        );
      } else {
        executeDrivePlan(
          state,
          events,
          input.ruleProfile,
          returnPlan,
          input.baseLocationId!,
          null,
          "return_to_base",
        );
      }
    }
  }

  if (
    events.length > 0 ||
    input.tasks.length === 0
  ) {
    closeDay(state, days);
  }

  const unscheduledTaskIds = input.tasks
    .slice(index)
    .map((task) => task.id);

  const hardFailure =
    unscheduledTaskIds.length > 0 ||
    (
      input.planningProfile === "day" &&
      input.tasks.length > 0 &&
      state.locationId !== input.baseLocationId
    );

  const status: DriverScheduleStatus = hardFailure
    ? "unschedulable"
    : planningAssumption
      ? "review_required"
      : "scheduled";

  return {
    status,
    planningAssumption,
    events,
    days,
    warnings,
    completedTaskIds,
    unscheduledTaskIds,
  };
}
