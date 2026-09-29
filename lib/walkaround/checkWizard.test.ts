import { describe, expect, it } from "vitest";
import { parseDriverEvent } from "../shifts/events";
import {
  answeredCount,
  buildCheckEvent,
  checklistGroups,
  localResult,
  NOT_A_CAB_CODE,
  phaseFromParam,
  scannedCabCode,
  shownItemIds,
  vehicleStepError,
  type CheckAnswers,
} from "./checkWizard";
import type { DriverShiftState } from "./driverState";
import type { CatalogueItem } from "./types";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const V1 = ID(101);
const V2 = ID(102);
const V3 = ID(103);
const STAMP = { clientId: ID(900), occurredAt: "2026-09-29T05:40:00Z" };

function row(n: number, over: Partial<CatalogueItem>): CatalogueItem {
  return {
    id: ID(n),
    companyId: null,
    code: `c.${n}`,
    category: "brakes",
    itemLabel: "Brakes",
    defectLabel: `Defect ${n}`,
    guidance: `Look at ${n}`,
    severity: "minor",
    appliesTo: "both",
    sortOrder: n,
    retiredAt: null,
    ...over,
  };
}

const catalogue: CatalogueItem[] = [
  row(1, { category: "brakes", severity: "dangerous" }),
  row(2, { category: "brakes" }),
  row(3, { category: "coupling", itemLabel: "Coupling", appliesTo: "trailer" }),
  row(4, { category: "lights", itemLabel: "Lights", appliesTo: "vehicle" }),
  row(5, { category: "lights", itemLabel: "Lights", appliesTo: "trailer" }),
];

function state(over: Partial<DriverShiftState> = {}): DriverShiftState {
  return {
    today: "2026-09-29",
    timeZone: "Europe/London",
    companyName: "Acme",
    onCallPhone: null,
    assignedVehicle: { id: V1, registration: "AB12 CDE" },
    vehicles: [
      { id: V1, registration: "AB12 CDE", vor: false },
      { id: V2, registration: "XY34 ZZZ", vor: false },
      { id: V3, registration: "OF55 ROD", vor: true },
    ],
    catalogue,
    openShift: null,
    blockingCheck: null,
    syncPending: false,
    ...over,
  };
}

function answers(over: Partial<CheckAnswers> = {}): CheckAnswers {
  return {
    phase: "start",
    vehicleId: V1,
    confirmation: { kind: "registration", typed: "ab12cde" },
    mismatchReason: "",
    previousEndOdometerText: "",
    odometerText: "123456",
    pullingTrailer: false,
    answers: { [ID(1)]: { status: "ok" }, [ID(4)]: { status: "ok" } },
    declarationAccepted: true,
    ...over,
  };
}

const onShift = (withVehicle: boolean): DriverShiftState["openShift"] => ({
  id: "s1",
  clientId: ID(800),
  startedAt: "2026-09-29T05:00:00Z",
  onBreak: false,
  breaks: [],
  currentVehicle: withVehicle ? { vehicleId: V1, registration: "AB12 CDE", startOdometer: 1000, checkResult: "pass" } : null,
});

describe("phaseFromParam", () => {
  it("defaults to start", () => {
    expect(phaseFromParam(null)).toBe("start");
    expect(phaseFromParam("nonsense")).toBe("start");
    expect(phaseFromParam("swap")).toBe("swap");
  });
});

