import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { DriverSession } from "../driver/server";
import { JOB_GATE_MESSAGES } from "./jobGate";
import { jobGateResponse, queuedJobGate } from "./server";

/*
  A tiny in-memory stand-in for the service-role client: enough of the
  PostgREST builder (select, eq, is, lte, order, limit, maybeSingle, await)
  for queuedJobGate and the open-shift fallback it calls.
*/
type Row = Record<string, unknown>;

function fakeAdmin(tables: Record<string, Row[]>, failOn: string | null = null) {
  const queried: string[] = [];

  function builder(table: string) {
    let rows = [...(tables[table] ?? [])];
    let max = Infinity;
    const result = () =>
      failOn === table ? { data: null, error: { message: `${table} lookup failed` } } : { data: rows.slice(0, max), error: null };
    const q = {
      select: () => q,
      eq: (col: string, value: unknown) => {
        rows = rows.filter((r) => r[col] === value);
        return q;
      },
      is: (col: string, value: unknown) => {
        rows = rows.filter((r) => (r[col] ?? null) === value);
        return q;
      },
      lte: (col: string, value: string) => {
        rows = rows.filter((r) => Date.parse(String(r[col])) <= Date.parse(value));
        return q;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        const dir = opts?.ascending === false ? -1 : 1;
        rows.sort((a, b) => dir * (Date.parse(String(a[col])) - Date.parse(String(b[col]))));
        return q;
      },
      limit: (n: number) => {
        max = n;
        return q;
      },
      maybeSingle: async () => {
        const r = result();
        if (r.error) return r;
        const list = r.data as Row[];
        if (list.length > 1) return { data: null, error: { message: "multiple rows" } };
        return { data: list[0] ?? null, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return q;
  }

  const admin = {
    from: (table: string) => {
      queried.push(table);
      return builder(table);
    },
  };
  return { admin: admin as unknown as SupabaseClient, queried };
}

const session: DriverSession = {
  userId: "u1",
  tenantId: "t1",
  driverId: "d1",
  subcontractorId: null,
  portalType: "direct_driver",
};
const subcontractor: DriverSession = { ...session, subcontractorId: "s1", portalType: "subcontractor_driver" };

const SHIFT_CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const now = new Date("2026-10-07T16:00:00.000Z");

/** An ended shift 06:00 to 15:00 with vehicle A until 10:00 and vehicle B from 10:00 until 15:00. */
function endedShiftTables(overrides: { periods?: Row[]; vehicles?: Row[]; checks?: Row[] } = {}): Record<string, Row[]> {
  return {
    driver_shifts: [
      { id: "sh1", tenant_id: "t1", driver_id: "d1", client_id: SHIFT_CLIENT_ID, started_at: "2026-10-07T06:00:00.000Z", ended_at: "2026-10-07T15:00:00.000Z" },
    ],
    shift_vehicle_periods: overrides.periods ?? [
      { id: "pA", shift_id: "sh1", vehicle_id: "vA", walkaround_check_id: "cA", started_at: "2026-10-07T06:00:00.000Z", ended_at: "2026-10-07T10:00:00.000Z" },
      { id: "pB", shift_id: "sh1", vehicle_id: "vB", walkaround_check_id: "cB", started_at: "2026-10-07T10:00:00.000Z", ended_at: "2026-10-07T15:00:00.000Z" },
    ],
    walkaround_checks: overrides.checks ?? [
      { id: "cA", result: "pass" },
      { id: "cB", result: "dangerous" },
    ],
    vehicles: overrides.vehicles ?? [
      { id: "vA", vor: true },
      { id: "vB", vor: false },
    ],
  };
}

const meta = (recordedAt: string, shiftClientId: string | null = SHIFT_CLIENT_ID) => ({
  clientId: "66666666-6666-4666-8666-666666666666",
  shiftClientId,
  recordedAt,
});

const GATE_UNAVAILABLE = "Walkaround checks are not available right now, so jobs cannot be completed. Ask the office.";

async function errorOf(response: Response | null) {
  return response ? ((await response.json()) as { error: string }).error : null;
}

describe("queuedJobGate", () => {
  it("passes for a time inside an earlier closed period, even though that vehicle is VOR now", async () => {
    const { admin, queried } = fakeAdmin(endedShiftTables());
    const result = await queuedJobGate(admin, session, meta("2026-10-07T08:00:00.000Z"), { now });
    expect(result).toEqual({ response: null, at: "2026-10-07T08:00:00.000Z", trusted: true });
    expect(queried).not.toContain("vehicles");
  });

  it("picks period B when the time equals period A's ended_at", async () => {
    const { admin } = fakeAdmin(endedShiftTables());
    const result = await queuedJobGate(admin, session, meta("2026-10-07T10:00:00.000Z"), { now });
    // Period B's check was dangerous, so judging B (not A, which passed) refuses.
    expect(result.response?.status).toBe(409);
    expect(await errorOf(result.response)).toBe(JOB_GATE_MESSAGES.noCheck);
  });

  it("refuses noVehicle for a time after the last closed period with no open one", async () => {
    const periods = [
      { id: "pA", shift_id: "sh1", vehicle_id: "vA", walkaround_check_id: "cA", started_at: "2026-10-07T06:00:00.000Z", ended_at: "2026-10-07T10:00:00.000Z" },
    ];
    const { admin } = fakeAdmin(endedShiftTables({ periods }));
    const result = await queuedJobGate(admin, session, meta("2026-10-07T12:00:00.000Z"), { now });
    expect(result.response?.status).toBe(409);
    expect(await errorOf(result.response)).toBe(JOB_GATE_MESSAGES.noVehicle);
  });

  it("refuses an open period whose vehicle is VOR", async () => {
    const tables = endedShiftTables({
      periods: [{ id: "pA", shift_id: "sh1", vehicle_id: "vA", walkaround_check_id: "cA", started_at: "2026-10-07T06:00:00.000Z", ended_at: null }],
    });
    tables.driver_shifts[0].ended_at = null;
    const { admin } = fakeAdmin(tables);
    const result = await queuedJobGate(admin, session, meta("2026-10-07T08:00:00.000Z"), { now });
    expect(result.response?.status).toBe(409);
    expect(await errorOf(result.response)).toBe(JOB_GATE_MESSAGES.vor);
  });

  it("falls back to the open-shift rule, untrusted, when the named shift is unknown", async () => {
    const { admin } = fakeAdmin({
      ...endedShiftTables(),
      driver_shifts: [
        { id: "sh2", tenant_id: "t1", driver_id: "d1", client_id: "other", started_at: "2026-10-07T15:30:00.000Z", ended_at: null },
      ],
      shift_vehicle_periods: [
        { id: "pC", shift_id: "sh2", vehicle_id: "vB", walkaround_check_id: "cA", start_odometer: 1, started_at: "2026-10-07T15:30:00.000Z", ended_at: null },
      ],
      shift_breaks: [],
    });
    const result = await queuedJobGate(admin, session, meta("2026-10-07T08:00:00.000Z"), { now });
    expect(result).toEqual({ response: null, at: now.toISOString(), trusted: false });
  });

  it("answers 503 when a lookup errors, so the queue retries rather than drops the item", async () => {
    const { admin } = fakeAdmin(endedShiftTables(), "shift_vehicle_periods");
    const result = await queuedJobGate(admin, session, meta("2026-10-07T08:00:00.000Z"), { now });
    expect(result.response?.status).toBe(503);
    expect(await errorOf(result.response)).toBe(GATE_UNAVAILABLE);
    expect(result.trusted).toBe(false);
  });

  it("answers 503 when the open-shift fallback lookup errors", async () => {
    const { admin } = fakeAdmin(endedShiftTables(), "driver_shifts");
    const result = await queuedJobGate(admin, session, meta("2026-10-07T08:00:00.000Z", null), { now });
    expect(result.response?.status).toBe(503);
    expect(await errorOf(result.response)).toBe(GATE_UNAVAILABLE);
  });

  it("treats a time before notBefore as untrusted and judges the open-shift rule instead", async () => {
    const { admin } = fakeAdmin({ ...endedShiftTables(), shift_breaks: [] });
    const result = await queuedJobGate(admin, session, meta("2026-10-07T08:00:00.000Z"), { now, notBefore: "2026-10-07T09:00:00.000Z" });
    // No open shift now, so the fallback refuses.
    expect(result.response?.status).toBe(409);
    expect(await errorOf(result.response)).toBe(JOB_GATE_MESSAGES.noShift);
  });

  it("makes no lookups for a subcontractor and trusts the time per recordedTime", async () => {
    const { admin, queried } = fakeAdmin({});
    expect(await queuedJobGate(admin, subcontractor, meta("2026-10-07T08:00:00.000Z", null), { now })).toEqual({
      response: null,
      at: "2026-10-07T08:00:00.000Z",
      trusted: true,
    });
    expect(await queuedJobGate(admin, subcontractor, meta("2026-10-07T08:00:00.000Z", null), { now, notBefore: "2026-10-07T09:00:00.000Z" })).toEqual({
      response: null,
      at: now.toISOString(),
      trusted: false,
    });
    expect(queried).toEqual([]);
  });
});

describe("jobGateResponse", () => {
  it("answers 503 when the lookup fails (fails closed, but retryable)", async () => {
    const { admin } = fakeAdmin({}, "driver_shifts");
    const response = await jobGateResponse(admin, session);
    expect(response?.status).toBe(503);
    expect(await errorOf(response)).toBe(GATE_UNAVAILABLE);
  });

  it("refuses with 409 when there is no open shift", async () => {
    const { admin } = fakeAdmin({ driver_shifts: [] });
    const response = await jobGateResponse(admin, session);
    expect(response?.status).toBe(409);
  });
});
