import { describe, expect, it } from "vitest";
import {
  UNLICENSED_VEHICLE_ERRCODE,
  UNLICENSED_VEHICLE_HINT,
  isUnlicensedVehicleError,
  unlicensedVehicleMessage,
} from "./unlicensedVehicle";

const DB_MESSAGE =
  "Vehicle AB12CDE has no active licence. Activate it on the Licences page before assigning it.";

describe("isUnlicensedVehicleError", () => {
  it("matches the PostgREST error by code", () => {
    expect(
      isUnlicensedVehicleError({ code: "LIC01", message: DB_MESSAGE, hint: null, details: "x" })
    ).toBe(true);
  });

  it("matches by hint when the code was lost", () => {
    expect(
      isUnlicensedVehicleError({ code: "P0001", message: "anything", hint: "vehicle_unlicensed" })
    ).toBe(true);
  });

  it("matches a wrapped Error that only kept the message", () => {
    expect(
      isUnlicensedVehicleError(new Error(`canonical itinerary save failed: ${DB_MESSAGE}`))
    ).toBe(true);
  });

  it("does not match unrelated errors or junk", () => {
    expect(isUnlicensedVehicleError({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isUnlicensedVehicleError(new Error("no active licence"))).toBe(false);
    expect(isUnlicensedVehicleError(null)).toBe(false);
    expect(isUnlicensedVehicleError(undefined)).toBe(false);
    expect(isUnlicensedVehicleError("LIC01")).toBe(false);
  });

  it("exports the contract constants the SQL raises", () => {
    expect(UNLICENSED_VEHICLE_ERRCODE).toBe("LIC01");
    expect(UNLICENSED_VEHICLE_HINT).toBe("vehicle_unlicensed");
  });
});

const CANCELLED_MESSAGE =
  "Vehicle AB12CDE cannot be assigned to new work because this company's subscription is cancelled.";

describe("cancelled-company refusal (LIC02)", () => {
  it("is recognised by code, hint or sentence", () => {
    expect(isUnlicensedVehicleError({ code: "LIC02", message: CANCELLED_MESSAGE })).toBe(true);
    expect(isUnlicensedVehicleError({ code: "P0001", message: "x", hint: "company_billing_cancelled" })).toBe(true);
    expect(isUnlicensedVehicleError(new Error(`save failed: ${CANCELLED_MESSAGE}`))).toBe(true);
  });

  it("returns the database sentence, not the licence copy", () => {
    expect(unlicensedVehicleMessage({ code: "LIC02", message: CANCELLED_MESSAGE })).toBe(CANCELLED_MESSAGE);
    expect(unlicensedVehicleMessage(new Error(`save failed: ${CANCELLED_MESSAGE}`))).toBe(CANCELLED_MESSAGE);
  });

  it("falls back to cancellation copy when the code survived but the message did not", () => {
    expect(unlicensedVehicleMessage({ code: "LIC02", message: "" })).toMatch(/subscription is cancelled/);
  });
});

describe("unlicensedVehicleMessage", () => {
  it("returns the database sentence for a recognised error", () => {
    expect(unlicensedVehicleMessage({ code: "LIC01", message: DB_MESSAGE })).toBe(DB_MESSAGE);
  });

  it("extracts the sentence from a wrapped message", () => {
    expect(unlicensedVehicleMessage(new Error(`save failed: ${DB_MESSAGE}`))).toBe(DB_MESSAGE);
  });

  it("falls back to generic copy when recognised by code but the message is empty", () => {
    expect(unlicensedVehicleMessage({ code: "LIC01", message: "" })).toMatch(/no active licence/);
  });

  it("falls back to generic copy for an unrecognised error", () => {
    expect(unlicensedVehicleMessage({ code: "23505", message: "duplicate key" })).toMatch(
      /no active licence/
    );
  });
});
