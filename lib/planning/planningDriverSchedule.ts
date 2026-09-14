import type { FastPlotVisit } from "./fastPlot";
import {
  ASSIMILATED_DRIVER_HOURS_LIMITS,
  type DriverHoursState,
} from "./driverHoursState";
import type { DriverAwareRouteResult } from "./driverAwareRoute";
import { scheduleDriverAwareRoute } from "./driverRouteSchedule";
import type {
  DriverPlanningProfile,
  DriverScheduleResult,
} from "./driverSchedule";
import type { DriverRuleProfile } from "./driverRules";
import type { PlanningServiceStop } from "./physicalItinerary";
import type { ComplianceRegime } from "./regime";
import type { PlanJob, RouteResult } from "./types";

type SuccessfulDriverAwareRoute = Extract<
  DriverAwareRouteResult,
  { ok: true }
>;

export type PlanningDropEta = {
  dropNumber: number;
  jobId: string;
  stopId: string;
  serviceStartSeconds: number;
  serviceEndSeconds: number;
};

export type PlanningDriverSchedulePreview = {
  planningStart: Date;
  schedule: DriverScheduleResult;
  dropEtas: PlanningDropEta[];
};

export type PlanningDriverScheduleFailureReason =
  | "unsupported_regime"
  | "day_base_unavailable"
  | "route_unavailable"
  | "route_leg_mismatch"
  | "physical_route_mismatch";

export type PlanningDriverScheduleBuildResult =
  | {
      ok: true;
      preview: PlanningDriverSchedulePreview;
    }
  | {
      ok: false;
      reason: PlanningDriverScheduleFailureReason;
    };

export type PlanningDriverScheduleInput = {
  jobs: PlanJob[];
  orderedVisits: FastPlotVisit[];
  serviceStops: PlanningServiceStop[];
  route: RouteResult | null;
  firstTravelSeconds: number;
  planningProfile: DriverPlanningProfile;
  planningDate: string;
  planningStart: Date;
  driverHoursState: DriverHoursState | null;
  activityDataAvailable: boolean;
  startLocationId: string;
  regime: ComplianceRegime | null;
  regimeReviewRequired: boolean;
};

/* Longest a driver can be on duty inside 24 h and still take a regular 11 h
   daily rest in that window (EC 561/2006 Art 8(2)). */
export const MAX_DUTY_SPAN_WITH_REGULAR_REST_SECONDS = 13 * 60 * 60;

/**
 * Advisory only (review PLAN-3). The scheduler inserts a daily rest when the
 * next drive would pass 9 h of daily driving, but service and loading time
 * never trigger one, so a dense multi-drop day can run for 20 h or more with
 * no rest. This does not model the 24 h rest window; it flags any schedule
 * day whose planned activity spans more than 13 h so the planner cannot read
 * the ETAs as a workable day. It never marks anything compliant.
 */
export function dutySpanWarnings(
  schedule: Pick<DriverScheduleResult, "events">
): string[] {
  const spans = new Map<number, { start: number; end: number }>();

  for (const event of schedule.events) {
    if (event.kind === "daily_rest") continue;

    const span = spans.get(event.day);

    if (!span) {
      spans.set(event.day, { start: event.startSeconds, end: event.endSeconds });
    } else {
      span.start = Math.min(span.start, event.startSeconds);
      span.end = Math.max(span.end, event.endSeconds);
    }
  }

  const warnings: string[] = [];

  for (const [day, span] of [...spans.entries()].sort((a, b) => a[0] - b[0])) {
    const seconds = span.end - span.start;

    if (seconds > MAX_DUTY_SPAN_WITH_REGULAR_REST_SECONDS) {
      const totalMinutes = Math.round(seconds / 60);
      warnings.push(
        `Day ${day} runs ${Math.floor(totalMinutes / 60)} h ${String(
          totalMinutes % 60
        ).padStart(2, "0")} m from first to last planned activity with no daily rest. A driver taking a regular 11 h daily rest can be on duty for at most 13 h in 24 h, and this preview does not schedule that rest. Split the work or review manually.`
      );
    }
  }

  return warnings;
}

function locationId(visit: FastPlotVisit): string {
  return `location:${visit.point.lat},${visit.point.lng}`;
}

function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function advisoryAssimilatedRuleProfile(
  planningDate: string
): DriverRuleProfile {
  return {
    id: "planning-assimilated-advisory",
    label: "Assimilated driver-hours planning assumptions",
    regime: "assimilated",
    effectiveFrom: planningDate,
    verified: false,
    sourceReference: null,
    maxContinuousDrivingSeconds:
      ASSIMILATED_DRIVER_HOURS_LIMITS.maxContinuousDrivingSeconds,
    qualifyingBreakSeconds:
      ASSIMILATED_DRIVER_HOURS_LIMITS.qualifyingBreakSeconds,
    maxDailyDrivingSeconds:
      ASSIMILATED_DRIVER_HOURS_LIMITS.standardDailyDrivingSeconds,
    dailyRestSeconds:
      ASSIMILATED_DRIVER_HOURS_LIMITS.regularDailyRestSeconds,
    maxDutyWindowSeconds: null,
  };
}

