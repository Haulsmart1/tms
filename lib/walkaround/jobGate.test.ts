import { describe, expect, it } from "vitest";
import { JOB_GATE_MESSAGES, jobGateDecision, jobGateDecisionAt } from "./jobGate";

const period = { vehicleId: "v1", checkResult: "pass" as const, vehicleVor: false };

describe("jobGateDecision", () => {
  it("never gates subcontractor drivers", () => {
    expect(jobGateDecision({ portalType: "subcontractor_driver", openShift: null })).toEqual({ ok: true });
  });

  it("needs an open shift", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: null })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noShift });
  });

  it("needs a vehicle on the shift", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: null } })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noVehicle });
  });

  it("needs a pass or minor check on that vehicle", () => {
    for (const checkResult of [null, "dangerous"] as const) {
      expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: { ...period, checkResult } } })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noCheck });
    }
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: { ...period, checkResult: "minor" } } })).toEqual({ ok: true });
  });

  it("refuses when the vehicle has since gone VOR", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: { ...period, vehicleVor: true } } })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.vor });
  });

  it("allows a driver with a passed check on a road-worthy vehicle", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: period } })).toEqual({ ok: true });
  });
});

describe("jobGateDecisionAt", () => {
  const shift = { startedAt: "2026-10-07T06:00:00.000Z", endedAt: "2026-10-07T15:00:00.000Z" };

  it("does not gate subcontractor drivers", () => {
    expect(jobGateDecisionAt({ portalType: "subcontractor_driver", shift: null, periodAt: null })).toEqual({ ok: true });
  });

  it("refuses when the named shift does not exist", () => {
    expect(jobGateDecisionAt({ portalType: "direct_driver", shift: null, periodAt: null })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noShift });
  });

  it("refuses when no vehicle period covered the time", () => {
    expect(jobGateDecisionAt({ portalType: "direct_driver", shift, periodAt: null })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noVehicle });
  });

  it("refuses a failed check", () => {
    const periodAt = { checkResult: "dangerous" as const, open: false, vehicleVor: false };
    expect(jobGateDecisionAt({ portalType: "direct_driver", shift, periodAt })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noCheck });
  });

  it("accepts pass and minor on a closed period even if the vehicle is VOR now", () => {
    for (const checkResult of ["pass", "minor"] as const) {
      expect(jobGateDecisionAt({ portalType: "direct_driver", shift, periodAt: { checkResult, open: false, vehicleVor: true } })).toEqual({ ok: true });
    }
  });

  it("refuses VOR on a period that is still open", () => {
    const periodAt = { checkResult: "pass" as const, open: true, vehicleVor: true };
    expect(jobGateDecisionAt({ portalType: "direct_driver", shift, periodAt })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.vor });
  });
});
