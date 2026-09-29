import { describe, expect, it } from "vitest";
import type { DriverShiftState } from "../walkaround/driverState";
import type { CatalogueItem } from "../walkaround/types";
import type { DriverEvent } from "./events";
import { projectDriverState } from "./projection";

const leak: CatalogueItem = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: null,
  code: "brakes.air_leak",
  category: "brakes_air",
  itemLabel: "Brakes and air build-up",
  defectLabel: "Audible air leak",
  guidance: "Listen.",
  severity: "dangerous",
  appliesTo: "both",
  sortOrder: 10,
  retiredAt: null,
};

const server: DriverShiftState = {
  today: "2026-09-29",
  timeZone: "Europe/London",
  companyName: "Acme Haulage",
  onCallPhone: "07700 900000",
  assignedVehicle: { id: "v1", registration: "AB12 CDE" },
  vehicles: [
    { id: "v1", registration: "AB12 CDE", vor: false },
    { id: "v2", registration: "FG34 HIJ", vor: false },
  ],
  catalogue: [leak],
  openShift: null,
  blockingCheck: null,
  syncPending: false,
};

function check(over: Partial<Extract<DriverEvent, { type: "check_submitted" }>>): DriverEvent {
  return {
    type: "check_submitted",
    clientId: "c1",
    occurredAt: "2026-09-29T05:40:00Z",
    phase: "start",
    shiftClientId: null,
    vehicleId: "v1",
    confirmation: "registration",
    qrPayload: null,
    typedRegistration: "AB12CDE",
    mismatchReason: null,
    odometer: 1000,
    previousEndOdometer: null,
    declarationAccepted: true,
    checklistItemIds: [leak.id],
    defects: [],
    ...over,
  };
}

describe("projectDriverState", () => {
  it("returns the server state untouched when nothing is queued", () => {
    expect(projectDriverState(server, [])).toEqual(server);
  });

  it("opens a shift locally for a passing check", () => {
    const s = projectDriverState(server, [check({})]);
    expect(s.syncPending).toBe(true);
    expect(s.openShift).toMatchObject({ clientId: "c1", startedAt: "2026-09-29T05:40:00Z", onBreak: false, currentVehicle: { vehicleId: "v1", registration: "AB12 CDE", startOdometer: 1000, checkResult: "pass" } });
  });

  it("shows a blocking check, with reasons, for a dangerous one", () => {
    const s = projectDriverState(server, [check({ defects: [{ clientId: "d1", catalogueItemId: leak.id, driverSeverity: null, note: "hiss at rear" }] })]);
    expect(s.openShift).toBeNull();
    expect(s.blockingCheck).toMatchObject({
      checkClientId: "c1",
      registration: "AB12 CDE",
      defects: [{ clientId: "d1", label: "Brakes and air build-up: Audible air leak", finalSeverity: "dangerous", reason: "Classed dangerous in the baseline checklist (based on DVSA guidance).", guidance: "Listen.", note: "hiss at rear", objection: null }],
    });
  });

  it("tracks breaks, swaps and the end of the shift", () => {
    let s = projectDriverState(server, [check({}), { type: "break_started", clientId: "b1", shiftClientId: "c1", occurredAt: "2026-09-29T09:00:00Z" }]);
    expect(s.openShift?.onBreak).toBe(true);
    s = projectDriverState(server, [check({}), { type: "break_started", clientId: "b1", shiftClientId: "c1", occurredAt: "2026-09-29T09:00:00Z" }, { type: "break_ended", clientId: "b2", shiftClientId: "c1", occurredAt: "2026-09-29T09:45:00Z" }]);
    expect(s.openShift?.onBreak).toBe(false);
    expect(s.openShift?.breaks).toEqual([{ startedAt: "2026-09-29T09:00:00Z", endedAt: "2026-09-29T09:45:00Z" }]);
    s = projectDriverState(server, [check({}), check({ clientId: "c2", phase: "swap", shiftClientId: "c1", vehicleId: "v2", previousEndOdometer: 1100, odometer: 5000 })]);
    expect(s.openShift?.currentVehicle).toMatchObject({ vehicleId: "v2", startOdometer: 5000 });
    s = projectDriverState(server, [check({}), { type: "shift_ended", clientId: "e1", shiftClientId: "c1", occurredAt: "2026-09-29T14:00:00Z", odometer: 1200, newDefects: [] }]);
    expect(s.openShift).toBeNull();
  });

  it("never lets an event for another shift touch the open one", () => {
    const open: DriverShiftState = {
      ...server,
      openShift: { id: "s2", clientId: "new", startedAt: "2026-09-29T10:00:00Z", onBreak: false, breaks: [], currentVehicle: null },
    };
    let s = projectDriverState(open, [{ type: "break_started", clientId: "b1", shiftClientId: "old", occurredAt: "2026-09-29T11:00:00Z" }]);
    expect(s.openShift).toMatchObject({ id: "s2", onBreak: false, breaks: [] });
    s = projectDriverState(open, [{ type: "shift_ended", clientId: "e1", shiftClientId: "old", occurredAt: "2026-09-29T11:00:00Z", odometer: 1, newDefects: [] }]);
    expect(s.openShift?.id).toBe("s2");
    s = projectDriverState(open, [{ type: "shift_ended", clientId: "e2", shiftClientId: "new", occurredAt: "2026-09-29T11:00:00Z", odometer: 1, newDefects: [] }]);
    expect(s.openShift).toBeNull();
  });

  it("marks an objection as pending on the blocking defect", () => {
    const s = projectDriverState(server, [
      check({ defects: [{ clientId: "d1", catalogueItemId: leak.id, driverSeverity: null, note: null }] }),
      { type: "objection_raised", clientId: "o1", occurredAt: "2026-09-29T05:50:00Z", defectClientId: "d1", reason: "Fitting was loose, now tight" },
    ]);
    expect(s.blockingCheck?.defects[0].objection).toEqual({ status: "pending", decisionNote: null });
  });
});
