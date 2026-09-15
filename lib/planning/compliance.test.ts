import { describe, expect, it } from "vitest";
import {
  evaluatePlanningCompliance,
  PLANNING_CHECKS_NOT_PERFORMED,
  type PlanningComplianceDriver,
} from "./compliance";
import type { DriverHoursState } from "./driverHoursState";

const DRIVER: PlanningComplianceDriver = {
  id: "driver-1",
  name: "Test Driver",
  tachograph_required: true,
  tachograph_card_number: "CARD-123",
  tachograph_expiry: "2027-01-01",
  tachograph_next_download_due: "2026-09-30",
  cpc_required: true,
  cpc_qualified: true,
  cpc_expiry: "2027-06-01",
};

function evaluate(
  overrides: Partial<Parameters<typeof evaluatePlanningCompliance>[0]> = {}
) {
  return evaluatePlanningCompliance({
    driver: DRIVER,
    hasPlannedJobs: true,
    plannedDrivingSeconds: 2 * 60 * 60,
    driverHours: null,
    today: "2026-08-31",
    ...overrides,
  });
}

const HOUR = 60 * 60;

function hoursState(
  overrides: Partial<DriverHoursState> = {}
): DriverHoursState {
  return {
    complete: true,
    planningStart: new Date("2026-08-31T14:00:00Z"),
    currentStateBoundaryKnown: true,
    continuousDrivingSeconds: 0,
    dailyDrivingSeconds: 0,
    previousWeekDrivingSeconds: 0,
    currentWeekDrivingSeconds: 0,
    fortnightDrivingSeconds: 0,
    currentWeekWorkingSeconds: 0,
    continuousDrivingRemainingSeconds: 4.5 * HOUR,
    standardDailyDrivingRemainingSeconds: 9 * HOUR,
    extendedDailyDrivingRemainingSeconds: 10 * HOUR,
    weeklyDrivingRemainingSeconds: 56 * HOUR,
    fortnightDrivingRemainingSeconds: 90 * HOUR,
    splitBreakFirstPartSatisfied: false,
    reducedDailyRestsSinceRegularWeeklyRest: 0,
    unknownActivityCount: 0,
    durationMismatchCount: 0,
    warnings: [],
    ...overrides,
  };
}

describe("evaluatePlanningCompliance with recorded hours (PLAN-1)", () => {
  it("warns when planned driving exceeds the daily driving left", () => {
    /* The review scenario: 8 h already driven since the last daily rest and
       a 4 h lane. This used to read "Wizard check ready" with no warning. */
    const result = evaluate({
      plannedDrivingSeconds: 4 * HOUR,
      driverHours: hoursState({
        dailyDrivingSeconds: 8 * HOUR,
        standardDailyDrivingRemainingSeconds: 1 * HOUR,
      }),
    });

    expect(result.status).toBe("warning");
    expect(result.warnings.join(" ")).toMatch(/1 h 00 m of daily driving left/);
    expect(result.dailyDrivingRemainingSeconds).toBe(1 * HOUR);
  });

  it("warns on the weekly and two-week limits", () => {
    const result = evaluate({
      plannedDrivingSeconds: 2 * HOUR,
      driverHours: hoursState({
        weeklyDrivingRemainingSeconds: 1 * HOUR,
        fortnightDrivingRemainingSeconds: 1.5 * HOUR,
      }),
    });

    expect(result.warnings.join(" ")).toMatch(/56 h weekly limit/);
    expect(result.warnings.join(" ")).toMatch(/90 h two-week limit/);
  });

  it("says a break is due when continuous driving left is shorter than the plan", () => {
    const result = evaluate({
      plannedDrivingSeconds: 2 * HOUR,
      driverHours: hoursState({
        continuousDrivingSeconds: 4 * HOUR,
        continuousDrivingRemainingSeconds: 0.5 * HOUR,
      }),
    });

    expect(result.warnings.join(" ")).toMatch(/45 min break is due after 0 h 30 m/);
    expect(result.breakDueAfterSeconds).toBe(0.5 * HOUR);
  });

  it("never claims readiness or compliance when no warning fires", () => {
    const result = evaluate({ driverHours: hoursState() });

    expect(result.status).toBe("ok");
    expect(result.statusLabel).not.toMatch(/ready|compliant|legal/i);
    expect(result.dataComplete).toBe(true);
  });

  it("does not use an incomplete hours state for the checks", () => {
    const result = evaluate({
      plannedDrivingSeconds: 4 * HOUR,
      driverHours: hoursState({
        complete: false,
        standardDailyDrivingRemainingSeconds: 1 * HOUR,
      }),
    });

    expect(result.status).toBe("incomplete");
    expect(result.missing).toContain("Driver's recorded hours are incomplete");
    expect(result.dailyDrivingRemainingSeconds).toBeNull();
  });

  it("states plainly which rules are not checked", () => {
    expect(PLANNING_CHECKS_NOT_PERFORMED).toMatch(/daily and weekly rest/);
    expect(PLANNING_CHECKS_NOT_PERFORMED).toMatch(/Working Time Directive/);
    expect(PLANNING_CHECKS_NOT_PERFORMED).toMatch(/ferry and train/);
    expect(PLANNING_CHECKS_NOT_PERFORMED).toMatch(/car-routing estimates/);
  });
});

