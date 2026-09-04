import {
  validateDriverRuleProfile,
  type DriverRuleProfile,
} from "./driverRules";

export type DriverPlanningProfile = "day" | "tramper";

export type DriverScheduleTask = {
  id: string;
  locationId: string;
  travelSeconds: number;
  serviceSeconds: number;
  precedenceIds?: string[];
  returnToBaseSeconds?: number | null;
};

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

function ensureDriveCanFit(
  state: State,
  events: DriverScheduleEvent[],
  rules: DriverRuleProfile,
  driveSeconds: number,
): boolean {
  if (
    driveSeconds > rules.maxContinuousDrivingSeconds ||
    driveSeconds > rules.maxDailyDrivingSeconds
  ) {
    return false;
  }

  if (
    !durationFits(
      state.continuousDriving,
      driveSeconds,
      rules.maxContinuousDrivingSeconds,
    )
  ) {
    addBreak(state, events, rules);
  }

  return (
    durationFits(
      state.continuousDriving,
      driveSeconds,
      rules.maxContinuousDrivingSeconds,
    ) &&
    durationFits(
      state.dailyDriving,
      driveSeconds,
      rules.maxDailyDrivingSeconds,
    ) &&
    !dutyWouldExceed(state, rules, driveSeconds)
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
      errors.push(`Task ${task.id || "<unknown>"} requires a locationId`);
    }

    if (!isNonNegativeFinite(task.travelSeconds)) {
      errors.push(
        `Task ${task.id || "<unknown>"} has invalid travelSeconds`,
      );
    }

    if (!isNonNegativeFinite(task.serviceSeconds)) {
      errors.push(
        `Task ${task.id || "<unknown>"} has invalid serviceSeconds`,
      );
    }

    if (
      task.returnToBaseSeconds !== undefined &&
      task.returnToBaseSeconds !== null &&
      !isNonNegativeFinite(task.returnToBaseSeconds)
    ) {
      errors.push(
        `Task ${task.id || "<unknown>"} has invalid returnToBaseSeconds`,
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

function taskCanEverFit(
  task: DriverScheduleTask,
  input: DriverScheduleInput,
): boolean {
  const rules = input.ruleProfile;
  const returnSeconds =
    input.planningProfile === "day"
      ? task.returnToBaseSeconds
      : 0;

  if (
    task.travelSeconds > rules.maxContinuousDrivingSeconds ||
    task.travelSeconds > rules.maxDailyDrivingSeconds
  ) {
    return false;
  }

  if (
    input.planningProfile === "day" &&
    (returnSeconds === null ||
      returnSeconds === undefined ||
      returnSeconds > rules.maxContinuousDrivingSeconds ||
      task.travelSeconds + returnSeconds >
        rules.maxDailyDrivingSeconds)
  ) {
    return false;
  }

  const dutySeconds =
    task.travelSeconds +
    task.serviceSeconds +
    (returnSeconds ?? 0);

  return (
    rules.maxDutyWindowSeconds === null ||
    dutySeconds <= rules.maxDutyWindowSeconds
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

    if (!taskCanEverFit(task, input)) {
      warnings.push(
        `Task ${task.id} cannot fit within the supplied planning rules`,
      );
      break;
    }

    const returnSeconds =
      input.planningProfile === "day"
        ? task.returnToBaseSeconds ?? 0
        : 0;

    const reserveDriving =
      task.travelSeconds + returnSeconds;

    const reserveDuty =
      task.travelSeconds +
      task.serviceSeconds +
      returnSeconds;

    const dailyFits = durationFits(
      state.dailyDriving,
      reserveDriving,
      input.ruleProfile.maxDailyDrivingSeconds,
    );

    const dutyFits = !dutyWouldExceed(
      state,
      input.ruleProfile,
      reserveDuty,
    );

    if (!dailyFits || !dutyFits) {
      if (
        input.planningProfile === "day" &&
        state.locationId !== input.baseLocationId
      ) {
        const previous =
          index > 0 ? input.tasks[index - 1] : null;
        const back =
          previous?.returnToBaseSeconds ?? null;

        if (
          back === null ||
          !ensureDriveCanFit(
            state,
            events,
            input.ruleProfile,
            back,
          )
        ) {
          warnings.push(
            "Day driver cannot return to base within the supplied planning rules",
          );
          break;
        }

        addDrive(
          state,
          events,
          back,
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

    if (
      !ensureDriveCanFit(
        state,
        events,
        input.ruleProfile,
        task.travelSeconds,
      )
    ) {
      if (
        input.planningProfile === "day" &&
        state.locationId !== input.baseLocationId
      ) {
        const previous =
          index > 0 ? input.tasks[index - 1] : null;
        const back =
          previous?.returnToBaseSeconds ?? null;

        if (
          back === null ||
          !ensureDriveCanFit(
            state,
            events,
            input.ruleProfile,
            back,
          )
        ) {
          warnings.push(
            "Day driver cannot return to base within the supplied planning rules",
          );
          break;
        }

        addDrive(
          state,
          events,
          back,
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

    addDrive(
      state,
      events,
      task.travelSeconds,
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
    const lastTask = input.tasks[input.tasks.length - 1];
    const back = lastTask.returnToBaseSeconds ?? null;

    if (
      back === null ||
      !ensureDriveCanFit(
        state,
        events,
        input.ruleProfile,
        back,
      )
    ) {
      warnings.push(
        "Day driver cannot complete the final return to base within the supplied planning rules",
      );
    } else {
      addDrive(
        state,
        events,
        back,
        input.baseLocationId!,
        null,
        "return_to_base",
      );
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
