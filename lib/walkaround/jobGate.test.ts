import { describe, expect, it } from "vitest";
import { JOB_GATE_MESSAGES, WALKAROUND_CHECK_MAX_AGE_HOURS, checkStillValid, jobGateDecision, jobGateDecisionAt } from "./jobGate";

const now = new Date("2026-10-07T12:00:00.000Z");
const period = { vehicleId: "v1", checkResult: "pass" as const, checkPerformedAt: "2026-10-07T05:50:00.000Z", vehicleVor: false };

describe("jobGateDecision", () => {
  it("never gates subcontractor drivers", () => {
    expect(jobGateDecision({ portalType: "subcontractor_driver", openShift: null }, now)).toEqual({ ok: true });
  });

  it("needs an open shift", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: null }, now)).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noShift });
  });

  it("needs a vehicle on the shift", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: null } }, now)).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noVehicle });
  });

  it("needs a pass or minor check on that vehicle", () => {
    for (const checkResult of [null, "dangerous"] as const) {
      expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: { ...period, checkResult } } }, now)).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noCheck });
    }
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: { ...period, checkResult: "minor" } } }, now)).toEqual({ ok: true });
  });

  it("refuses when the vehicle has since gone VOR", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: { ...period, vehicleVor: true } } }, now)).toEqual({ ok: false, message: JOB_GATE_MESSAGES.vor });
  });

  it("allows a driver with a passed check on a road-worthy vehicle", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: period } }, now)).toEqual({ ok: true });
  });
});

describe("jobGateDecisionAt", () => {
  const shift = { startedAt: "2026-10-07T06:00:00.000Z", endedAt: "2026-10-07T15:00:00.000Z" };
  const AT = "2026-10-07T10:00:00.000Z";
  const performed = "2026-10-07T05:55:00.000Z";

  it("does not gate subcontractor drivers", () => {
    expect(jobGateDecisionAt({ at: AT, portalType: "subcontractor_driver", shift: null, periodAt: null })).toEqual({ ok: true });
  });

  it("refuses when the named shift does not exist", () => {
    expect(jobGateDecisionAt({ at: AT, portalType: "direct_driver", shift: null, periodAt: null })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noShift });
  });

  it("refuses when no vehicle period covered the time", () => {
    expect(jobGateDecisionAt({ at: AT, portalType: "direct_driver", shift, periodAt: null })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noVehicle });
  });

  it("refuses a failed check", () => {
    const periodAt = { checkResult: "dangerous" as const, checkPerformedAt: performed, open: false, vehicleVor: false };
    expect(jobGateDecisionAt({ at: AT, portalType: "direct_driver", shift, periodAt })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noCheck });
  });

  it("accepts pass and minor on a closed period even if the vehicle is VOR now", () => {
    for (const checkResult of ["pass", "minor"] as const) {
      expect(jobGateDecisionAt({ at: AT, portalType: "direct_driver", shift, periodAt: { checkResult, checkPerformedAt: performed, open: false, vehicleVor: true } })).toEqual({ ok: true });
    }
  });

  it("refuses a period with no check result", () => {
    const periodAt = { checkResult: null, checkPerformedAt: performed, open: false, vehicleVor: false };
    expect(jobGateDecisionAt({ at: AT, portalType: "direct_driver", shift, periodAt })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noCheck });
  });

  it("accepts an open period whose vehicle is not VOR", () => {
    const periodAt = { checkResult: "pass" as const, checkPerformedAt: performed, open: true, vehicleVor: false };
    expect(jobGateDecisionAt({ at: AT, portalType: "direct_driver", shift, periodAt })).toEqual({ ok: true });
  });

  it("refuses VOR on a period that is still open", () => {
    const periodAt = { checkResult: "pass" as const, checkPerformedAt: performed, open: true, vehicleVor: true };
    expect(jobGateDecisionAt({ at: AT, portalType: "direct_driver", shift, periodAt })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.vor });
  });
});

describe("walkaround check age (S-2)", () => {
  it("is 24 hours", () => {
    expect(WALKAROUND_CHECK_MAX_AGE_HOURS).toBe(24);
  });

  it("accepts a check exactly 24 hours old and refuses one a minute older", () => {
    expect(checkStillValid("2026-10-06T12:00:00.000Z", now)).toBe(true);
    expect(checkStillValid("2026-10-06T11:59:00.000Z", now)).toBe(false);
  });

  it("fails closed on a missing or unreadable time", () => {
    expect(checkStillValid(null, now)).toBe(false);
    expect(checkStillValid("not a date", now)).toBe(false);
  });

  it("refuses a shift left open since yesterday, telling the driver to do a new check", () => {
    const stale = { ...period, checkPerformedAt: "2026-10-06T05:50:00.000Z" };
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: stale } }, now)).toEqual({
      ok: false,
      message: JOB_GATE_MESSAGES.checkExpired,
    });
    expect(JOB_GATE_MESSAGES.checkExpired).toContain("Do a new walkaround check");
  });

  it("refuses a passed check with no recorded time", () => {
    const noTime = { ...period, checkPerformedAt: null };
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: noTime } }, now)).toEqual({
      ok: false,
      message: JOB_GATE_MESSAGES.checkExpired,
    });
  });

  it("judges a queued item's check age at its recorded time, not at receive time", () => {
    const shift = { startedAt: "2026-10-06T05:00:00.000Z", endedAt: null };
    const periodAt = { checkResult: "pass" as const, checkPerformedAt: "2026-10-06T05:10:00.000Z", open: false, vehicleVor: false };
    // Recorded 10:00 the same day: inside the window even though it reaches the server much later.
    expect(jobGateDecisionAt({ portalType: "direct_driver", at: "2026-10-06T10:00:00.000Z", shift, periodAt })).toEqual({ ok: true });
    // Recorded the next morning on the same open shift: the check has expired.
    expect(jobGateDecisionAt({ portalType: "direct_driver", at: "2026-10-07T06:00:00.000Z", shift, periodAt })).toEqual({
      ok: false,
      message: JOB_GATE_MESSAGES.checkExpired,
    });
  });

  it("never gates a subcontractor on check age", () => {
    expect(jobGateDecisionAt({ portalType: "subcontractor_driver", at: "2026-10-07T06:00:00.000Z", shift: null, periodAt: null })).toEqual({ ok: true });
  });
});
