"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import Button from "../../../components/Button";
import Card from "../../../components/Card";
import Field from "../../../components/Field";
import MessageBanner from "../../../components/MessageBanner";
import Select from "../../../components/Select";
import Textarea from "../../../components/Textarea";
import StripeConnectionPanel from "../../../components/settings/StripeConnectionPanel";
import { useTenant } from "../../components/TenantProvider";

type CompanyProfile = {
  tenant_id: string;
  company_name: string;
  trading_name: string;
  legal_entity_type: string;
  industry_type: string;
  registration_number: string;
  tax_number: string;
  vat_number: string;
  eori_number: string;
  operator_licence_number: string;
  us_ein: string;
  usdot_number: string;
  mc_number: string;
  ifta_number: string;
  irp_number: string;
  scac_code: string;
  business_email: string;
  business_phone: string;
  website: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  region: string;
  postcode: string;
  country_code: string;
  currency_code: string;
  timezone: string;
  language_code: string;
  notes: string;
};

type CompanyProfileRow = {
  tenant_id: string;
  company_name: string | null;
  trading_name: string | null;
  legal_entity_type: string | null;
  industry_type: string | null;
  registration_number: string | null;
  tax_number: string | null;
  vat_number: string | null;
  eori_number: string | null;
  operator_licence_number: string | null;
  us_ein: string | null;
  usdot_number: string | null;
  mc_number: string | null;
  ifta_number: string | null;
  irp_number: string | null;
  scac_code: string | null;
  business_email: string | null;
  business_phone: string | null;
  website: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country_code: string | null;
  currency_code: string | null;
  timezone: string | null;
  language_code: string | null;
  notes: string | null;
};

const countryOptions = [
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "IE", label: "Ireland" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "ES", label: "Spain" },
  { value: "NL", label: "Netherlands" },
  { value: "BE", label: "Belgium" },
  { value: "AU", label: "Australia" },
  { value: "CA", label: "Canada" },
  { value: "NZ", label: "New Zealand" },
  { value: "OTHER", label: "Other" },
];

const industryOptions = [
  { value: "transport", label: "Transport / Haulage" },
  { value: "logistics", label: "Logistics" },
  { value: "courier", label: "Courier / Delivery" },
  { value: "freight_broker", label: "Freight Broker" },
  { value: "fleet_operator", label: "Fleet Operator" },
  { value: "warehouse", label: "Warehouse / Distribution" },
  { value: "other", label: "Other" },
];

const gbEntityOptions = [
  { value: "sole_trader", label: "Sole Trader" },
  { value: "ltd", label: "Ltd Company" },
  { value: "llp", label: "LLP" },
  { value: "partnership", label: "Partnership" },
  { value: "plc", label: "PLC" },
  { value: "other", label: "Other" },
];

const usEntityOptions = [
  { value: "sole_proprietorship", label: "Sole Proprietorship" },
  { value: "llc", label: "LLC" },
  { value: "partnership", label: "Partnership" },
  { value: "corporation", label: "Corporation" },
  { value: "s_corporation", label: "S Corporation" },
  { value: "c_corporation", label: "C Corporation" },
  { value: "nonprofit", label: "Nonprofit" },
  { value: "other", label: "Other" },
];

const globalEntityOptions = [
  { value: "sole_proprietor", label: "Sole Proprietor / Sole Trader" },
  { value: "limited_company", label: "Limited Company" },
  { value: "partnership", label: "Partnership" },
  { value: "corporation", label: "Corporation" },
  { value: "other", label: "Other" },
];

function createEmptyProfile(companyId: string): CompanyProfile {
  return {
    tenant_id: companyId,
    company_name: "",
    trading_name: "",
    legal_entity_type: "",
    industry_type: "transport",
    registration_number: "",
    tax_number: "",
    vat_number: "",
    eori_number: "",
    operator_licence_number: "",
    us_ein: "",
    usdot_number: "",
    mc_number: "",
    ifta_number: "",
    irp_number: "",
    scac_code: "",
    business_email: "",
    business_phone: "",
    website: "",
    address_line_1: "",
    address_line_2: "",
    city: "",
    region: "",
    postcode: "",
    country_code: "GB",
    currency_code: "GBP",
    timezone: "Europe/London",
    language_code: "en",
    notes: "",
  };
}

