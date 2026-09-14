import { describe, expect, it } from "vitest";
import { checkCronAuthorization, withinBudget } from "./cronAuth";

describe("checkCronAuthorization", () => {
  it("accepts the configured bearer secret", () => {
    expect(checkCronAuthorization("s3cret", "Bearer s3cret")).toBe("ok");
  });

  it("refuses a wrong secret", () => {
    expect(checkCronAuthorization("s3cret", "Bearer nope")).toBe("unauthorized");
  });

  it("refuses a missing header", () => {
    expect(checkCronAuthorization("s3cret", null)).toBe("unauthorized");
  });

  it("refuses a prefix of the secret", () => {
    expect(checkCronAuthorization("s3cret", "Bearer s3cre")).toBe("unauthorized");
  });

  // BILL1-4: a deployment with no secret is an outage, not an intruder.
  it("reports a missing secret as misconfigured, whatever was sent", () => {
    expect(checkCronAuthorization(undefined, "Bearer anything")).toBe(
      "misconfigured"
    );
    expect(checkCronAuthorization("", "Bearer ")).toBe("misconfigured");
    expect(checkCronAuthorization("   ", "Bearer    ")).toBe("misconfigured");
  });
});

describe("withinBudget", () => {
  it("allows work before the budget is spent", () => {
    expect(withinBudget(0, 239_999, 240_000)).toBe(true);
  });

  it("stops at the budget", () => {
    expect(withinBudget(0, 240_000, 240_000)).toBe(false);
  });
});
