/*
  The driver's walkaround check screens (/driver/walkaround) as pure rules:
  which checklist groups are shown, how many are answered, and the
  check_submitted event the answers become. Client-safe; the server re-checks
  everything (lib/walkaround/processEvent.ts).

  The checklist is based on the DVSA daily walkaround check. Nothing is
  pre-marked: every shown group needs an explicit OK or Defect.
*/

import { parseOdometer, type EventStamp } from "../shifts/driverActions";
import type { CheckSubmittedEvent, QueuedDefect } from "../shifts/events";
import { groupByItem, type ItemGroup } from "./catalogue";
import type { DriverShiftState } from "./driverState";
import { parseQrPayload, registrationsMatch } from "./qrToken";
import { checkResult, resolveDefect } from "./severity";
import type { CatalogueItem, CheckResult } from "./types";

export type WizardPhase = "start" | "swap";

/** A checklist group with a key that stays the same when the trailer toggle changes. */
export type KeyedGroup = { key: string; group: ItemGroup };

export type GroupAnswer = { status: "ok" } | { status: "defect"; defects: QueuedDefect[] };

export type VehicleConfirmation = { kind: "qr"; payload: string } | { kind: "registration"; typed: string };

export type CheckAnswers = {
  phase: WizardPhase;
  vehicleId: string | null;
  confirmation: VehicleConfirmation | null;
  mismatchReason: string;
  /** Swap only: the odometer of the vehicle being left. */
  previousEndOdometerText: string;
  odometerText: string;
  pullingTrailer: boolean;
  answers: Readonly<Record<string, GroupAnswer>>;
  declarationAccepted: boolean;
};

type Built<E> = { ok: true; event: E } | { ok: false; error: string };

export const MISMATCH_REASON_MAX = 300;
export const NOT_A_CAB_CODE = "That is not a TMS Wizzard cab code.";

/** "start" unless the URL asks for a swap. */
export function phaseFromParam(value: string | null): WizardPhase {
  return value === "swap" ? "swap" : "start";
}

/*
  Group the whole catalogue first, then drop trailer-only rows unless the
  driver is pulling a trailer. Grouping first keeps each group's key (its
  first row's id) stable when the toggle changes, so answers are not lost.
*/
export function checklistGroups(catalogue: readonly CatalogueItem[], pullingTrailer: boolean): KeyedGroup[] {
  const out: KeyedGroup[] = [];
  for (const group of groupByItem(catalogue)) {
    const key = group.defects[0]?.id;
    const defects = pullingTrailer ? group.defects : group.defects.filter((d) => d.appliesTo !== "trailer");
    if (key && defects.length > 0) out.push({ key, group: { ...group, defects } });
  }
  return out;
}

export function answeredCount(groups: readonly KeyedGroup[], answers: Readonly<Record<string, GroupAnswer>>): number {
  return groups.filter((g) => isAnswered(answers[g.key])).length;
}

function isAnswered(answer: GroupAnswer | undefined): boolean {
  return answer?.status === "ok" || (answer?.status === "defect" && answer.defects.length > 0);
}

/** Every catalogue row the driver was shown, in order: the check's checklistItemIds. */
export function shownItemIds(groups: readonly KeyedGroup[]): string[] {
  return groups.flatMap((g) => g.group.defects.map((d) => d.id));
}

/** The defects of the shown groups, in checklist order. Answers for hidden groups are ignored. */
export function collectDefects(groups: readonly KeyedGroup[], answers: Readonly<Record<string, GroupAnswer>>): QueuedDefect[] {
  return groups.flatMap((g) => {
    const answer = answers[g.key];
    return answer?.status === "defect" ? answer.defects : [];
  });
}

/** The result the server will reach, so the phone can show it before syncing. */
export function localResult(defects: readonly QueuedDefect[], catalogue: ReadonlyMap<string, CatalogueItem>): CheckResult {
  const resolved = [];
  for (const d of defects) {
    const r = resolveDefect(d, catalogue);
    if (r.ok) resolved.push(r.value);
  }
  return checkResult(resolved);
}

/** Whether a scanned code is a cab code at all. Which vehicle it belongs to is the server's check. */
export function scannedCabCode(text: string): { ok: true; payload: string } | { ok: false; error: string } {
  return parseQrPayload(text) ? { ok: true, payload: text.trim() } : { ok: false, error: NOT_A_CAB_CODE };
}

/** Instant feedback on a typed registration; the server re-checks. */
export function typedRegistrationMatches(typed: string, vehicleId: string | null, state: DriverShiftState): boolean {
  const vehicle = state.vehicles.find((v) => v.id === vehicleId);
  return Boolean(vehicle && registrationsMatch(typed, vehicle.registration));
}

