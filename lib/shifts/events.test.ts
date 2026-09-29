import { describe, expect, it } from "vitest";
import { parseDriverEvent } from "./events";

const id = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;

const check = {
  type: "check_submitted",
  clientId: id(1),
  occurredAt: "2026-09-29T05:40:00+01:00",
  phase: "start",
  shiftClientId: null,
  vehicleId: id(2),
  confirmation: "qr",
  qrPayload: "TMSW1:0123456789ABCDEF",
  typedRegistration: null,
  mismatchReason: null,
  odometer: 184220,
  previousEndOdometer: null,
  declarationAccepted: true,
  checklistItemIds: [id(3)],
  defects: [{ clientId: id(4), catalogueItemId: id(3), driverSeverity: null, note: null }],
};

describe("parseDriverEvent", () => {
  it("accepts a valid check", () => {
    const r = parseDriverEvent(check);
    expect(r.ok && r.event.type).toBe("check_submitted");
  });

  it("requires the declaration", () => {
    expect(parseDriverEvent({ ...check, declarationAccepted: false }).ok).toBe(false);
  });

  it("requires the matching confirmation field", () => {
    expect(parseDriverEvent({ ...check, qrPayload: null }).ok).toBe(false);
    expect(parseDriverEvent({ ...check, confirmation: "registration", qrPayload: null, typedRegistration: "AB12CDE" }).ok).toBe(true);
    expect(parseDriverEvent({ ...check, confirmation: "registration", qrPayload: null, typedRegistration: null }).ok).toBe(false);
  });

  it("requires the previous vehicle's end odometer on a swap", () => {
    expect(parseDriverEvent({ ...check, phase: "swap", shiftClientId: id(1) }).ok).toBe(false);
    expect(parseDriverEvent({ ...check, phase: "swap", shiftClientId: id(1), previousEndOdometer: 184300 }).ok).toBe(true);
  });

  it("requires a swap to name its shift, and a start not to", () => {
    expect(parseDriverEvent({ ...check, phase: "swap", previousEndOdometer: 184300 }).ok).toBe(false);
    expect(parseDriverEvent({ ...check, shiftClientId: id(1) }).ok).toBe(false);
    const { shiftClientId: _omit, ...withoutKey } = check;
    expect(parseDriverEvent(withoutKey).ok).toBe(false);
  });

  it("accepts break, end and objection events", () => {
    expect(parseDriverEvent({ type: "break_started", clientId: id(5), shiftClientId: id(1), occurredAt: "2026-09-29T09:00:00Z" }).ok).toBe(true);
    expect(parseDriverEvent({ type: "break_ended", clientId: id(6), shiftClientId: id(1), occurredAt: "2026-09-29T09:45:00Z" }).ok).toBe(true);
    expect(parseDriverEvent({ type: "shift_ended", clientId: id(7), shiftClientId: id(1), occurredAt: "2026-09-29T14:00:00Z", odometer: 184512, newDefects: [] }).ok).toBe(true);
    expect(parseDriverEvent({ type: "objection_raised", clientId: id(8), occurredAt: "2026-09-29T05:50:00Z", defectClientId: id(4), reason: "Leak was a loose fitting, now tight" }).ok).toBe(true);
  });

  it("requires break and end events to name their shift", () => {
    expect(parseDriverEvent({ type: "break_started", clientId: id(5), occurredAt: "2026-09-29T09:00:00Z" }).ok).toBe(false);
    expect(parseDriverEvent({ type: "break_ended", clientId: id(6), shiftClientId: null, occurredAt: "2026-09-29T09:45:00Z" }).ok).toBe(false);
    expect(parseDriverEvent({ type: "shift_ended", clientId: id(7), shiftClientId: "nope", occurredAt: "2026-09-29T14:00:00Z", odometer: 1, newDefects: [] }).ok).toBe(false);
  });

  it("refuses unknown types and bad ids", () => {
    expect(parseDriverEvent({ type: "teleport", clientId: id(9), occurredAt: "2026-09-29T05:50:00Z" }).ok).toBe(false);
    expect(parseDriverEvent({ ...check, clientId: "not-a-uuid" }).ok).toBe(false);
  });
});
