import { describe, expect, it } from "vitest";
import {
  RETURN_BLOCKED_ERRCODE,
  RETURN_BLOCKED_MESSAGE,
  blocksReturnToService,
  isReturnBlockedError,
  returnToServiceDecision,
  vorReasonForDefects,
} from "./vor";

const open = { finalSeverity: "dangerous" as const, rectifiedAt: null, objectionStatus: null };

describe("blocksReturnToService", () => {
  it("blocks only open dangerous defects without an approved objection", () => {
    expect(blocksReturnToService(open)).toBe(true);
    expect(blocksReturnToService({ ...open, finalSeverity: "minor" })).toBe(false);
    expect(blocksReturnToService({ ...open, rectifiedAt: "2026-09-29T10:00:00Z" })).toBe(false);
    expect(blocksReturnToService({ ...open, objectionStatus: "approved" })).toBe(false);
    expect(blocksReturnToService({ ...open, objectionStatus: "pending" })).toBe(true);
    expect(blocksReturnToService({ ...open, objectionStatus: "rejected" })).toBe(true);
  });
});

describe("returnToServiceDecision", () => {
  it("requires an admin", () => {
    expect(returnToServiceDecision({ tier: "staff", defects: [] })).toEqual({ ok: false, reason: "not-admin" });
    expect(returnToServiceDecision({ tier: "admin", defects: [] })).toEqual({ ok: true });
    expect(returnToServiceDecision({ tier: "super_admin", defects: [] })).toEqual({ ok: true });
  });

  it("refuses while dangerous defects are open", () => {
    expect(returnToServiceDecision({ tier: "admin", defects: [open, open, { ...open, finalSeverity: "minor" }] })).toEqual({
      ok: false,
      reason: "open-dangerous-defects",
      count: 2,
    });
  });
});

describe("vorReasonForDefects", () => {
  it("names the defects and stays within 200 characters", () => {
    expect(vorReasonForDefects(["Brakes: Audible air leak"])).toBe("Walkaround: Brakes: Audible air leak");
    expect(vorReasonForDefects(Array(20).fill("Tyres and wheel fixing: Tread below 1mm")).length).toBeLessThanOrEqual(200);
  });
});

describe("isReturnBlockedError", () => {
  it("recognises the WLK01 refusal by code or sentence", () => {
    expect(isReturnBlockedError({ code: RETURN_BLOCKED_ERRCODE })).toBe(true);
    expect(isReturnBlockedError({ message: `failed: ${RETURN_BLOCKED_MESSAGE}` })).toBe(true);
    expect(isReturnBlockedError({ code: "LIC01" })).toBe(false);
    expect(isReturnBlockedError(null)).toBe(false);
  });
});
