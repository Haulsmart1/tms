import { describe, expect, it } from "vitest";
import {
  buildPlanningSavePlan,
  classifyPlanningSaveError,
  PLANNING_SAVE_ERROR_MESSAGES,
  planningSaveErrorMessage,
  type PlanningSaveJobFacts,
} from "./planningSave";

function job(overrides: Partial<PlanningSaveJobFacts> = {}): PlanningSaveJobFacts {
  return {
    id: "job-1",
    tenant_id: "tenant-a",
    vehicle_id: "van-a",
    driver_id: "driver-a",
    route_order: 1,
    ...overrides,
  };
}

describe("buildPlanningSavePlan", () => {
  const update = { id: "job-1", vehicle_id: "van-b", driver_id: null, route_order: 3 };

  it("refuses to save with All tenants active (PLAN-8)", () => {
    expect(
      buildPlanningSavePlan([update], new Map([["job-1", job()]]), null)
    ).toEqual({ ok: false, reason: "no_tenant_selected" });
  });

  it("carries the last-seen values so the server can refuse a stale save (PLAN-11)", () => {
    expect(
      buildPlanningSavePlan([update], new Map([["job-1", job()]]), "tenant-a")
    ).toEqual({
      ok: true,
      tenantId: "tenant-a",
      rows: [
        {
          id: "job-1",
          vehicle_id: "van-b",
          driver_id: null,
          route_order: 3,
          expected_vehicle_id: "van-a",
          expected_driver_id: "driver-a",
          expected_route_order: 1,
        },
      ],
    });
  });

  it("refuses a job from another tenant and an unknown job", () => {
    expect(
      buildPlanningSavePlan([update], new Map([["job-1", job({ tenant_id: "tenant-b" })]]), "tenant-a")
    ).toEqual({ ok: false, reason: "job_other_tenant" });

    expect(buildPlanningSavePlan([update], new Map(), "tenant-a")).toEqual({
      ok: false,
      reason: "job_missing",
    });
  });
});

describe("classifyPlanningSaveError", () => {
  it("recognises a conflict, a missing RPC and anything else", () => {
    expect(
      classifyPlanningSaveError({ code: "P0001", message: "PLANNING_CONFLICT: another change" })
    ).toBe("conflict");
    expect(classifyPlanningSaveError({ code: "PGRST202", message: "x" })).toBe("rpc_missing");
    expect(classifyPlanningSaveError({ code: "42883", message: "x" })).toBe("rpc_missing");
    expect(classifyPlanningSaveError({ code: "42501", message: "denied" })).toBe("failed");
  });

  it("recognises the unlicensed-vehicle refusal and keeps its sentence", () => {
    const error = {
      code: "LIC01",
      message: "Vehicle AB12 CDE has no active licence. Activate it on the Licences page before assigning it.",
    };
    const kind = classifyPlanningSaveError(error);
    expect(kind).toBe("unlicensed_vehicle");
    expect(planningSaveErrorMessage(kind, error)).toContain("Vehicle AB12 CDE has no active licence.");
    expect(planningSaveErrorMessage("conflict", error)).toBe(PLANNING_SAVE_ERROR_MESSAGES.conflict);
  });
});
