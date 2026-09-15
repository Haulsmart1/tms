import { describe, expect, it } from "vitest";
import { SUCCESSOR_MAX_LAG_DAYS, selectSuccessorAction } from "./close";

const TODAY = "2026-04-18";

function decide(overrides: Partial<Parameters<typeof selectSuccessorAction>[0]> = {}) {
  return selectSuccessorAction({
    billingModel: "v2_period",
    companyStatus: "active",
    hasOpenPeriod: false,
    latestPeriod: {
      status: "invoiced",
      closedReason: "scheduled",
      periodEndISO: TODAY,
    },
    hasActiveLicence: true,
    todayISO: TODAY,
    lagDays: 0,
    ...overrides,
  });
}

describe("selectSuccessorAction", () => {
  it("opens the next period exactly where the settled one ended", () => {
    expect(decide()).toEqual({ kind: "open", startISO: TODAY });
  });

  // BILL2-7: re-runnable, so a failure at settlement is repaired the next day.
  it("still opens it a few days late, from the original end", () => {
    expect(
      decide({
        todayISO: "2026-04-22",
        lagDays: 4,
      })
    ).toEqual({ kind: "open", startISO: TODAY });
  });

  // BILL2-1: a cancelled company is never rolled over.
  it("never rolls over a cancelled company", () => {
    expect(decide({ companyStatus: "canceled" })).toEqual({
      kind: "none",
      reason: "not_active",
    });
  });

  it("never rolls over out of a cancellation or cooling-off period", () => {
    for (const closedReason of ["cancellation", "cooling_off", "minimum_declined"]) {
      expect(
        decide({
          latestPeriod: { status: "invoiced", closedReason, periodEndISO: TODAY },
        })
      ).toEqual({ kind: "none", reason: "previous_not_scheduled" });
    }
  });

  // Exposure cap: debt does not compound past one unpaid period.
  it("does not open a period after one that is still unpaid", () => {
    for (const status of ["closed", "failed", "closing"] as const) {
      expect(
        decide({
          latestPeriod: { status, closedReason: "scheduled", periodEndISO: TODAY },
        })
      ).toEqual({ kind: "none", reason: "previous_not_settled" });
    }
  });

  it("does not open one for a past due company", () => {
    expect(decide({ companyStatus: "past_due" }).kind).toBe("none");
  });

  it("does not open one for a fleet with nothing active", () => {
    expect(decide({ hasActiveLicence: false })).toEqual({
      kind: "none",
      reason: "no_active_licence",
    });
  });

  it("does nothing when a period is already open", () => {
    expect(decide({ hasOpenPeriod: true })).toEqual({
      kind: "none",
      reason: "has_open_period",
    });
  });

  it("treats a legacy period with no close reason as scheduled", () => {
    expect(
      decide({
        latestPeriod: { status: "invoiced", closedReason: null, periodEndISO: TODAY },
      }).kind
    ).toBe("open");
  });

  // Past the dunning ladder the company was suspended; it comes back through
  // an activation or the card route, which take the minimum again.
  it("reports a long-stale gap instead of billing suspended time", () => {
    expect(decide({ lagDays: SUCCESSOR_MAX_LAG_DAYS + 1 })).toEqual({
      kind: "stale",
      lagDays: SUCCESSOR_MAX_LAG_DAYS + 1,
    });
  });
});
