import { describe, expect, it } from "vitest";
import { SIGNUP_ENABLED_ENV, signupClosedResponse, signupEnabled } from "./signupGate";

/* Self-serve signup is closed unless production says otherwise. The switch
   must fail CLOSED: an unset, blank, misspelt or "false" value all refuse,
   and only the literal "true" opens the doors. */

describe("signupEnabled", () => {
  it("is closed when the variable is unset", () => {
    expect(signupEnabled(undefined)).toBe(false);
  });

  it("is closed for blank, false, 0 and anything that is not the word true", () => {
    for (const value of ["", "   ", "false", "0", "no", "yes", "1", "on", "enabled", "truee", "true false"]) {
      expect(signupEnabled(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("opens only for the literal true, case-insensitively, trimmed", () => {
    expect(signupEnabled("true")).toBe(true);
    expect(signupEnabled("TRUE")).toBe(true);
    expect(signupEnabled(" true\n")).toBe(true);
  });

  it("names the environment variable the route and page read", () => {
    expect(SIGNUP_ENABLED_ENV).toBe("SIGNUP_ENABLED");
  });
});

describe("signupClosedResponse", () => {
  it("answers 404 with a JSON body that carries no hint about accounts", () => {
    const response = signupClosedResponse();
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ ok: false, error: "not_found" });
  });
});