function mapRowToProfile(row: CompanyProfileRow): CompanyProfile {
  return {
    tenant_id: row.tenant_id,
    company_name: row.company_name ?? "",
    trading_name: row.trading_name ?? "",
    legal_entity_type: row.legal_entity_type ?? "",
    industry_type: row.industry_type ?? "transport",
    registration_number: row.registration_number ?? "",
    tax_number: row.tax_number ?? "",
    vat_number: row.vat_number ?? "",
    eori_number: row.eori_number ?? "",
    operator_licence_number: row.operator_licence_number ?? "",
    us_ein: row.us_ein ?? "",
    usdot_number: row.usdot_number ?? "",
    mc_number: row.mc_number ?? "",
    ifta_number: row.ifta_number ?? "",
    irp_number: row.irp_number ?? "",
    scac_code: row.scac_code ?? "",
    business_email: row.business_email ?? "",
    business_phone: row.business_phone ?? "",
    website: row.website ?? "",
    address_line_1: row.address_line_1 ?? "",
    address_line_2: row.address_line_2 ?? "",
    city: row.city ?? "",
    region: row.region ?? "",
    postcode: row.postcode ?? "",
    country_code: row.country_code ?? "GB",
    currency_code: row.currency_code ?? "GBP",
    timezone: row.timezone ?? "Europe/London",
    language_code: row.language_code ?? "en",
    notes: row.notes ?? "",
  };
}

