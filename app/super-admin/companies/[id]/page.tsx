"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "../../../../lib/supabase/browser";
import { EDITABLE_PROFILE_FIELDS } from "../../../../lib/superAdmin/companyEdit";
import Field from "../../../../components/Field";
import Textarea from "../../../../components/Textarea";
import Button from "../../../../components/Button";
import MessageBanner from "../../../../components/MessageBanner";
import Skeleton from "../../../../components/Skeleton";

type ProfileState = Partial<Record<(typeof EDITABLE_PROFILE_FIELDS)[number], string>>;

/* Grouped for the form only; the allowlist in companyEdit.ts remains the
   authority on what may be written. A field added here but not there is
   silently dropped by the route, which is the safe direction for that
   mistake to fail in; a field added there but not here is invisible to the
   operator, which this list must be kept in step with. */
const CORE_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "trading_name", label: "Trading name" },
  { key: "legal_entity_type", label: "Legal entity type" },
  { key: "industry_type", label: "Industry type" },
  { key: "registration_number", label: "Registration number" },
  { key: "vat_number", label: "VAT number" },
  { key: "tax_number", label: "Tax number" },
  { key: "eori_number", label: "EORI number" },
  { key: "operator_licence_number", label: "Operator licence number" },
];

const CONTACT_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "business_email", label: "Business email" },
  { key: "business_phone", label: "Business phone" },
  { key: "website", label: "Website" },
];

const ADDRESS_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "address_line_1", label: "Address line 1" },
  { key: "address_line_2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "region", label: "Region" },
  { key: "postcode", label: "Postcode" },
  { key: "country_code", label: "Country code" },
  { key: "currency_code", label: "Currency code" },
  { key: "timezone", label: "Timezone" },
  { key: "language_code", label: "Language code" },
];

/* This is a UK and EU product. The US fields exist in the schema (some
   companies were seeded with them) and are kept reachable, but collapsed,
   the same way /settings/company treats them. */
const US_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "us_ein", label: "US EIN" },
  { key: "usdot_number", label: "USDOT number" },
  { key: "mc_number", label: "MC number" },
  { key: "ifta_number", label: "IFTA number" },
  { key: "irp_number", label: "IRP number" },
  { key: "scac_code", label: "SCAC code" },
];

export default function SuperAdminCompanyDetailPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams<{ id: string }>();
  const companyId = params.id;

  const [name, setName] = useState("");
  const [profile, setProfile] = useState<ProfileState>({});
  const [loading, setLoading] = useState(true);
  // True only once a company row has actually been read successfully. The
  // form is gated on this, not on `!loading`: without the distinction, a
  // load that fails (network blip, RLS denial, bad id) still flips loading
  // to false and would render the form with every field blank, which looks
  // exactly like an unnamed company with no details on record rather than a
  // page that failed to load one. A failed reload after a successful first
  // load also leaves this true, so the form keeps showing the last known
  // good state instead of being blanked by a transient error.
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Distinguishes "nothing was saved" from "part of the save landed". A
  // partial failure is still an error, but rendering it identically to a
  // clean failure invites the operator to retry the whole form when only one
  // write actually needs retrying.
  const [partial, setPartial] = useState(false);
  const [notice, setNotice] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [company, profileRow] = await Promise.all([
      supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
      // tenant_id holds the COMPANY id here, despite the column name
      // (docs/sql/rls_04_identity_tables.sql:27). One profile row per company.
      supabase.from("company_profiles").select("*").eq("tenant_id", companyId).maybeSingle(),
    ]);

    if (company.error) {
      setError(company.error.message);
      setLoading(false);
      return;
    }

    if (!company.data) {
      setError("No such company.");
      setLoading(false);
      return;
    }

    if (profileRow.error) {
      // maybeSingle() returning no row is normal (a company with no profile
      // yet). A real read error is a different fact and must not be treated
      // the same way, which is why this is checked separately from the
      // absence of profileRow.data below.
      setError(profileRow.error.message);
      setLoading(false);
      return;
    }

    setName((company.data.name as string | null) ?? "");

    const row = (profileRow.data ?? {}) as Record<string, unknown>;
    const nextProfile: ProfileState = {};
    for (const key of EDITABLE_PROFILE_FIELDS) {
      const value = row[key];
      // null (and a missing profile row) becomes "", so a cleared field
      // shows as an empty box rather than the string "null". The route turns
      // "" back into null on the way in, so round-tripping is lossless.
      nextProfile[key] = typeof value === "string" ? value : "";
    }
    setProfile(nextProfile);

    setLoaded(true);
    setLoading(false);
  }, [supabase, companyId]);

  useEffect(() => {
    load();
  }, [load]);

  function setProfileField(key: keyof ProfileState, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setPartial(false);
    setNotice("");
    setFieldError(null);

    try {
      const response = await fetch(`/api/super-admin/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, profile }),
      });

      const payload = (await response.json()) as { error?: string; field?: string; partial?: boolean };

      if (!response.ok) {
        if (payload.field) setFieldError({ field: payload.field, message: payload.error ?? "" });
        setError(payload.error ?? "Could not save this company.");
        setPartial(Boolean(payload.partial));

        // Something real landed on a partial failure. Reload so the form
        // reflects the database rather than the operator's last keystrokes,
        // which no longer match what is actually stored.
        if (payload.partial) await load();

        setSaving(false);
        return;
      }

      setNotice("Saved.");
      await load();
    } catch {
      setError("Could not reach the server.");
    }

    setSaving(false);
  }

  function renderFields(fields: Array<{ key: keyof ProfileState; label: string }>) {
    return fields.map((field) => (
      <Field
        key={String(field.key)}
        id={`profile-${String(field.key)}`}
        label={field.label}
        value={profile[field.key] ?? ""}
        onChange={(event) => setProfileField(field.key, event.target.value)}
        error={fieldError?.field === field.key ? fieldError.message : undefined}
      />
    ));
  }

  return (
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-4">
          <Link href="/super-admin/companies" className="text-sm text-ink-3 no-underline hover:text-ink">
            ← All companies
          </Link>

          <h1 className="mb-1 mt-2 text-xl font-semibold tracking-tight text-ink">
            {loading ? <Skeleton w="18ch" h="1.5rem" /> : loaded ? name || "Unnamed company" : "Company"}
          </h1>

          <p className="m-0 font-mono text-xs text-ink-3">{companyId}</p>
        </header>

        {/* Skeletons below are aria-hidden by design, so without this a
            screen reader gets silence for the whole load. */}
        <span className="sr-only" role="status">
          {loading ? "Loading company" : ""}
        </span>

        <MessageBanner tone={partial ? "warning" : "danger"}>{error}</MessageBanner>
        <MessageBanner tone="success">{notice}</MessageBanner>

        {loading ? (
          <div aria-hidden className="grid gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                <Skeleton w="20ch" h="1rem" />
              </div>
            ))}
          </div>
        ) : !loaded ? (
          // The load failed outright (bad id, RLS denial, network error). The
          // reason is already stated in the danger banner above; rendering a
          // blank form here as well would read as "this company has no
          // details on record", which is not a fact this page has.
          <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <p className="m-0 text-sm text-ink-2">This company could not be loaded.</p>
            <div className="mt-3">
              <Button type="button" variant="secondary" onClick={load}>
                Retry
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            className="grid gap-4"
          >
            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Identity</h2>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id="company-name"
                  label="Company name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  hint="Written to both the company record and the profile, so they cannot drift apart."
                  error={fieldError?.field === "name" ? fieldError.message : undefined}
                  wrapperClassName="sm:col-span-2"
                />

                {renderFields(CORE_FIELDS)}
              </div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Contact</h2>
              <div className="grid gap-3 sm:grid-cols-2">{renderFields(CONTACT_FIELDS)}</div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Address and locale</h2>
              <div className="grid gap-3 sm:grid-cols-2">{renderFields(ADDRESS_FIELDS)}</div>
            </section>

            <details className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <summary className="cursor-pointer text-md font-semibold text-ink">
                US registrations
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">{renderFields(US_FIELDS)}</div>
            </details>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Notes</h2>
              <Textarea
                id="profile-notes"
                label="Notes"
                value={profile.notes ?? ""}
                onChange={(event) => setProfileField("notes", event.target.value)}
                rows={4}
              />
            </section>

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving" : "Save changes"}
              </Button>
              <Button type="button" variant="secondary" onClick={load} disabled={saving}>
                Discard changes
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
