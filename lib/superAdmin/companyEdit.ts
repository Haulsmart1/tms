import { isValidIanaTimeZone } from "../time";

/* Normalization and validation for a super-admin company edit.

   THE SECURITY CONTROL OF THIS FEATURE. The route that calls this holds the
   service-role key, which bypasses Row Level Security completely. Passing a
   request body straight to .update() would let any key in that body reach any
   column of company_profiles. The patch is therefore rebuilt from the
   allowlist below and every other key is dropped, silently and deliberately.

   Field list mirrors the form at /settings/company. tenant_id is absent on
   purpose: despite the name it holds the COMPANY id (see rls_04), so letting a
   request rewrite it would move a profile to a different company. The caller
   never gets to set it here: the consuming route supplies tenant_id itself
   from the URL parameter, never from the request body, which is what makes it
   a safe upsert conflict key rather than a caller-controlled write. */

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

// app/settings/company/page.tsx:457 writes language_code with .toLowerCase().
// Storing anything else here is exactly the drift the company_name comment
// below exists to prevent: the customer's own next save silently flips it.
const LOWERCASE_FIELDS = new Set<EditableProfileField>(["language_code"]);

// Every field these PDFs and pages render assumes a bounded length. notes is
// a free-text field so it gets more room; everything else mirrors a form
// input that was never meant to hold paragraphs.
const MAX_LENGTH = 500;
const MAX_NOTES_LENGTH = 5000;

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

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

    const maxLength = field === "notes" ? MAX_NOTES_LENGTH : MAX_LENGTH;
    if (trimmed.length > maxLength) {
      return { ok: false, error: `${field} is too long.`, field };
    }

    if (field === "business_email" && !isEmail(trimmed)) {
      return { ok: false, error: "That business email is not a valid address.", field };
    }

    // An invalid IANA name is not harmless: app/tachograph/page.tsx reads
    // company_profiles.timezone and feeds it straight into
    // Intl.DateTimeFormat with no guard, so a typo here throws a RangeError
    // during render and white-screens that page for the customer.
    if (field === "timezone" && !isValidIanaTimeZone(trimmed)) {
      return { ok: false, error: "That is not a valid IANA timezone.", field };
    }

    let normalized = trimmed;
    if (UPPERCASE_FIELDS.has(field)) normalized = trimmed.toUpperCase();
    if (LOWERCASE_FIELDS.has(field)) normalized = trimmed.toLowerCase();

    if (field === "currency_code" && !CURRENCY_CODE_PATTERN.test(normalized)) {
      return { ok: false, error: "That is not a valid currency code.", field };
    }

    /* country_code also accepts the literal "OTHER": app/settings/company's
       country select offers it as a real option, not just ISO codes. Any
       other value outside that select's option set renders the customer's
       own settings page with nothing selected (the page branches its
       legal-entity-type options on GB vs US), and their next save silently
       rewrites their country to whatever fell out of that broken state. */
    if (field === "country_code" && normalized !== "OTHER" && !COUNTRY_CODE_PATTERN.test(normalized)) {
      return { ok: false, error: "That is not a valid country code.", field };
    }

    profile[field] = normalized;
  }

  /* companies.name and company_profiles.company_name are separate rows, both
     shown to users in different parts of the app. The form offers one input,
     so this writes both from it and they cannot drift apart. */
  profile.company_name = name;

  return { ok: true, name, profile };
}