export function buildPlanningDriverSchedulePreview(
  input: PlanningDriverScheduleInput
): PlanningDriverScheduleBuildResult {
  if (
    input.regime !== "assimilated" ||
    input.regimeReviewRequired
  ) {
    return {
      ok: false,
      reason: "unsupported_regime",
    };
  }

  if (input.planningProfile === "day") {
    return {
      ok: false,
      reason: "day_base_unavailable",
    };
  }

  if (
    input.orderedVisits.length === 0 ||
    input.serviceStops.length === 0
  ) {
    return {
      ok: false,
      reason: "physical_route_mismatch",
    };
  }

  if (
    !Number.isFinite(input.firstTravelSeconds) ||
    input.firstTravelSeconds < 0
  ) {
    return {
      ok: false,
      reason: "route_unavailable",
    };
  }

  const expectedLegs =
    Math.max(0, input.orderedVisits.length - 1);

  if (expectedLegs > 0 && !input.route) {
    return {
      ok: false,
      reason: "route_unavailable",
    };
  }

  const legs = input.route?.legs ?? [];

  if (
    legs.length !== expectedLegs ||
    legs.some(
      (leg) =>
        !Number.isFinite(leg.travelTimeSeconds) ||
        leg.travelTimeSeconds < 0
    )
  ) {
    return {
      ok: false,
      reason: "route_leg_mismatch",
    };
  }

  const travel = new Map<string, number>();

  travel.set(
    edgeKey(
      input.startLocationId,
      locationId(input.orderedVisits[0])
    ),
    input.firstTravelSeconds
  );

  for (
    let index = 0;
    index < input.orderedVisits.length - 1;
    index += 1
  ) {
    travel.set(
      edgeKey(
        locationId(input.orderedVisits[index]),
        locationId(input.orderedVisits[index + 1])
      ),
      legs[index].travelTimeSeconds
    );
  }

  const awareRoute: SuccessfulDriverAwareRoute = {
    ok: true,
    jobs: input.jobs,
    physicalRoute: input.orderedVisits.map(
      (visit) => visit.point
    ),
    orderedVisits: input.orderedVisits,
    serviceStops: input.serviceStops,
    firstJobId:
      input.serviceStops[0]?.jobId ??
      input.jobs[0]?.id ??
      "",
    firstTravelSeconds: input.firstTravelSeconds,
    totalServiceSeconds:
      input.serviceStops.reduce(
        (total, stop) =>
          total + stop.serviceSeconds,
        0
      ),
  };

  const result = scheduleDriverAwareRoute({
    route: awareRoute,
    planningProfile: input.planningProfile,
    ruleProfile:
      advisoryAssimilatedRuleProfile(input.planningDate),
    startTimeSeconds: 0,
    startLocationId: input.startLocationId,
    baseLocationId: null,
    activityDataAvailable:
      input.activityDataAvailable,
    driverHoursState:
      input.driverHoursState,
    travelSecondsBetween: (
      fromLocationId,
      toLocationId
    ) => {
      if (fromLocationId === toLocationId) {
        return 0;
      }

      return (
        travel.get(
          edgeKey(fromLocationId, toLocationId)
        ) ?? null
      );
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: "physical_route_mismatch",
    };
  }

  const serviceByTaskId = new Map<
    string,
    PlanningServiceStop
  >(
    input.serviceStops.map(
      (stop): [string, PlanningServiceStop] => [
        `stop:${stop.stopId}`,
        stop,
      ]
    )
  );

  const dropEtas: PlanningDropEta[] = [];

  for (const event of result.schedule.events) {
    if (
      event.kind !== "service" ||
      !event.taskId
    ) {
      continue;
    }

    const service =
      serviceByTaskId.get(event.taskId);

    if (!service) continue;

    dropEtas.push({
      dropNumber:
        service.serviceSequenceNumber,
      jobId: service.jobId,
      stopId: service.stopId,
      serviceStartSeconds:
        event.startSeconds,
      serviceEndSeconds:
        event.endSeconds,
    });
  }

  return {
    ok: true,
    preview: {
      planningStart:
        new Date(input.planningStart),
      schedule: {
        ...result.schedule,
        warnings: [
          ...result.schedule.warnings,
          ...dutySpanWarnings(result.schedule),
        ],
      },
      dropEtas,
    },
  };
}