describe("checklistGroups", () => {
  it("hides trailer-only rows and groups unless pulling a trailer", () => {
    const groups = checklistGroups(catalogue, false);
    expect(groups.map((g) => g.group.itemLabel)).toEqual(["Brakes", "Lights"]);
    expect(groups[1].group.defects.map((d) => d.id)).toEqual([ID(4)]);
    expect(checklistGroups(catalogue, true).map((g) => g.group.itemLabel)).toEqual(["Brakes", "Coupling", "Lights"]);
  });

  it("keeps each group's key when the trailer toggle changes", () => {
    const off = checklistGroups(catalogue, false).map((g) => g.key);
    const on = checklistGroups(catalogue, true).map((g) => g.key);
    expect(off).toEqual([ID(1), ID(4)]);
    expect(on).toEqual([ID(1), ID(3), ID(4)]);
  });

  it("lists every shown row, in order, as the checklist item ids", () => {
    expect(shownItemIds(checklistGroups(catalogue, false))).toEqual([ID(1), ID(2), ID(4)]);
    expect(shownItemIds(checklistGroups(catalogue, true))).toEqual([ID(1), ID(2), ID(3), ID(4), ID(5)]);
  });

  it("counts a group answered only on OK or at least one defect", () => {
    const groups = checklistGroups(catalogue, true);
    expect(answeredCount(groups, {})).toBe(0);
    expect(answeredCount(groups, { [ID(1)]: { status: "ok" }, [ID(3)]: { status: "defect", defects: [] } })).toBe(1);
  });
});

describe("scannedCabCode", () => {
  it("accepts a walkaround code and refuses anything else", () => {
    expect(scannedCabCode(" TMSW1:0123456789ABCDEF ")).toEqual({ ok: true, payload: "TMSW1:0123456789ABCDEF" });
    expect(scannedCabCode("https://example.com")).toEqual({ ok: false, error: NOT_A_CAB_CODE });
  });
});

describe("vehicleStepError", () => {
  it("needs a vehicle and a confirmation", () => {
    expect(vehicleStepError(answers({ vehicleId: null }), state())).toMatch(/Choose/);
    expect(vehicleStepError(answers({ confirmation: null }), state())).toMatch(/Scan the cab QR/);
  });

  it("refuses an off-the-road vehicle", () => {
    expect(vehicleStepError(answers({ vehicleId: V3, confirmation: { kind: "registration", typed: "OF55ROD" } }), state())).toMatch(/off the road/);
  });

  it("checks a typed registration against the chosen vehicle", () => {
    expect(vehicleStepError(answers({ confirmation: { kind: "registration", typed: "XY34ZZZ" } }), state())).toMatch(/does not match AB12 CDE/);
    expect(vehicleStepError(answers(), state())).toBeNull();
  });

  it("needs a reason for a vehicle other than the assigned one", () => {
    const other = answers({ vehicleId: V2, confirmation: { kind: "registration", typed: "XY34ZZZ" } });
    expect(vehicleStepError(other, state())).toMatch(/Say why/);
    expect(vehicleStepError({ ...other, mismatchReason: "Assigned truck in the workshop" }, state())).toBeNull();
    expect(vehicleStepError(other, state({ assignedVehicle: null }))).toBeNull();
  });

  it("refuses a scanned code that is not a cab code", () => {
    expect(vehicleStepError(answers({ confirmation: { kind: "qr", payload: "hello" } }), state())).toBe(NOT_A_CAB_CODE);
  });
});

