import {
  buildDriverScheduleStopTasksFromItinerary,
  type DriverAwareRouteResult,
  type DriverScheduleStopTask,
} from "./driverAwareRoute";
import {
  scheduleDriverRoute,
  type DriverPlanningProfile,
  type DriverScheduleResult,
  type DriverTravelResolver,
} from "./driverSchedule";
import type { DriverRuleProfile } from "./driverRules";
import {
  ASSIMILATED_DRIVER_HOURS_LIMITS,
  type DriverHoursState,
} from "./driverHoursState";

type SuccessfulDriverAwareRoute = Extract<
  DriverAwareRouteResult,
  { ok: true }
>;

export type DriverAwareScheduleInput = {
  route: SuccessfulDriverAwareRoute;
  planningProfile: DriverPlanningProfile;
  ruleProfile: DriverRuleProfile;
  startTimeSeconds?: number;
  startLocationId: string;
  baseLocationId?: string | null;
  activityDataAvailable: boolean;
  driverHoursState?: DriverHoursState | null;
  travelSecondsBetween: DriverTravelResolver;
};

export type DriverAwareScheduleResult =
  | {
      ok: true;
      tasks: DriverScheduleStopTask[];
      schedule: DriverScheduleResult;
    }
  | {
      ok: false;
      reason: "physical_route_mismatch";
      remainingStopIds: string[];
    };

/**
 * Schedule an already optimized physical route.
 *
 * Travel is injected rather than loaded as an all-to-all matrix. This keeps
 * the integration scalable and lets the caller provide a bounded directed
 * edge cache. Missing edges remain null and are handled by the scheduler as
 * unschedulable travel rather than being estimated.
 */
export function scheduleDriverAwareRoute(
  input: DriverAwareScheduleInput,
): DriverAwareScheduleResult {
  const taskResult = buildDriverScheduleStopTasksFromItinerary(
    input.route.jobs,
    input.route.orderedVisits,
    input.route.serviceStops,
  );

  if (!taskResult.ok) {
    return taskResult;
  }

  const schedule = scheduleDriverRoute({
    planningProfile: input.planningProfile,
    ruleProfile: input.ruleProfile,
    startTimeSeconds: input.startTimeSeconds,
    startLocationId: input.startLocationId,
    baseLocationId: input.baseLocationId,
    activityDataAvailable:
      input.activityDataAvailable &&
      (input.driverHoursState?.complete ?? false),
    initialDrivingState: input.driverHoursState
      ? {
          continuousDrivingSeconds:
            input.driverHoursState.continuousDrivingSeconds,
          dailyDrivingSeconds:
            input.driverHoursState.dailyDrivingSeconds,
          weeklyDrivingSeconds:
            input.driverHoursState.currentWeekDrivingSeconds,
          fortnightDrivingSeconds:
            input.driverHoursState.fortnightDrivingSeconds,
          maxWeeklyDrivingSeconds:
            ASSIMILATED_DRIVER_HOURS_LIMITS.weeklyDrivingSeconds,
          maxFortnightDrivingSeconds:
            ASSIMILATED_DRIVER_HOURS_LIMITS.fortnightDrivingSeconds,
        }
      : undefined,
    tasks: taskResult.tasks.map((task) => ({
      id: task.id,
      locationId: task.locationId,
      serviceSeconds: task.serviceSeconds,
      precedenceIds: task.precedenceIds,
    })),
    travelSecondsBetween: input.travelSecondsBetween,
  });

  return {
    ok: true,
    tasks: taskResult.tasks,
    schedule,
  };
}
