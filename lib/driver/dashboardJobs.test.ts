import { describe, expect, it } from "vitest";
import {
  getDriverJobOperationalDate,
  isDriverJobForDate,
} from "./dashboardJobs";

describe("getDriverJobOperationalDate", () => {
  it("prefers scheduled_date when both dates exist", () => {
    expect(
      getDriverJobOperationalDate({
        job_date: "2026-08-28",
        scheduled_date: "2026-08-30",
      })
    ).toBe("2026-08-30");
  });

  it("falls back to job_date when scheduled_date is missing", () => {
    expect(
      getDriverJobOperationalDate({
        job_date: "2026-08-30",
        scheduled_date: null,
      })
    ).toBe("2026-08-30");
  });

  it("returns null when both dates are missing", () => {
    expect(
      getDriverJobOperationalDate({
        job_date: null,
        scheduled_date: null,
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
        },
        "2026-08-30"
      )
    ).toBe(false);
  });
});
