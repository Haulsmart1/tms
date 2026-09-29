import { describe, expect, it } from "vitest";
import type { DriverDefectView, DriverShiftState } from "../walkaround/driverState";
import { JOB_GATE_MESSAGES } from "../walkaround/jobGate";
import {
  breakEvent,
  clockTime,
  endShiftEvent,
  gateForState,
  objectionEvent,
  parseOdometer,
  recordedHours,
  walkaroundHref,
} from "./driverActions";

const stamp = { clientId: "e1", occurredAt: "2026-09-29T09:00:00Z" };

const base: DriverShiftState = {
  today: "2026-09-29",
  timeZone: "Europe/London",
  companyName: "Acme Haulage",
  onCallPhone: null,
  assignedVehicle: null,
  vehicles: [
    { id: "v1", registration: "AB12 CDE", vor: false },
    { id: "v2", registration: "FG34 HIJ", vor: true },
  ],
  catalogue: [],
  openShift: null,
  blockingCheck: null,
  syncPending: false,
};

const onShift: DriverShiftState = {
  ...base,
  openShift: {
    id: "s1",
    clientId: "shift-client",
    startedAt: "2026-09-29T04:48:00Z",
    onBreak: false,
    breaks: [{ startedAt: "2026-09-29T07:00:00Z", endedAt: "2026-09-29T07:30:00Z" }],
    currentVehicle: { vehicleId: "v1", registration: "AB12 CDE", startOdometer: 1000, checkResult: "pass" },
  },
};

const defect: DriverDefectView = {
  clientId: "d1",
  label: "Brakes: Air leak",
  finalSeverity: "dangerous",
  severitySource: "baseline",
  reason: "Classed dangerous in the baseline checklist (based on DVSA guidance).",
  guidance: "Listen.",
  note: null,
  photoCount: 0,
  objection: null,
};

describe("breakEvent", () => {
  it("names the open shift", () => {
    expect(breakEvent(onShift, "break_started", stamp)).toEqual({ ok: true, event: { type: "break_started", ...stamp, shiftClientId: "shift-client" } });
  });

  it("refuses with no shift or the wrong break state", () => {
    expect(breakEvent(base, "break_started", stamp).ok).toBe(false);
    expect(breakEvent(onShift, "break_ended", stamp).ok).toBe(false);
    const onBreak = { ...onShift, openShift: { ...onShift.openShift!, onBreak: true } };
    expect(breakEvent(onBreak, "break_started", stamp).ok).toBe(false);
    expect(breakEvent(onBreak, "break_ended", stamp).ok).toBe(true);
  });
});

describe("endShiftEvent", () => {
  it("needs a whole-number odometer", () => {
    expect(parseOdometer(" 1234 ")).toBe(1234);
    expect(parseOdometer("12.5")).toBeNull();
    expect(parseOdometer("")).toBeNull();
    expect(parseOdometer("12345678")).toBeNull();
    expect(endShiftEvent(onShift, "abc", [], stamp).ok).toBe(false);
  });

  it("carries the new defects and the shift's client id", () => {
    const d = { clientId: "d9", catalogueItemId: null, driverSeverity: null, note: "Wing mirror loose" };
    expect(endShiftEvent(onShift, "1200", [d], stamp)).toEqual({
      ok: true,
      event: { type: "shift_ended", ...stamp, shiftClientId: "shift-client", odometer: 1200, newDefects: [d] },
    });
  });

  it("refuses defects when no vehicle is on the shift", () => {
    const noVehicle = { ...onShift, openShift: { ...onShift.openShift!, currentVehicle: null } };
    const d = { clientId: "d9", catalogueItemId: null, driverSeverity: null, note: "x" };
    expect(endShiftEvent(noVehicle, "1200", [d], stamp).ok).toBe(false);
    expect(endShiftEvent(noVehicle, "1200", [], stamp).ok).toBe(true);
  });

  it("sends no odometer when no vehicle is on the shift (office-started)", () => {
    const noVehicle = { ...onShift, openShift: { ...onShift.openShift!, currentVehicle: null } };
    expect(endShiftEvent(noVehicle, "", [], stamp)).toEqual({
      ok: true,
      event: { type: "shift_ended", ...stamp, shiftClientId: "shift-client", odometer: null, newDefects: [] },
    });
    // Not a reading of any vehicle, so not sent even if something was typed.
    const typed = endShiftEvent(noVehicle, "1200", [], stamp);
    expect(typed.ok && typed.event.odometer).toBeNull();
  });

  it("still needs the odometer while a vehicle is on the shift", () => {
    expect(endShiftEvent(onShift, "", [], stamp)).toEqual({ ok: false, error: "Enter the odometer reading as a whole number." });
  });
});

describe("objectionEvent", () => {
  const blocked: DriverShiftState = {
    ...base,
    blockingCheck: { checkClientId: "c1", vehicleId: "v1", registration: "AB12 CDE", performedAt: stamp.occurredAt, defects: [defect] },
  };

  it("builds an objection with a trimmed reason", () => {
    expect(objectionEvent(blocked, "d1", "  The leak is the horn  ", stamp)).toEqual({
      ok: true,
      event: { type: "objection_raised", ...stamp, defectClientId: "d1", reason: "The leak is the horn" },
    });
  });

  it("refuses a short reason, an unknown defect and a second objection", () => {
    expect(objectionEvent(blocked, "d1", "no", stamp).ok).toBe(false);
    expect(objectionEvent(blocked, "d1", "x".repeat(1001), stamp).ok).toBe(false);
    expect(objectionEvent(blocked, "zz", "A fine reason", stamp).ok).toBe(false);
    const objected = { ...blocked, blockingCheck: { ...blocked.blockingCheck!, defects: [{ ...defect, objection: { status: "pending" as const, decisionNote: null } }] } };
    expect(objectionEvent(objected, "d1", "A fine reason", stamp).ok).toBe(false);
  });
});

describe("gateForState", () => {
  it("follows the job gate", () => {
    expect(gateForState(base)).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noShift });
    expect(gateForState(onShift)).toEqual({ ok: true });
    expect(gateForState({ ...onShift, openShift: { ...onShift.openShift!, currentVehicle: null } })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noVehicle });
  });

  it("locks jobs when the office has since taken the vehicle off the road", () => {
    const vor = { ...onShift, vehicles: [{ id: "v1", registration: "AB12 CDE", vor: true }] };
    expect(gateForState(vor)).toEqual({ ok: false, message: JOB_GATE_MESSAGES.vor });
  });
});

describe("display helpers", () => {
  it("sends a driver on shift to a swap check", () => {
    expect(walkaroundHref(base)).toBe("/driver/walkaround?phase=start");
    expect(walkaroundHref(onShift)).toBe("/driver/walkaround?phase=swap");
  });

  it("summarises recorded hours with breaks taken off", () => {
    const summary = recordedHours(onShift, new Date("2026-09-29T09:48:00Z"));
    expect(summary).toMatchObject({ dutyMinutes: 300, breakMinutes: 30, workedMinutes: 270, flags: [] });
    expect(recordedHours(base, new Date())).toBeNull();
  });

  it("shows the time in the operator's zone", () => {
    expect(clockTime("2026-09-29T04:48:00Z", "Europe/London")).toBe("05:48");
    expect(clockTime("2026-09-29T04:48:00Z", "Not/AZone")).toMatch(/^\d{2}:\d{2}$/);
    expect(clockTime("nonsense", "Europe/London")).toBe("");
  });
});
