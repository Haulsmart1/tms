import type { DriverHoursState } from "./driverHoursState";

export type PlanningComplianceStatus =
  | "ok"
  | "warning"
  | "incomplete";

export type PlanningComplianceDriver = {
  id: string;
  name: string;
  tachograph_required: boolean | null;
  tachograph_card_number: string | null;
  tachograph_expiry: string | null;
  tachograph_next_download_due: string | null;
  cpc_required: boolean | null;
  cpc_qualified: boolean | null;
  cpc_expiry: string | null;
};

export type PlanningComplianceInput = {
  driver: PlanningComplianceDriver | null;
  hasPlannedJobs: boolean;
  /** Car-routed travel time between the lane's stops (PLAN-5), or null before a route exists. */
  plannedDrivingSeconds: number | null;
  /**
   * The driver's recorded hours as at the planning instant. Null when they
   * were not loaded (no history, query failed, truncated, or a future start).
   * Only a state with complete === true is used for the driving checks.
   */
  driverHours: DriverHoursState | null;
  today: string;
};

export type PlanningCompliance = {
  status: PlanningComplianceStatus;
  statusLabel: string;
  dataComplete: boolean;
  plannedDrivingSeconds: number | null;
  /** Daily driving still available under the 9 h standard limit, or null when unknown. */
  dailyDrivingRemainingSeconds: number | null;
  /** Driving left before a 45 min break is due, or null when unknown. */
  breakDueAfterSeconds: number | null;
  warnings: string[];
  missing: string[];
};

/*
  What this lane check does and does not do (review PLAN-1).

  It checks, when the driver's recorded hours are complete:
    - EC 561/2006 Art 6(1): 9 h daily driving since the last daily rest. The
      twice-weekly extension to 10 h is NOT assumed available, because using
      it depends on how many extensions this week already used.
    - Art 6(2) and 6(3): 56 h in the current week, 90 h over two weeks.
    - Art 7: a 45 min break (or 15 min then 30 min) after 4 h 30 m of
      driving; continuous driving already done counts.
  It also checks tachograph card and CPC facts on the driver record.

  It does NOT check daily or weekly rest (Art 8), Working Time Directive
  limits, ferry or train interruptions (Art 9), night work, or HGV road
  restrictions and speeds; planned driving is a car-routed estimate that
  excludes travel from the vehicle to the first stop. The UI must say so, and
  the "ok" label deliberately makes no compliance claim.
*/
const DRIVING_REVIEW_SECONDS = 4.5 * 60 * 60;
const STANDARD_DAILY_DRIVING_SECONDS = 9 * 60 * 60;

export const PLANNING_CHECKS_NOT_PERFORMED =
  "Not checked: daily and weekly rest, Working Time Directive limits, ferry and train rules, and HGV road restrictions. Drive times are car-routing estimates without traffic and exclude travel from the vehicle to the first stop.";

function normaliseDate(value: string | null): string | null {
  if (!value) return null;

  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function isPastDate(value: string | null, today: string): boolean {
  const date = normaliseDate(value);
  return date !== null && date < today;
}

function hasText(value: string | null): boolean {
  return Boolean(value?.trim());
}

function hoursMinutes(seconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${String(minutes).padStart(2, "0")} m`;
}

export function evaluatePlanningCompliance(
  input: PlanningComplianceInput
): PlanningCompliance {
  const warnings: string[] = [];
  const missing: string[] = [];

  if (!input.hasPlannedJobs) {
    return {
      status: "ok",
      statusLabel: "No work planned",
      dataComplete: true,
      plannedDrivingSeconds: 0,
      dailyDrivingRemainingSeconds: null,
      breakDueAfterSeconds: null,
      warnings,
      missing,
    };
  }

  if (!input.driver) {
    missing.push("No driver selected");
  }

  if (input.plannedDrivingSeconds === null) {
    missing.push("Planned route time unavailable");
  }

  const hours =
    input.driver && input.driverHours?.complete === true
      ? input.driverHours
      : null;

  if (input.driver && !hours) {
    missing.push(
      input.driverHours
        ? "Driver's recorded hours are incomplete"
        : "Driver activity data unavailable"
    );
  }

  const driver = input.driver;

  if (driver?.tachograph_required) {
    if (!hasText(driver.tachograph_card_number)) {
      warnings.push("Tachograph card number missing");
    }

    if (!normaliseDate(driver.tachograph_expiry)) {
      warnings.push("Tachograph card expiry missing");
    } else if (isPastDate(driver.tachograph_expiry, input.today)) {
      warnings.push("Tachograph card expired");
    }

    if (
      driver.tachograph_next_download_due &&
      isPastDate(driver.tachograph_next_download_due, input.today)
    ) {
      warnings.push("Tachograph download overdue");
    }
  }

  if (driver?.cpc_required) {
    if (driver.cpc_qualified === false) {
      warnings.push("Driver CPC is not marked qualified");
    }

    if (
      driver.cpc_expiry &&
      isPastDate(driver.cpc_expiry, input.today)
    ) {
      warnings.push("Driver CPC expired");
    }
  }

  const planned = input.plannedDrivingSeconds;

  if (hours && planned !== null) {
    if (planned > hours.standardDailyDrivingRemainingSeconds) {
      warnings.push(
        `Planned driving ${hoursMinutes(planned)} exceeds the ${hoursMinutes(
          hours.standardDailyDrivingRemainingSeconds
        )} of daily driving left (9 h limit, ${hoursMinutes(
          hours.dailyDrivingSeconds
        )} already driven since the last daily rest)`
      );
    }

    if (planned > hours.weeklyDrivingRemainingSeconds) {
      warnings.push(
        `Planned driving exceeds the ${hoursMinutes(
          hours.weeklyDrivingRemainingSeconds
        )} left of the 56 h weekly limit`
      );
    }

    if (planned > hours.fortnightDrivingRemainingSeconds) {
      warnings.push(
        `Planned driving exceeds the ${hoursMinutes(
          hours.fortnightDrivingRemainingSeconds
        )} left of the 90 h two-week limit`
      );
    }

    if (planned > hours.continuousDrivingRemainingSeconds) {
      warnings.push(
        `A 45 min break is due after ${hoursMinutes(
          hours.continuousDrivingRemainingSeconds
        )} more driving; plan it into the route`
      );
    }
  } else if (planned !== null && planned > DRIVING_REVIEW_SECONDS) {
    warnings.push(
      "Planned driving exceeds 4 h 30 m; break and regime review required"
    );
  }

  const dataComplete = missing.length === 0;

  let status: PlanningComplianceStatus = "ok";
  /* Deliberately not "ready" or "compliant": most rules are not checked. */
  let statusLabel = "No driving-limit warnings";

  if (warnings.length > 0) {
    status = "warning";
    statusLabel = "Review required";
  } else if (!dataComplete) {
    status = "incomplete";
    statusLabel = "Hours not checked: data incomplete";
  }

  return {
    status,
    statusLabel,
    dataComplete,
    plannedDrivingSeconds: input.plannedDrivingSeconds,
    dailyDrivingRemainingSeconds: hours
      ? Math.min(
          hours.standardDailyDrivingRemainingSeconds,
          STANDARD_DAILY_DRIVING_SECONDS
        )
      : null,
    breakDueAfterSeconds: hours
      ? hours.continuousDrivingRemainingSeconds
      : null,
    warnings,
    missing,
  };
}
