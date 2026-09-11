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

  it("rejects a name over the length cap", () => {
    // `name` is a parameter, not a key of the profile object the loop below
    // enforces MAX_LENGTH on, so this check has to be separate -- and it has
    // to exist, or a multi-kilobyte name reaches company_profiles.company_name
    // (and later a PDF that never truncates) unchecked.
    const tooLong = "A".repeat(501);
    expect(normalizeCompanyEdit({ name: tooLong, profile: {} })).toMatchObject({
      ok: false,
      field: "name",
    });
    expect(normalizeCompanyEdit({ name: "A".repeat(500), profile: {} })).toMatchObject({ ok: true });
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

  it("pins the allowlist exactly", () => {
    // Deleting a field here leaves this suite green and the symptom is
    // silent: the operator edits the field, gets a 200, and nothing changes.
    expect(EDITABLE_PROFILE_FIELDS).toEqual([
      "company_name",
      "trading_name",
      "legal_entity_type",
      "industry_type",
      "registration_number",
      "tax_number",
      "vat_number",
      "eori_number",
      "operator_licence_number",
      "us_ein",
      "usdot_number",
      "mc_number",
      "ifta_number",
      "irp_number",
      "scac_code",
      "business_email",
      "business_phone",
      "website",
      "address_line_1",
      "address_line_2",
      "city",
      "region",
      "postcode",
      "country_code",
      "currency_code",
      "timezone",
      "language_code",
      "notes",
    ]);
    expect(EDITABLE_PROFILE_FIELDS.length).toBe(28);
  });

  it("leaves a field the caller did not send out of the patch", () => {
    // The route does .update(profile). A field absent here must stay
    // untouched in the row; a null would blank a column nobody edited.
    const result = ok({ name: "Acme", profile: { city: "Leeds" } });
    expect(Object.keys(result.profile).sort()).toEqual(["city", "company_name"]);
  });

  it("accepts an explicit null for a field", () => {
    const result = ok({ name: "Acme", profile: { city: null } });
    expect(result.profile.city).toBeNull();
  });

  it("rejects a body that is an array", () => {
    expect(normalizeCompanyEdit([])).toMatchObject({ ok: false });
  });

  it("rejects an invalid IANA timezone", () => {
    // app/tachograph/page.tsx feeds company_profiles.timezone straight into
    // Intl.DateTimeFormat with no guard: a typo here throws during render.
    expect(normalizeCompanyEdit({ name: "Acme", profile: { timezone: "Europe/Londn" } }))
      .toMatchObject({ ok: false, field: "timezone" });
  });

  it("accepts a valid IANA timezone", () => {
    expect(ok({ name: "Acme", profile: { timezone: "Europe/London" } }).profile.timezone).toBe(
      "Europe/London"
    );
  });

  it("rejects a malformed currency code", () => {
    expect(normalizeCompanyEdit({ name: "Acme", profile: { currency_code: "GBPX" } }))
      .toMatchObject({ ok: false, field: "currency_code" });
    expect(normalizeCompanyEdit({ name: "Acme", profile: { currency_code: "ZZ" } }))
      .toMatchObject({ ok: false, field: "currency_code" });
  });

  it("rejects a malformed country code", () => {
    expect(normalizeCompanyEdit({ name: "Acme", profile: { country_code: "ZZZ" } }))
      .toMatchObject({ ok: false, field: "country_code" });
    expect(normalizeCompanyEdit({ name: "Acme", profile: { country_code: "UNITED KINGDOM" } }))
      .toMatchObject({ ok: false, field: "country_code" });
  });

  it('accepts the literal "OTHER" country code', () => {
    // app/settings/company/page.tsx offers OTHER as a real option in the
    // country select, not just ISO codes.
    expect(ok({ name: "Acme", profile: { country_code: "other" } }).profile.country_code).toBe(
      "OTHER"
    );
  });

  it("rejects a field over the length limit", () => {
    expect(normalizeCompanyEdit({ name: "Acme", profile: { city: "a".repeat(501) } }))
      .toMatchObject({ ok: false, field: "city" });
  });

  it("gives notes a longer length limit than other fields", () => {
    expect(ok({ name: "Acme", profile: { notes: "a".repeat(5000) } }).profile.notes).toHaveLength(
      5000
    );
    expect(normalizeCompanyEdit({ name: "Acme", profile: { notes: "a".repeat(5001) } }))
      .toMatchObject({ ok: false, field: "notes" });
  });

  it("lowercases language_code", () => {
    // app/settings/company/page.tsx writes language_code with .toLowerCase();
    // storing anything else drifts back on the customer's next save.
    expect(ok({ name: "Acme", profile: { language_code: "EN" } }).profile.language_code).toBe(
      "en"
    );
  });
});
