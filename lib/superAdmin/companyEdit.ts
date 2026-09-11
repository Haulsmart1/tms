/* Normalization and validation for a super-admin company edit.

   THE SECURITY CONTROL OF THIS FEATURE. The route that calls this holds the
   service-role key, which bypasses Row Level Security completely. Passing a
   request body straight to .update() would let any key in that body reach any
   column of company_profiles. The patch is therefore rebuilt from the
   allowlist below and every other key is dropped, silently and deliberately.

   Field list mirrors the form at /settings/company. tenant_id is absent on
   purpose: despite the name it holds the COMPANY id (see rls_04), so letting a
   request rewrite it would move a profile to a different company. */

export const EDITABLE_PROFILE_FIELDS = [
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
] as const;

export type EditableProfileField = (typeof EDITABLE_PROFILE_FIELDS)[number];

const UPPERCASE_FIELDS = new Set<EditableProfileField>(["country_code", "currency_code"]);

export type CompanyEditResult =
  | { ok: true; name: string; profile: Partial<Record<EditableProfileField, string | null>> }
  | { ok: false; error: string; field?: string };

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function normalizeCompanyEdit(input: unknown): CompanyEditResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Expected a JSON object." };
  }

  const body = input as { name?: unknown; profile?: unknown };

  if (typeof body.name !== "string" || body.name.trim() === "") {
    return { ok: false, error: "A company name is required.", field: "name" };
  }
  const name = body.name.trim();

  const rawProfile =
    body.profile && typeof body.profile === "object" && !Array.isArray(body.profile)
      ? (body.profile as Record<string, unknown>)
      : {};

  const profile: Partial<Record<EditableProfileField, string | null>> = {};

  for (const field of EDITABLE_PROFILE_FIELDS) {
    if (!(field in rawProfile)) continue;

    const value = rawProfile[field];

    if (value === null || value === undefined) {
      profile[field] = null;
      continue;
    }

    /* Not coerced with String(). A number or object here means the caller sent
       something the form cannot produce, and quietly stringifying it would
       write "[object Object]" into a customer's address. */
    if (typeof value !== "string") {
      return { ok: false, error: `${field} must be text.`, field };
    }

    const trimmed = value.trim();

    // An empty field is absent, not "". Otherwise a cleared VAT number renders
    // as a filled-looking empty box and sorts as a value rather than a blank.
    if (trimmed === "") {
      profile[field] = null;
      continue;
    }

    if (field === "business_email" && !isEmail(trimmed)) {
      return { ok: false, error: "That business email is not a valid address.", field };
    }

    profile[field] = UPPERCASE_FIELDS.has(field) ? trimmed.toUpperCase() : trimmed;
  }

  /* companies.name and company_profiles.company_name are separate rows, both
     shown to users in different parts of the app. The form offers one input,
     so this writes both from it and they cannot drift apart. */
  profile.company_name = name;

  return { ok: true, name, profile };
}
