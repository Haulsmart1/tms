import { describe, expect, it } from "vitest";
import { JOB_GATE_MESSAGES, jobGateDecision } from "./jobGate";

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
