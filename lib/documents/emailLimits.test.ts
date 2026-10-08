import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "../rateLimit";
import { documentEmailRules, isEmailVerifiedCompany } from "./emailLimits";

describe("isEmailVerifiedCompany", () => {
  it("is true only for a billing row with a card that is not cancelled", () => {
    expect(isEmailVerifiedCompany({ square_card_id: "ccof:1", status: "active" })).toBe(true);
    expect(isEmailVerifiedCompany({ square_card_id: "ccof:1", status: "past_due" })).toBe(true);
    expect(isEmailVerifiedCompany({ square_card_id: "ccof:1", status: "canceled" })).toBe(false);
    expect(isEmailVerifiedCompany({ square_card_id: null, status: "active" })).toBe(false);
    expect(isEmailVerifiedCompany({ square_card_id: "  ", status: "active" })).toBe(false);
    expect(isEmailVerifiedCompany(null)).toBe(false);
  });
});

describe("documentEmailRules", () => {
  it("applies the per-user and per-tenant rules to every company", () => {
    const rules = documentEmailRules(true).map((r) => r.rule);
    expect(rules).toEqual([RATE_LIMITS.documentEmailPerUser, RATE_LIMITS.documentEmailPerTenant]);
  });

  it("adds a small daily cap for a company with no card on file (N-10)", () => {
    const rules = documentEmailRules(false);
    expect(rules.map((r) => r.rule)).toContain(RATE_LIMITS.documentEmailPerUnverifiedTenant);
    expect(rules.find((r) => r.rule === RATE_LIMITS.documentEmailPerUnverifiedTenant)?.key).toBe("tenant");
    expect(RATE_LIMITS.documentEmailPerUnverifiedTenant.max).toBeLessThan(RATE_LIMITS.documentEmailPerTenant.max);
  });
});
