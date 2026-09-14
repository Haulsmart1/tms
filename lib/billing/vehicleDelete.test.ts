import { describe, expect, it } from "vitest";
import {
  decideVehicleDelete,
  isLicenceEverActive,
  isMissingRpcError,
  vehicleDeleteResponse,
} from "./vehicleDelete";

const NONE = {
  everActiveLicences: 0,
  coverageRows: 0,
  addonChargeRows: 0,
  invoiceLineRows: 0,
};

describe("isLicenceEverActive", () => {
  // The billing_07 shape for a licence that never ran: deactivated_at equal
  // to activated_at. That is a draft, and it is the only kind that may go.
  it("treats a zero-length licence as a never-active draft", () => {
    expect(
      isLicenceEverActive({
        active: false,
        activatedAt: "2026-09-01T10:00:00Z",
        deactivatedAt: "2026-09-01T10:00:00Z",
      })
    ).toBe(false);
  });

  it("treats the same instant written in a different offset as a draft", () => {
    expect(
      isLicenceEverActive({
        active: false,
        activatedAt: "2026-09-01T10:00:00+00:00",
        deactivatedAt: "2026-09-01T11:00:00+01:00",
      })
    ).toBe(false);
  });

  it("counts a licence that is active now", () => {
    expect(
      isLicenceEverActive({
        active: true,
        activatedAt: "2026-09-01T10:00:00Z",
        deactivatedAt: null,
      })
    ).toBe(true);
  });

  it("counts an open licence even if active reads false", () => {
    expect(
      isLicenceEverActive({
        active: false,
        activatedAt: "2026-09-01T10:00:00Z",
        deactivatedAt: null,
      })
    ).toBe(true);
  });

  // Ran for one second: it is on an invoice somewhere.
  it("counts a licence that ran for any length of time", () => {
    expect(
      isLicenceEverActive({
        active: false,
        activatedAt: "2026-09-01T10:00:00Z",
        deactivatedAt: "2026-09-01T10:00:01Z",
      })
    ).toBe(true);
  });

  // billing_07 not applied: no lifecycle columns, so history is unknown and
  // the licence is kept as evidence rather than guessed to be a draft.
  it("fails closed when the lifecycle columns are unknown", () => {
    expect(
      isLicenceEverActive({ active: false, activatedAt: undefined, deactivatedAt: undefined })
    ).toBe(true);
  });

  it("fails closed on an unparseable timestamp", () => {
    expect(
      isLicenceEverActive({ active: false, activatedAt: "banana", deactivatedAt: "banana" })
    ).toBe(true);
  });
});

describe("decideVehicleDelete", () => {
  it("allows a vehicle with no billing evidence", () => {
    expect(decideVehicleDelete(NONE)).toEqual({ kind: "allow" });
  });

  it.each([
    ["everActiveLicences"],
    ["coverageRows"],
    ["addonChargeRows"],
    ["invoiceLineRows"],
  ] as const)("refuses when %s is non-zero", (key) => {
    const decision = decideVehicleDelete({ ...NONE, [key]: 1 });
    expect(decision.kind).toBe("refuse");
    if (decision.kind === "refuse") {
      expect(decision.message).toMatch(/inactive/i);
    }
  });
});

describe("vehicleDeleteResponse", () => {
  it("maps deleted to 200 ok", () => {
    expect(vehicleDeleteResponse("deleted")).toEqual({ status: 200, body: { ok: true } });
  });

  it("maps not_found to 404", () => {
    expect(vehicleDeleteResponse("not_found").status).toBe(404);
  });

  it("maps has_billing_evidence to 409 with a reason", () => {
    const response = vehicleDeleteResponse("has_billing_evidence");
    expect(response.status).toBe(409);
    expect((response.body as { error: string }).error).toMatch(/inactive/i);
  });

  it("maps referenced to 409 with a reason", () => {
    const response = vehicleDeleteResponse("referenced");
    expect(response.status).toBe(409);
    expect((response.body as { error: string }).error).toMatch(/inactive/i);
  });

  // An answer the route does not know must never read as a success.
  it("treats an unknown rpc answer as a server error", () => {
    expect(vehicleDeleteResponse("something_else").status).toBe(500);
    expect(vehicleDeleteResponse(null).status).toBe(500);
  });
});

describe("isMissingRpcError", () => {
  it("recognises PostgREST and Postgres missing-function codes", () => {
    expect(isMissingRpcError({ code: "PGRST202" })).toBe(true);
    expect(isMissingRpcError({ code: "42883" })).toBe(true);
  });

  it("does not treat other errors as a missing function", () => {
    expect(isMissingRpcError({ code: "23503" })).toBe(false);
    expect(isMissingRpcError(null)).toBe(false);
  });
});
