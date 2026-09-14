import { describe, expect, it } from "vitest";
import { publicActivityRpcError } from "./errors";

describe("publicActivityRpcError", () => {
  it("maps a known RPC exception to friendly text", () => {
    expect(
      publicActivityRpcError("activity overlaps an existing record", "fallback"),
    ).toEqual({
      message: "This activity overlaps an existing record for the driver.",
      known: true,
    });
  });

  it("never returns raw database text for an unknown error", () => {
    const result = publicActivityRpcError(
      'duplicate key value violates unique constraint "driver_activity_logs_pkey"',
      "Unable to save driver activity.",
    );

    expect(result).toEqual({ message: "Unable to save driver activity.", known: false });
  });

  it("handles a missing message", () => {
    expect(publicActivityRpcError(undefined, "x").message).toBe("x");
  });
});
