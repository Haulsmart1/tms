/*
  Apply the phone's queued (not yet accepted) events on top of the last server
  state, so the driver sees the result of what they did even with no signal.
  Severity is recomputed with the same rules the server uses
  (lib/walkaround/severity.ts); the server stays the authority once it syncs.
*/

import { checkResult, dangerReason, resolveDefect, type ResolvedDefect } from "../walkaround/severity";
import type { DriverDefectView, DriverShiftState } from "../walkaround/driverState";
import type { CatalogueItem } from "../walkaround/types";
import type { DriverEvent, QueuedDefect } from "./events";

function resolveAll(defects: readonly QueuedDefect[], catalogue: ReadonlyMap<string, CatalogueItem>): ResolvedDefect[] {
  const out: ResolvedDefect[] = [];
  for (const d of defects) {
    const r = resolveDefect(d, catalogue);
    if (r.ok) out.push(r.value);
  }
  return out;
}

function view(d: ResolvedDefect, catalogue: ReadonlyMap<string, CatalogueItem>, companyName: string | null): DriverDefectView {
  return {
    clientId: d.clientId,
    label: d.label,
    finalSeverity: d.finalSeverity,
    severitySource: d.severitySource,
    reason: dangerReason(d, companyName),
    guidance: d.catalogueItemId ? catalogue.get(d.catalogueItemId)?.guidance ?? null : null,
    note: d.note,
    photoCount: 0,
    objection: null,
  };
}

export function projectDriverState(server: DriverShiftState, pending: readonly DriverEvent[]): DriverShiftState {
  if (pending.length === 0) return server;

  const catalogue = new Map(server.catalogue.map((i) => [i.id, i]));
  const registration = (id: string) => server.vehicles.find((v) => v.id === id)?.registration ?? "Vehicle";
  let state: DriverShiftState = { ...server, syncPending: true };

  // An event only ever touches the shift it names (a late event for a shift
  // the office has since ended must not change the one open now).
  const ours = (shiftClientId: string | null) => state.openShift !== null && state.openShift.clientId === shiftClientId;

  for (const event of pending) {
    if (event.type === "check_submitted") {
      const resolved = resolveAll(event.defects, catalogue);
      const result = checkResult(resolved);
      if (result === "dangerous") {
        state = {
          ...state,
          blockingCheck: {
            checkClientId: event.clientId,
            vehicleId: event.vehicleId,
            registration: registration(event.vehicleId),
            performedAt: event.occurredAt,
            defects: resolved.map((d) => view(d, catalogue, server.companyName)),
          },
          openShift: state.openShift && event.phase === "swap" && ours(event.shiftClientId) ? { ...state.openShift, currentVehicle: null } : state.openShift,
        };
        continue;
      }
      const currentVehicle = { vehicleId: event.vehicleId, registration: registration(event.vehicleId), startOdometer: event.odometer, checkResult: result };
      state = {
        ...state,
        blockingCheck: null,
        openShift:
          event.phase === "swap"
            ? state.openShift && ours(event.shiftClientId)
              ? { ...state.openShift, currentVehicle }
              : state.openShift
            : { id: `pending:${event.clientId}`, clientId: event.clientId, startedAt: event.occurredAt, onBreak: false, breaks: [], currentVehicle },
      };
    } else if (event.type === "break_started" && state.openShift && ours(event.shiftClientId)) {
      state = { ...state, openShift: { ...state.openShift, onBreak: true, breaks: [...state.openShift.breaks, { startedAt: event.occurredAt, endedAt: null }] } };
    } else if (event.type === "break_ended" && state.openShift && ours(event.shiftClientId)) {
      const breaks = state.openShift.breaks.map((b) => (b.endedAt === null ? { ...b, endedAt: event.occurredAt } : b));
      state = { ...state, openShift: { ...state.openShift, onBreak: false, breaks } };
    } else if (event.type === "shift_ended" && ours(event.shiftClientId)) {
      state = { ...state, openShift: null, blockingCheck: null };
    } else if (event.type === "objection_raised" && state.blockingCheck) {
      const defects = state.blockingCheck.defects.map((d) =>
        d.clientId === event.defectClientId ? { ...d, objection: { status: "pending" as const, decisionNote: null } } : d,
      );
      state = { ...state, blockingCheck: { ...state.blockingCheck, defects } };
    }
  }
  return state;
}