describe("evaluatePlanningCompliance", () => {
  it("does not invent zero hours when activity data is absent", () => {
    const result = evaluate();

    expect(result.status).toBe("incomplete");
    expect(result.dataComplete).toBe(false);
    expect(result.missing).toContain("Driver activity data unavailable");
  });

  it("requires a driver for planned work", () => {
    const result = evaluate({ driver: null });

    expect(result.status).toBe("incomplete");
    expect(result.missing).toContain("No driver selected");
  });

  it("requires route time when work is planned", () => {
    const result = evaluate({ plannedDrivingSeconds: null });

    expect(result.missing).toContain("Planned route time unavailable");
  });

  it("treats an empty lane as having no compliance problem", () => {
    const result = evaluate({
      driver: null,
      hasPlannedJobs: false,
      plannedDrivingSeconds: null,
    });

    expect(result.status).toBe("ok");
    expect(result.statusLabel).toBe("No work planned");
    expect(result.dataComplete).toBe(true);
    expect(result.plannedDrivingSeconds).toBe(0);
  });

  it("warns when a required tachograph card has expired", () => {
    const result = evaluate({
      driver: {
        ...DRIVER,
        tachograph_expiry: "2026-08-30",
      },
    });

    expect(result.status).toBe("warning");
    expect(result.warnings).toContain("Tachograph card expired");
  });

  it("does not expire a card on its expiry date", () => {
    const result = evaluate({
      driver: {
        ...DRIVER,
        tachograph_expiry: "2026-08-31",
      },
    });

    expect(result.warnings).not.toContain("Tachograph card expired");
  });

  it("warns when the tachograph download is overdue", () => {
    const result = evaluate({
      driver: {
        ...DRIVER,
        tachograph_next_download_due: "2026-08-01",
      },
    });

    expect(result.warnings).toContain("Tachograph download overdue");
  });

  it("warns for planned driving beyond the 4 h 30 m review point", () => {
    const result = evaluate({
      plannedDrivingSeconds: (4 * 60 + 31) * 60,
    });

    expect(result.warnings).toContain(
      "Planned driving exceeds 4 h 30 m; break and regime review required"
    );
  });

  it("flags missing required tachograph metadata", () => {
    const result = evaluate({
      driver: {
        ...DRIVER,
        tachograph_card_number: null,
        tachograph_expiry: null,
      },
    });

    expect(result.warnings).toContain("Tachograph card number missing");
    expect(result.warnings).toContain("Tachograph card expiry missing");
  });

  it("warns when required CPC is not qualified", () => {
    const result = evaluate({
      driver: {
        ...DRIVER,
        cpc_qualified: false,
      },
    });

    expect(result.warnings).toContain(
      "Driver CPC is not marked qualified"
    );
  });
});