/** A reason is needed when the driver takes a vehicle other than the one assigned today. */
export function needsMismatchReason(vehicleId: string | null, state: DriverShiftState): boolean {
  return Boolean(vehicleId && state.assignedVehicle && state.assignedVehicle.id !== vehicleId);
}

/** Swap only, and only when there is a checked vehicle to hand back. */
export function needsPreviousEndOdometer(phase: WizardPhase, state: DriverShiftState): boolean {
  return phase === "swap" && Boolean(state.openShift?.currentVehicle);
}

export function previousEndOdometerError(text: string, state: DriverShiftState): string | null {
  const value = parseOdometer(text);
  if (value === null) return "Enter the odometer reading as a whole number.";
  const start = state.openShift?.currentVehicle?.startOdometer;
  if (typeof start === "number" && value < start) return `That is lower than the reading when you took the vehicle out (${start}).`;
  return null;
}

/** The problem with the vehicle step, or null when the driver can move on. */
export function vehicleStepError(answers: CheckAnswers, state: DriverShiftState): string | null {
  const vehicle = state.vehicles.find((v) => v.id === answers.vehicleId);
  if (!vehicle) return "Choose the vehicle you are checking.";
  if (vehicle.vor) return `${vehicle.registration} is off the road and cannot be taken out.`;
  if (!answers.confirmation) return "Scan the cab QR code or type the registration.";
  if (answers.confirmation.kind === "qr" && !parseQrPayload(answers.confirmation.payload)) return NOT_A_CAB_CODE;
  if (answers.confirmation.kind === "registration" && !registrationsMatch(answers.confirmation.typed, vehicle.registration)) {
    return `The registration you typed does not match ${vehicle.registration}.`;
  }
  if (needsMismatchReason(vehicle.id, state)) {
    const reason = answers.mismatchReason.trim();
    if (!reason) return "Say why you are taking a different vehicle.";
    if (reason.length > MISMATCH_REASON_MAX) return "Keep the reason under 300 characters.";
  }
  return null;
}

export function buildCheckEvent(answers: CheckAnswers, state: DriverShiftState, stamp: EventStamp): Built<CheckSubmittedEvent> {
  const vehicleError = vehicleStepError(answers, state);
  if (vehicleError || !answers.vehicleId || !answers.confirmation) return { ok: false, error: vehicleError ?? "Choose the vehicle you are checking." };

  let shiftClientId: string | null = null;
  let previousEndOdometer: number | null = null;
  if (answers.phase === "swap") {
    if (!state.openShift) return { ok: false, error: "You are not on shift." };
    shiftClientId = state.openShift.clientId;
    if (needsPreviousEndOdometer("swap", state)) {
      const error = previousEndOdometerError(answers.previousEndOdometerText, state);
      if (error) return { ok: false, error };
      previousEndOdometer = parseOdometer(answers.previousEndOdometerText);
    } else {
      // No vehicle period is open (the last check took it off the road), so
      // walkaround_submit_check has nothing to close and ignores this value.
      // The event schema still requires a number on every swap.
      previousEndOdometer = 0;
    }
  } else if (state.openShift) {
    return { ok: false, error: "You are already on shift." };
  }

  const odometer = parseOdometer(answers.odometerText);
  if (odometer === null) return { ok: false, error: "Enter the odometer reading as a whole number." };

  const groups = checklistGroups(state.catalogue, answers.pullingTrailer);
  if (groups.length === 0) return { ok: false, error: "The checklist has not loaded. Reload and try again." };
  if (answeredCount(groups, answers.answers) < groups.length) return { ok: false, error: "Mark every item OK or Defect." };
  if (!answers.declarationAccepted) return { ok: false, error: "Tick the declaration to submit the check." };

  const confirmation = answers.confirmation;
  return {
    ok: true,
    event: {
      type: "check_submitted",
      ...stamp,
      phase: answers.phase,
      shiftClientId,
      vehicleId: answers.vehicleId,
      confirmation: confirmation.kind,
      qrPayload: confirmation.kind === "qr" ? confirmation.payload.trim() : null,
      typedRegistration: confirmation.kind === "registration" ? confirmation.typed.trim() : null,
      mismatchReason: needsMismatchReason(answers.vehicleId, state) ? answers.mismatchReason.trim() : null,
      odometer,
      previousEndOdometer,
      declarationAccepted: true,
      checklistItemIds: shownItemIds(groups),
      defects: collectDefects(groups, answers.answers),
    },
  };
}
