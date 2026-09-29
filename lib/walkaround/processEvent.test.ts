import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { DriverSession } from "../driver/server";
import type { DriverEvent } from "../shifts/events";
import { processDriverEvent, SHIFT_NOT_FOUND } from "./processEvent";

/*
  A minimal stand-in for the service-role client: every query is an equality
  filter answered from in-memory rows, and every table and rpc touched is
  recorded so the tests can assert what ran (and, above all, what did not).
*/
function fakeAdmin(rows: Record<string, Record<string, unknown>[]>) {
  const calls: string[] = [];
  const admin = {
    from(table: string) {
      calls.push(table);
      const filters: [string, unknown][] = [];
      const match = () => (rows[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        is: (c: string, v: unknown) => (filters.push([c, v]), q),
        in: () => q,
        or: () => q,
        not: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: match(), error: null }),
      };
      return q;
    },
    async rpc(name: string) {
      calls.push(`rpc:${name}`);
      return { data: { duplicate: false }, error: null };
    },
  };
  return { admin: admin as unknown as SupabaseClient, calls };
}

const session: DriverSession = { userId: "u1", tenantId: "t1", driverId: "d1", subcontractorId: null, portalType: "direct_driver" };
const at = new Date("2026-09-29T12:00:00Z");
const uuid = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;

const check: DriverEvent = {
  type: "check_submitted",
  clientId: uuid(1),
  occurredAt: "2026-09-29T11:00:00Z",
  phase: "start",
  shiftClientId: null,
  vehicleId: uuid(2),
  confirmation: "registration",
  qrPayload: null,
  typedRegistration: "AB12CDE",
  mismatchReason: null,
  odometer: 1000,
  previousEndOdometer: null,
  declarationAccepted: true,
  checklistItemIds: [uuid(3)],
  defects: [],
};

describe("processDriverEvent idempotency", () => {
  it("answers a repeated check as a duplicate before any business check (even with the vehicle now VOR)", async () => {
    const { admin, calls } = fakeAdmin({
      walkaround_checks: [{ id: "k1", tenant_id: "t1", client_id: uuid(1), shift_id: "s1", result: "pass" }],
      vehicles: [{ id: uuid(2), tenant_id: "t1", registration: "AB12 CDE", vor: true }],
    });
    const r = await processDriverEvent(admin, session, check, at);
    expect(r).toEqual({ status: 200, body: { ok: true, duplicate: true, check_id: "k1", shift_id: "s1", result: "pass" } });
    expect(calls).toEqual(["walkaround_checks"]);
  });

  it("answers repeated break, end and objection events from their own key columns", async () => {
    const { admin, calls } = fakeAdmin({
      shift_breaks: [{ tenant_id: "t1", client_id: uuid(5), end_client_id: uuid(6), id: "b1" }],
      driver_shifts: [{ tenant_id: "t1", end_client_id: uuid(7), id: "s1" }],
      defect_objections: [{ tenant_id: "t1", client_id: uuid(8), id: "o1", status: "pending" }],
    });
    const base = { shiftClientId: uuid(1), occurredAt: "2026-09-29T11:30:00Z" };
    expect((await processDriverEvent(admin, session, { ...base, type: "break_started", clientId: uuid(5) }, at)).body).toEqual({ ok: true, duplicate: true });
    expect((await processDriverEvent(admin, session, { ...base, type: "break_ended", clientId: uuid(6) }, at)).body).toEqual({ ok: true, duplicate: true });
    expect((await processDriverEvent(admin, session, { ...base, type: "shift_ended", clientId: uuid(7), odometer: 1, newDefects: [] }, at)).body).toEqual({ ok: true, duplicate: true });
    expect(
      (await processDriverEvent(admin, session, { type: "objection_raised", clientId: uuid(8), occurredAt: base.occurredAt, defectClientId: uuid(4), reason: "It was fine" }, at)).body,
    ).toEqual({ ok: true, duplicate: true, objectionId: "o1", status: "pending" });
    expect(calls).toEqual(["shift_breaks", "shift_breaks", "driver_shifts", "defect_objections"]);
  });
});

describe("processDriverEvent shift naming", () => {
  it("refuses a break for a shift this driver does not have, without calling the RPC", async () => {
    const { admin, calls } = fakeAdmin({
      driver_shifts: [{ id: "s9", tenant_id: "t1", driver_id: "d1", client_id: uuid(9), started_at: "2026-09-29T06:00:00Z", ended_at: null, flags: [] }],
    });
    const r = await processDriverEvent(admin, session, { type: "break_started", clientId: uuid(5), shiftClientId: uuid(1), occurredAt: "2026-09-29T11:30:00Z" }, at);
    expect(r).toEqual({ status: 409, body: { error: SHIFT_NOT_FOUND } });
    expect(calls.some((c) => c.startsWith("rpc:"))).toBe(false);
  });

  it("sends the named shift's client id to the RPC, and lets the RPC decide for an office-ended shift", async () => {
    const { admin, calls } = fakeAdmin({
      driver_shifts: [{ id: "s1", tenant_id: "t1", driver_id: "d1", client_id: uuid(1), started_at: "2026-09-29T06:00:00Z", ended_at: "2026-09-29T10:00:00Z", flags: [] }],
    });
    // After the office end: the pure break rules would refuse this, the RPC flags it instead.
    const r = await processDriverEvent(admin, session, { type: "break_started", clientId: uuid(5), shiftClientId: uuid(1), occurredAt: "2026-09-29T11:30:00Z" }, at);
    expect(r.status).toBe(200);
    expect(calls).toContain("rpc:shift_record_event");
  });
});
