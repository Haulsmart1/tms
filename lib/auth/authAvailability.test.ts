import { describe, expect, it } from "vitest";
import { isTransientAuthFailure } from "./authAvailability";

describe("temporary Supabase auth verification failures", () => {
  it.each([429, 500, 502, 503, 504, 599])(
    "does not treat HTTP %i as a revoked session",
    (status) => {
      expect(isTransientAuthFailure({ status })).toBe(true);
    },
  );

  it.each([0, 200, 400, 401, 403, 404, 422, 600])(
    "keeps HTTP %i out of the outage classification",
    (status) => {
      expect(isTransientAuthFailure({ status })).toBe(false);
    },
  );

  it("does not misclassify absent/malformed errors", () => {
    for (const error of [null, undefined, "", 504, { status: "504" }, {}]) {
      expect(isTransientAuthFailure(error)).toBe(false);
    }
  });

  it("works with an Error object exposing an HTTP status", () => {
    const error = Object.assign(new Error("Gateway timeout"), { status: 504 });
    expect(isTransientAuthFailure(error)).toBe(true);
  });
});