export default function CompanySettingsPage() {
  const {
    status: tenantStatus,
    activeTenantId,
    writeTenantId,
  } = useTenant();

  const selectedTenantId =
    writeTenantId ??
    activeTenantId;
  const supabase = useMemo(() => createClient(), []);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"error" | "success" | "info">(
    "info"
  );

  const entityOptions = useMemo(() => {
    if (!profile) return globalEntityOptions;
    if (profile.country_code === "GB") return gbEntityOptions;
    if (profile.country_code === "US") return usEntityOptions;
    return globalEntityOptions;
  }, [profile]);

  const isUS = profile?.country_code === "US";
  const isGB = profile?.country_code === "GB";
  const isTransportRelated =
    profile?.industry_type === "transport" ||
    profile?.industry_type === "logistics" ||
    profile?.industry_type === "courier" ||
    profile?.industry_type === "fleet_operator";

  function setError(text: string) {
    setMessageType("error");
    setMessage(text);
  }

  function setSuccess(text: string) {
    setMessageType("success");
    setMessage(text);
  }


  async function loadProfile(
    currentCompanyId: string,
    isMounted: () => boolean
  ) {
    if (!isMounted()) return;

    setLoading(true);
    setMessage("");

    const { data, error } = await supabase
      .from("company_profiles")
      .select("*")
      .eq("tenant_id", currentCompanyId)
      .maybeSingle();

    if (!isMounted()) return;

    if (error) {
      setError(error.message);
      setProfile(createEmptyProfile(currentCompanyId));
      setLoading(false);
      return;
    }

    if (!data) {
      setProfile(createEmptyProfile(currentCompanyId));
      setLoading(false);
      return;
    }

    setProfile(mapRowToProfile(data as CompanyProfileRow));
    setLoading(false);
  }

  useEffect(() => {
    let mounted = true;

    const isMounted = () =>
      mounted;

    async function init() {
      try {
        if (
          tenantStatus ===
          "loading"
        ) {
          return;
        }

        if (!selectedTenantId) {
          if (mounted) {
            setCompanyId(null);
            setProfile(null);
            setLoading(false);
            setError(
              "No active company selected."
            );
          }

          return;
        }

        if (!mounted) {
          return;
        }

        setCompanyId(
          selectedTenantId
        );

        await loadProfile(
          selectedTenantId,
          isMounted
        );
      }
      catch (error) {
        if (!mounted) {
          return;
        }

        setError(
          error instanceof Error
            ? error.message
            : "Failed to load company profile."
        );

        setLoading(false);
      }
    }

    void init();

    return () => {
      mounted = false;
    };
  }, [
    selectedTenantId,
    tenantStatus,
    supabase,
  ]);

  function updateField<K extends keyof CompanyProfile>(
    key: K,
    value: CompanyProfile[K]
  ) {
    setProfile((current) => {
      if (!current) return current;
      return { ...current, [key]: value };
    });
  }

  function applyCountryDefaults(countryCode: string) {
    setProfile((current) => {
      if (!current) return current;

      if (countryCode === "US") {
        return {
          ...current,
          country_code: "US",
          currency_code: "USD",
          timezone:
            current.timezone && current.timezone !== "Europe/London"
              ? current.timezone
              : "America/New_York",
          language_code: current.language_code || "en",
          legal_entity_type:
            current.country_code === "US" ? current.legal_entity_type : "",
        };
      }

      if (countryCode === "GB") {
        return {
          ...current,
          country_code: "GB",
          currency_code: "GBP",
          timezone:
            current.timezone && current.timezone !== "America/New_York"
              ? current.timezone
              : "Europe/London",
          language_code: current.language_code || "en",
          legal_entity_type:
            current.country_code === "GB" ? current.legal_entity_type : "",
        };
      }

      return {
        ...current,
        country_code: countryCode,
        legal_entity_type:
          current.country_code === countryCode ? current.legal_entity_type : "",
      };
    });
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!companyId || !profile) {
      setError("Company not loaded.");
      return;
    }

    if (!profile.company_name.trim()) {
      setError("Company name is required.");
      return;
    }

    if (!profile.country_code.trim()) {
      setError("Country is required.");
      return;
    }

    if (!profile.legal_entity_type.trim()) {
      setError("Legal entity type is required.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        tenant_id: companyId,
        company_name: profile.company_name.trim(),
        trading_name: profile.trading_name.trim() || null,
        legal_entity_type: profile.legal_entity_type.trim(),
        industry_type: profile.industry_type.trim() || null,
        registration_number: profile.registration_number.trim() || null,
        tax_number: profile.tax_number.trim() || null,
        vat_number: profile.vat_number.trim() || null,
        eori_number: profile.eori_number.trim() || null,
        operator_licence_number:
          profile.operator_licence_number.trim() || null,
        us_ein: profile.us_ein.trim() || null,
        usdot_number: profile.usdot_number.trim() || null,
        mc_number: profile.mc_number.trim() || null,
        ifta_number: profile.ifta_number.trim() || null,
        irp_number: profile.irp_number.trim() || null,
        scac_code: profile.scac_code.trim() || null,
        business_email: profile.business_email.trim() || null,
        business_phone: profile.business_phone.trim() || null,
        website: profile.website.trim() || null,
        address_line_1: profile.address_line_1.trim() || null,
        address_line_2: profile.address_line_2.trim() || null,
        city: profile.city.trim() || null,
        region: profile.region.trim() || null,
        postcode: profile.postcode.trim() || null,
        country_code: profile.country_code.trim(),
        currency_code: profile.currency_code.trim().toUpperCase() || null,
        timezone: profile.timezone.trim() || null,
        language_code: profile.language_code.trim().toLowerCase() || null,
        notes: profile.notes.trim() || null,
      };

      const { data, error } = await supabase
        .from("company_profiles")
        .upsert(payload, { onConflict: "tenant_id" })
        .select()
        .single();

      if (error) {
        setError(error.message);
        return;
      }

      if (data) {
        setProfile(mapRowToProfile(data as CompanyProfileRow));
      }

      setSuccess("Company profile saved.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to save company profile."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ds min-h-screen bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-[1480px] px-6 py-8">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-3">Admin</div>
          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Company Profile
          </h1>
          <p className="m-0 text-sm text-ink-3">
            Edit your company details, tax details, contact information, and
            country-specific compliance settings.
          </p>
        </header>

        {!companyId ? (
          <Card className="font-medium">
            {message || "No authenticated session found. Please sign in again."}
          </Card>
        ) : loading || !profile ? (
          <Card className="font-medium">{message || "Loading..."}</Card>
        ) : (
          <>
          <form onSubmit={saveProfile} className="grid gap-4">
            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-3 mt-0 text-md font-semibold text-ink">
                Company Details
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  id="co-company-name"
                  label="Company Name"
                  value={profile.company_name}
                  onChange={(event) =>
                    updateField("company_name", event.target.value)
                  }
                  required
                />

                <Field
                  id="co-trading-name"
                  label="Trading Name / DBA"
                  value={profile.trading_name}
                  onChange={(event) =>
                    updateField("trading_name", event.target.value)
                  }
                />

                <Select
                  id="co-country"
                  label="Country"
                  value={profile.country_code}
                  onChange={(event) => applyCountryDefaults(event.target.value)}
                >
                  {countryOptions.map((country) => (
                    <option key={country.value} value={country.value}>
                      {country.label}
                    </option>
                  ))}
                </Select>

                <Select
                  id="co-legal-entity-type"
                  label="Legal Entity Type"
                  value={profile.legal_entity_type}
                  onChange={(event) =>
                    updateField("legal_entity_type", event.target.value)
                  }
                  required
                >
                  <option value="">Select entity type</option>
                  {entityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>

                <Select
                  id="co-industry-type"
                  label="Industry Type"
                  value={profile.industry_type}
                  onChange={(event) =>
                    updateField("industry_type", event.target.value)
                  }
                >
                  {industryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>

                <Field
                  id="co-registration-number"
                  label={
                    isUS
                      ? "State Registration Number"
                      : "Business Registration Number"
                  }
                  value={profile.registration_number}
                  onChange={(event) =>
                    updateField("registration_number", event.target.value)
                  }
                />
              </div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-3 mt-0 text-md font-semibold text-ink">
                Contact Details
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  id="co-business-email"
                  label="Business Email"
                  type="email"
                  value={profile.business_email}
                  onChange={(event) =>
                    updateField("business_email", event.target.value)
                  }
                />

                <Field
                  id="co-business-phone"
                  label="Business Phone"
                  value={profile.business_phone}
                  onChange={(event) =>
                    updateField("business_phone", event.target.value)
                  }
                />

                <Field
                  id="co-website"
                  label="Website"
                  value={profile.website}
                  onChange={(event) =>
                    updateField("website", event.target.value)
                  }
                  placeholder="https://example.com"
                />
              </div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-3 mt-0 text-md font-semibold text-ink">
                Address
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  id="co-address-line-1"
                  label="Address Line 1"
                  value={profile.address_line_1}
                  onChange={(event) =>
                    updateField("address_line_1", event.target.value)
                  }
                />

                <Field
                  id="co-address-line-2"
                  label="Address Line 2"
                  value={profile.address_line_2}
                  onChange={(event) =>
                    updateField("address_line_2", event.target.value)
                  }
                />

                <Field
                  id="co-city"
                  label="City"
                  value={profile.city}
                  onChange={(event) =>
                    updateField("city", event.target.value)
                  }
                />

                <Field
                  id="co-region"
                  label={isUS ? "State" : "Region / County / State"}
                  value={profile.region}
                  onChange={(event) =>
                    updateField("region", event.target.value)
                  }
                />

                <Field
                  id="co-postcode"
                  label={isUS ? "ZIP Code" : "Postcode / ZIP"}
                  value={profile.postcode}
                  onChange={(event) =>
                    updateField("postcode", event.target.value)
                  }
                />
              </div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-3 mt-0 text-md font-semibold text-ink">
                Tax & Compliance
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {isUS ? (
                  <Field
                    id="co-us-ein"
                    label="EIN"
                    value={profile.us_ein}
                    onChange={(event) =>
                      updateField("us_ein", event.target.value)
                    }
                  />
                ) : (
                  <Field
                    id="co-tax-number"
                    label="Tax Number"
                    value={profile.tax_number}
                    onChange={(event) =>
                      updateField("tax_number", event.target.value)
                    }
                  />
                )}

                {isGB ? (
                  <>
                    <Field
                      id="co-vat-number"
                      label="VAT Number"
                      value={profile.vat_number}
                      onChange={(event) =>
                        updateField("vat_number", event.target.value)
                      }
                    />

                    <Field
                      id="co-eori-number"
                      label="EORI Number"
                      value={profile.eori_number}
                      onChange={(event) =>
                        updateField("eori_number", event.target.value)
                      }
                    />
                  </>
                ) : null}
              </div>
            </section>

            {isTransportRelated ? (
              <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                <h2 className="mb-3 mt-0 text-md font-semibold text-ink">
                  Transport Authority / Licensing
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {isGB ? (
                    <Field
                      id="co-operator-licence-number"
                      label="Operator Licence Number"
                      value={profile.operator_licence_number}
                      onChange={(event) =>
                        updateField(
                          "operator_licence_number",
                          event.target.value
                        )
                      }
                    />
                  ) : null}

                  {isUS ? (
                    <>
                      <Field
                        id="co-usdot-number"
                        label="USDOT Number"
                        value={profile.usdot_number}
                        onChange={(event) =>
                          updateField("usdot_number", event.target.value)
                        }
                      />

                      <Field
                        id="co-mc-number"
                        label="MC Number"
                        value={profile.mc_number}
                        onChange={(event) =>
                          updateField("mc_number", event.target.value)
                        }
                      />

                      <Field
                        id="co-ifta-number"
                        label="IFTA Number"
                        value={profile.ifta_number}
                        onChange={(event) =>
                          updateField("ifta_number", event.target.value)
                        }
                      />

                      <Field
                        id="co-irp-number"
                        label="IRP Number"
                        value={profile.irp_number}
                        onChange={(event) =>
                          updateField("irp_number", event.target.value)
                        }
                      />

                      <Field
                        id="co-scac-code"
                        label="SCAC Code"
                        value={profile.scac_code}
                        onChange={(event) =>
                          updateField("scac_code", event.target.value)
                        }
                      />
                    </>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-3 mt-0 text-md font-semibold text-ink">
                Regional Settings
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  id="co-currency-code"
                  label="Currency"
                  value={profile.currency_code}
                  onChange={(event) =>
                    updateField("currency_code", event.target.value)
                  }
                  placeholder="GBP / USD / EUR"
                />

                <Field
                  id="co-timezone"
                  label="Timezone"
                  value={profile.timezone}
                  onChange={(event) =>
                    updateField("timezone", event.target.value)
                  }
                  placeholder="Europe/London"
                />

                <Field
                  id="co-language-code"
                  label="Language"
                  value={profile.language_code}
                  onChange={(event) =>
                    updateField("language_code", event.target.value)
                  }
                  placeholder="en"
                />
              </div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-3 mt-0 text-md font-semibold text-ink">
                Notes
              </h2>
              <Textarea
                id="co-notes"
                label="Internal Notes"
                value={profile.notes}
                onChange={(event) =>
                  updateField("notes", event.target.value)
                }
              />
            </section>

            <MessageBanner
              tone={
                messageType === "error"
                  ? "danger"
                  : messageType === "success"
                    ? "success"
                    : "info"
              }
            >
              {message}
            </MessageBanner>

            <div>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Company Profile"}
              </Button>
            </div>
          </form>

          <StripeConnectionPanel
            tenantId={companyId}
          />
        </>
        )}
      </main>
    </div>
  );
}
