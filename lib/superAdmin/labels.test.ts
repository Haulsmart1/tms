import { describe, it, expect } from "vitest";
import { billingModelLabel, subscriptionStatusLabel } from "./labels";

describe("billingModelLabel", () => {
  it("maps known models to their display label", () => {
    expect(billingModelLabel("v1_immediate")).toBe("v1 immediate");
    expect(billingModelLabel("v2_period")).toBe("v2 period");
  });

  it("falls back to the raw value for an unrecognised model", () => {
    expect(billingModelLabel("v3_future")).toBe("v3_future");
  });

  it("returns unknown for a null model", () => {
    expect(billingModelLabel(null)).toBe("unknown");
  });
});

describe("subscriptionStatusLabel", () => {
  it("maps known statuses to their display label", () => {
    expect(subscriptionStatusLabel("active", false)).toBe("active");
    expect(subscriptionStatusLabel("past_due", false)).toBe("past due");
  });

  it("falls back to the raw value for an unrecognised status", () => {
    expect(subscriptionStatusLabel("trialing", false)).toBe("trialing");
  });

  it("returns none for a null status when the read succeeded", () => {
    expect(subscriptionStatusLabel(null, false)).toBe("none");
  });

  it("returns unknown, not none, for a null status when the read failed", () => {
    // A failed company_billing read and a company with genuinely no billing
    // row both leave subscriptionStatus === null, but they are different
    // facts: "no subscription" is a positive claim a failed read cannot
    // support.
    expect(subscriptionStatusLabel(null, true)).toBe("unknown");
  });

  it("still shows unknown even if a status value leaked through while degraded", () => {
    expect(subscriptionStatusLabel("active", true)).toBe("unknown");
  });
});