describe("buildCheckEvent", () => {
  it("builds a start check the event schema accepts", () => {
    const built = buildCheckEvent(answers(), state(), STAMP);
    if (!built.ok) throw new Error(built.error);
    expect(built.event).toMatchObject({
      type: "check_submitted",
      phase: "start",
      shiftClientId: null,
      vehicleId: V1,
      confirmation: "registration",
      typedRegistration: "ab12cde",
      qrPayload: null,
      mismatchReason: null,
      odometer: 123456,
      previousEndOdometer: null,
      checklistItemIds: [ID(1), ID(2), ID(4)],
      defects: [],
    });
    expect(parseDriverEvent(built.event).ok).toBe(true);
  });

  it("requires every shown group answered and the declaration", () => {
    expect(buildCheckEvent(answers({ answers: { [ID(1)]: { status: "ok" } } }), state(), STAMP)).toEqual({ ok: false, error: "Mark every item OK or Defect." });
    expect(buildCheckEvent(answers({ declarationAccepted: false }), state(), STAMP)).toMatchObject({ ok: false, error: /declaration/ });
    expect(buildCheckEvent(answers({ odometerText: "12,000" }), state(), STAMP)).toMatchObject({ ok: false, error: /odometer/ });
  });

  it("sends defects of shown groups only, in checklist order", () => {
    const d = (n: number) => ({ clientId: ID(n), catalogueItemId: ID(n - 500), driverSeverity: null, note: null });
    const built = buildCheckEvent(
      answers({
        answers: {
          [ID(4)]: { status: "defect", defects: [d(504)] },
          [ID(1)]: { status: "defect", defects: [d(501)] },
          [ID(3)]: { status: "defect", defects: [d(503)] },
        },
      }),
      state(),
      STAMP,
    );
    if (!built.ok) throw new Error(built.error);
    expect(built.event.defects.map((x) => x.clientId)).toEqual([ID(501), ID(504)]);
    expect(parseDriverEvent(built.event).ok).toBe(true);
  });

  it("carries the QR payload when the cab code was scanned", () => {
    const built = buildCheckEvent(answers({ confirmation: { kind: "qr", payload: "TMSW1:0123456789ABCDEF" } }), state(), STAMP);
    expect(built).toMatchObject({ ok: true, event: { confirmation: "qr", qrPayload: "TMSW1:0123456789ABCDEF", typedRegistration: null } });
  });

  it("refuses a start check while a shift is open", () => {
    expect(buildCheckEvent(answers(), state({ openShift: onShift(true) }), STAMP)).toEqual({ ok: false, error: "You are already on shift." });
  });

  it("names the open shift and the end odometer on a swap", () => {
    const swap = answers({ phase: "swap", vehicleId: V2, confirmation: { kind: "registration", typed: "XY34ZZZ" }, mismatchReason: "Swap", previousEndOdometerText: "1250" });
    const built = buildCheckEvent(swap, state({ openShift: onShift(true) }), STAMP);
    if (!built.ok) throw new Error(built.error);
    expect(built.event).toMatchObject({ phase: "swap", shiftClientId: ID(800), previousEndOdometer: 1250, mismatchReason: "Swap" });
    expect(parseDriverEvent(built.event).ok).toBe(true);
  });

  it("refuses an end odometer below the reading at the start of the period", () => {
    const swap = answers({ phase: "swap", previousEndOdometerText: "900" });
    expect(buildCheckEvent(swap, state({ openShift: onShift(true) }), STAMP)).toMatchObject({ ok: false, error: /lower than the reading/ });
  });

  it("needs no end odometer when the last check took the vehicle off the road", () => {
    const built = buildCheckEvent(answers({ phase: "swap" }), state({ openShift: onShift(false) }), STAMP);
    if (!built.ok) throw new Error(built.error);
    expect(built.event.previousEndOdometer).toBe(0);
    expect(parseDriverEvent(built.event).ok).toBe(true);
  });

  it("refuses a swap with no open shift", () => {
    expect(buildCheckEvent(answers({ phase: "swap", previousEndOdometerText: "5" }), state(), STAMP)).toEqual({ ok: false, error: "You are not on shift." });
  });
});

describe("localResult", () => {
  const map = new Map(catalogue.map((c) => [c.id, c]));
  it("matches the server's rules", () => {
    expect(localResult([], map)).toBe("pass");
    expect(localResult([{ clientId: "a", catalogueItemId: ID(2), driverSeverity: null, note: null }], map)).toBe("minor");
    expect(localResult([{ clientId: "a", catalogueItemId: ID(1), driverSeverity: null, note: null }], map)).toBe("dangerous");
    expect(localResult([{ clientId: "a", catalogueItemId: ID(2), driverSeverity: "dangerous", note: null }], map)).toBe("dangerous");
  });
});
