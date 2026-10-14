import { describe, expect, it } from "vitest";
import {
  CANCELLED_COMPANY_ERRCODE,
  PAST_DUE_COMPANY_ERRCODE,
  UNLICENSED_VEHICLE_ERRCODE,
} from "../billing/unlicensedVehicle";
import { KNOWN_RPC_REFUSALS, rpcErrorResponse } from "./server";

describe("KNOWN_RPC_REFUSALS", () => {
  // The licence gate fires on the shift_vehicle_periods insert inside walkaround_submit_check.
  // A code missing here answers 500, the offline queue sets the check aside, and the PODs queued
  // under that shift are refused and deleted (2026-10-12 review, finding 1).
  it.each([UNLICENSED_VEHICLE_ERRCODE, CANCELLED_COMPANY_ERRCODE, PAST_DUE_COMPANY_ERRCODE])(
    "treats licence gate refusal %s as a business refusal",
    (code) => {
      expect(KNOWN_RPC_REFUSALS).toContain(code);
    },
  );

  it("answers LIC03 with 409 and the database's sentence", async () => {
    const message =
      "Vehicle AB12 CDE cannot be assigned to new work because this company's payment is more than 7 days overdue. Update the card on the Billing page.";
    const res = rpcErrorResponse({ code: "LIC03", message });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: message });
  });

  it("still answers an unknown database error with 500", () => {
    expect(rpcErrorResponse({ code: "XX000", message: "boom" }).status).toBe(500);
  });
});
