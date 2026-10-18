import { describe, expect, it } from "vitest";
import {
  dashboardAssignedJobs,
  getDriverJobOperationalDate,
  isDriverJobForDate,
} from "./dashboardJobs";

describe("dashboard assignments for offline preparation", () => {
  it("deduplicates in favor of today's server-authorized route without changing either input", () => {
    const current = Object.freeze({ id: "same", route_order: 1 });
    const history = Object.freeze({ id: "same", route_order: 9 });
    const data = { todayJobs: [current], jobs: [history, { id: "recent", route_order: 2 }] };
    expect(dashboardAssignedJobs(data)).toEqual([current, data.jobs[1]]);
    expect(data.jobs[0]).toBe(history);
    expect(data.todayJobs).toEqual([current]);
  });

  it("supports older cached/API responses without a separate today's list", () => {
    const jobs = [{ id: "old-api" }];
    expect(dashboardAssignedJobs({ jobs })).toEqual(jobs);
    expect(dashboardAssignedJobs({ jobs: [], todayJobs: [] })).toEqual([]);
  });
});

describe("getDriverJobOperationalDate", () => {
  it("prefers scheduled_date when both dates exist", () => {
    expect(
      getDriverJobOperationalDate({
        job_date: "2026-08-28",
        scheduled_date: "2026-08-30",
        planning_date: null,
      })
    ).toBe("2026-08-30");
  });

  it("falls back to job_date when scheduled_date is missing", () => {
    expect(
      getDriverJobOperationalDate({
        job_date: "2026-08-30",
        scheduled_date: null,
        planning_date: null,
      })
    ).toBe("2026-08-30");
  });

  it("returns null when both dates are missing", () => {
    expect(
      getDriverJobOperationalDate({
        job_date: null,
        scheduled_date: null,
        planning_date: null,
      })
    ).toBeNull();
  });
});

describe("isDriverJobForDate", () => {
  it("includes a job scheduled today even when job_date is older", () => {
    expect(
      isDriverJobForDate(
        {
          job_date: "2026-08-28",
          scheduled_date: "2026-08-30",
          planning_date: null,
        },
        "2026-08-30"
      )
    ).toBe(true);
  });

  it("uses job_date when no scheduled_date exists", () => {
    expect(
      isDriverJobForDate(
        {
          job_date: "2026-08-30",
          scheduled_date: null,
          planning_date: null,
        },
        "2026-08-30"
      )
    ).toBe(true);
  });

  it("excludes a job scheduled for another day", () => {
    expect(
      isDriverJobForDate(
        {
          job_date: "2026-08-28",
          scheduled_date: "2026-08-29",
          planning_date: null,
        },
        "2026-08-30"
      )
    ).toBe(false);
  });
});

// Planning dates override source dates in both directions.
describe("planning date precedence", () => {
  const today = "2026-10-08";

  it("includes Bob's planned jobs even when both source dates are older", () => {
    expect(isDriverJobForDate({
      planning_date: today,
      scheduled_date: "2026-10-04",
      job_date: "2026-08-26",
    }, today)).toBe(true);
  });

  it("excludes Kent-style work moved off its original scheduled day", () => {
    expect(isDriverJobForDate({
      planning_date: "2026-10-09",
      scheduled_date: today,
      job_date: today,
    }, today)).toBe(false);
  });

  it("does not fall back to job_date when an explicit plan is on another day", () => {
    expect(isDriverJobForDate({
      planning_date: "2026-10-07",
      scheduled_date: null,
      job_date: today,
    }, today)).toBe(false);
  });

  it("uses the planning date for historical job labels too", () => {
    expect(getDriverJobOperationalDate({
      planning_date: "2026-10-06",
      scheduled_date: "2026-10-04",
      job_date: "2026-08-26",
    })).toBe("2026-10-06");
  });
});
