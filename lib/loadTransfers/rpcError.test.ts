import { describe, expect, it } from "vitest";
import { loadTransferRpcError } from "./rpcError";

describe("loadTransferRpcError", () => {
  it("passes a known RAISE sentence through with its status", () => {
    expect(
      loadTransferRpcError({ code: "23514", message: "Source and destination vehicles must differ." }),
    ).toEqual({ status: 409, message: "Source and destination vehicles must differ.", log: false });
    expect(
      loadTransferRpcError({
        code: "22023",
        message: "A load transfer cannot contain more than 1000 serialized items.",
      }),
    ).toEqual({
      status: 400,
      message: "A load transfer cannot contain more than 1000 serialized items.",
      log: false,
    });
  });

  it("passes the VOR destination refusal through as a 409", () => {
    expect(
      loadTransferRpcError({ code: "LTR01", message: "Vehicle AB12 CDE is off the road. Load cannot be transferred onto it." }),
    ).toEqual({ status: 409, message: "Vehicle AB12 CDE is off the road. Load cannot be transferred onto it.", log: false });
  });

  it("rewords the custody race as a retry", () => {
    const result = loadTransferRpcError({ code: "40001", message: "Transfer custody update was incomplete." });
    expect(result.status).toBe(409);
    expect(result.message).toBe("The load changed while it was being transferred. Try again.");
  });

  it("never echoes unknown text for a known SQLSTATE", () => {
    const raw = 'duplicate key value violates unique constraint "load_transfer_items_pkey"';
    const result = loadTransferRpcError({ code: "23505", message: raw });
    expect(result.status).toBe(409);
    expect(result.message).not.toContain("load_transfer_items_pkey");
    expect(result.log).toBe(true);

    const bad = loadTransferRpcError({ code: "22023", message: "invalid input syntax for type uuid" });
    expect(bad.status).toBe(400);
    expect(bad.message).toBe("Invalid load transfer request.");
  });

  it("does not trust a known sentence under the wrong SQLSTATE", () => {
    const result = loadTransferRpcError({ code: "XX000", message: "Source and destination vehicles must differ." });
    expect(result).toEqual({ status: 500, message: "Unable to transfer load.", log: true });
  });

  it("turns the licence gate into the user sentence", () => {
    const result = loadTransferRpcError({
      code: "LIC01",
      message: "Vehicle AB12 CDE has no active licence. Activate it on the Licences page before assigning it.",
    });
    expect(result.status).toBe(409);
    expect(result.message).toBe(
      "Vehicle AB12 CDE has no active licence. Activate it on the Licences page before assigning it.",
    );
  });

  it("answers 500 with generic text for anything else", () => {
    expect(loadTransferRpcError({ code: "42P01", message: 'relation "x" does not exist' })).toEqual({
      status: 500,
      message: "Unable to transfer load.",
      log: true,
    });
    expect(loadTransferRpcError({})).toEqual({ status: 500, message: "Unable to transfer load.", log: true });
  });
});
