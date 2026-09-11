import { describe, it, expect } from "vitest";
import { normalizeCompanyEdit, EDITABLE_PROFILE_FIELDS } from "./companyEdit";

function ok(input: unknown) {
  const result = normalizeCompanyEdit(input);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

describe("normalizeCompanyEdit", () => {
  it("accepts a name and a profile", () => {
    const result = ok({ name: "Acme Haulage", profile: { city: "Leeds" } });
    expect(result.name).toBe("Acme Haulage");
    expect(result.profile.city).toBe("Leeds");
  });

  it("rejects a missing or blank name", () => {
    expect(normalizeCompanyEdit({ profile: {} })).toMatchObject({ ok: false, field: "name" });
    expect(normalizeCompanyEdit({ name: "   ", profile: {} })).toMatchObject({ ok: false, field: "name" });
  });

  it("rejects a non-object body", () => {
    expect(normalizeCompanyEdit(null)).toMatchObject({ ok: false });
    expect(normalizeCompanyEdit("nope")).toMatchObject({ ok: false });
  });

  it("drops keys that are not in the allowlist", () => {
    // The consuming route holds the service-role key, which bypasses RLS
    // entirely. An unfiltered patch would let a crafted body write any column.
    const result = ok({
      name: "Acme",
      profile: { city: "Leeds", id: "evil", tenant_id: "other-company", made_up_column: 1 },
    });
    expect(result.profile).not.toHaveProperty("id");
    expect(result.profile).not.toHaveProperty("tenant_id");
    expect(result.profile).not.toHaveProperty("made_up_column");
    expect(result.profile.city).toBe("Leeds");
  });

  it("keeps company_name in step with the company name", () => {
    // companies.name and company_profiles.company_name are two rows shown to
    // users in different places. One input writes both so they cannot drift.
    const result = ok({ name: "Acme Haulage", profile: { company_name: "Stale Name Ltd" } });
    expect(result.profile.company_name).toBe("Acme Haulage");
  });

  it("trims strings", () => {
    expect(ok({ name: "  Acme  ", profile: { city: "  Leeds  " } }).profile.city).toBe("Leeds");
    expect(ok({ name: "  Acme  ", profile: {} }).name).toBe("Acme");
  });

  it("turns an empty string into null", () => {
    // A cleared field must read as absent, not as "". Otherwise a blank VAT
    // number renders as an empty box that looks filled in.
    expect(ok({ name: "Acme", profile: { vat_number: "" } }).profile.vat_number).toBeNull();
    expect(ok({ name: "Acme", profile: { vat_number: "   " } }).profile.vat_number).toBeNull();
  });

  it("uppercases country and currency codes", () => {
    const result = ok({ name: "Acme", profile: { country_code: "gb", currency_code: "gbp" } });
    expect(result.profile.country_code).toBe("GB");
    expect(result.profile.currency_code).toBe("GBP");
  });

  it("rejects a malformed business email", () => {
    expect(normalizeCompanyEdit({ name: "Acme", profile: { business_email: "not-an-email" } }))
      .toMatchObject({ ok: false, field: "business_email" });
  });

  it("accepts a valid business email and a cleared one", () => {
    expect(ok({ name: "Acme", profile: { business_email: "ops@acme.test" } }).profile.business_email)
      .toBe("ops@acme.test");
    expect(ok({ name: "Acme", profile: { business_email: "" } }).profile.business_email).toBeNull();
  });

  it("rejects a non-string profile value rather than coercing it", () => {
    expect(normalizeCompanyEdit({ name: "Acme", profile: { city: 42 } }))
      .toMatchObject({ ok: false, field: "city" });
  });

  it("accepts an absent profile as an empty patch", () => {
    expect(ok({ name: "Acme" }).profile.company_name).toBe("Acme");
  });

  it("exposes an allowlist that excludes identity columns", () => {
    expect(EDITABLE_PROFILE_FIELDS).not.toContain("id");
    expect(EDITABLE_PROFILE_FIELDS).not.toContain("tenant_id");
    expect(EDITABLE_PROFILE_FIELDS).toContain("city");
  });
});
