"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";

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

  async function resolveCompanyId(): Promise<string | null> {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    console.log("auth user", user);
    console.log("auth error", userError);
    console.log("supabase url", process.env.NEXT_PUBLIC_SUPABASE_URL);

    if (userError || !user) {
      setError(userError?.message || "No authenticated user found.");
      return null;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, company_id")
      .eq("id", user.id)
      .maybeSingle();

    console.log("profiles data", data);
    console.log("profiles error", error);

    if (error) {
      setError(`Profiles query failed: ${error.message}`);
      return null;
    }

    if (!data) {
      setError(`No profile row found for user ${user.id}.`);
      return null;
    }

    if (!data.company_id) {
      setError(`Profile exists but company_id is null for user ${user.id}.`);
      return null;
    }

    return data.company_id;
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

    console.log("company_profiles data", data);
    console.log("company_profiles error", error);

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
    const isMounted = () => mounted;

    async function init() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        console.log("session", session);
        console.log("session error", sessionError);

        const resolvedCompanyId = await resolveCompanyId();

        console.log("resolvedCompanyId", resolvedCompanyId);

        if (!mounted) return;

        if (!resolvedCompanyId) {
          setLoading(false);
          return;
        }

        setCompanyId(resolvedCompanyId);
        await loadProfile(resolvedCompanyId, isMounted);
      } catch (error) {
        if (!mounted) return;
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
  }, [supabase]);

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

      console.log("save payload", payload);

      const { data, error } = await supabase
        .from("company_profiles")
        .upsert(payload, { onConflict: "tenant_id" })
        .select()
        .single();

      console.log("save data", data);
      console.log("save error", error);

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

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    padding: 30,
    backgroundImage:
      "url('https://images.unsplash.com/photo-1553413077-190dd305871c')",
    backgroundSize: "cover",
    backgroundPosition: "center",
  };

  const shellStyle: React.CSSProperties = {
    background: "rgba(0,0,0,0.65)",
    padding: 30,
    borderRadius: 20,
  };

  const cardStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.96)",
    padding: 20,
    borderRadius: 14,
    boxShadow: "0 8px 30px rgba(0,0,0,0.22)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    boxSizing: "border-box",
    fontSize: 14,
    background: "white",
  };

  const labelStyle: React.CSSProperties = {
    display: "grid",
    gap: 8,
    fontWeight: 600,
    fontSize: 14,
  };

  const sectionTitleStyle: React.CSSProperties = {
    marginTop: 0,
    marginBottom: 14,
  };

  const buttonStyle: React.CSSProperties = {
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    cursor: "pointer",
    fontWeight: 700,
  };

  const messageCardStyle: React.CSSProperties = {
    ...cardStyle,
    padding: 14,
    fontWeight: 600,
    border:
      messageType === "error"
        ? "1px solid #fca5a5"
        : messageType === "success"
          ? "1px solid #86efac"
          : "1px solid transparent",
    color:
      messageType === "error"
        ? "#991b1b"
        : messageType === "success"
          ? "#166534"
          : "inherit",
  };

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <div style={{ color: "white", marginBottom: 20 }}>
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Company Profile</h1>
          <p style={{ margin: 0, opacity: 0.9 }}>
            Edit your company details, tax details, contact information, and
            country-specific compliance settings.
          </p>
        </div>

        {!companyId ? (
          <div style={{ ...cardStyle, fontWeight: 600 }}>
            {message || "No authenticated session found. Please sign in again."}
          </div>
        ) : loading || !profile ? (
          <div style={{ ...cardStyle, fontWeight: 600 }}>
            {message || "Loading..."}
          </div>
        ) : (
          <form onSubmit={saveProfile} style={{ display: "grid", gap: 20 }}>
            <section style={cardStyle}>
              <h2 style={sectionTitleStyle}>Company Details</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 14,
                }}
              >
                <label style={labelStyle}>
                  Company Name
                  <input
                    value={profile.company_name}
                    onChange={(event) =>
                      updateField("company_name", event.target.value)
                    }
                    style={inputStyle}
                    required
                  />
                </label>

                <label style={labelStyle}>
                  Trading Name / DBA
                  <input
                    value={profile.trading_name}
                    onChange={(event) =>
                      updateField("trading_name", event.target.value)
                    }
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  Country
                  <select
                    value={profile.country_code}
                    onChange={(event) => applyCountryDefaults(event.target.value)}
                    style={inputStyle}
                  >
                    {countryOptions.map((country) => (
                      <option key={country.value} value={country.value}>
                        {country.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={labelStyle}>
                  Legal Entity Type
                  <select
                    value={profile.legal_entity_type}
                    onChange={(event) =>
                      updateField("legal_entity_type", event.target.value)
                    }
                    style={inputStyle}
                    required
                  >
                    <option value="">Select entity type</option>
                    {entityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={labelStyle}>
                  Industry Type
                  <select
                    value={profile.industry_type}
                    onChange={(event) =>
                      updateField("industry_type", event.target.value)
                    }
                    style={inputStyle}
                  >
                    {industryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={labelStyle}>
                  {isUS
                    ? "State Registration Number"
                    : "Business Registration Number"}
                  <input
                    value={profile.registration_number}
                    onChange={(event) =>
                      updateField("registration_number", event.target.value)
                    }
                    style={inputStyle}
                  />
                </label>
              </div>
            </section>

            <section style={cardStyle}>
              <h2 style={sectionTitleStyle}>Contact Details</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 14,
                }}
              >
                <label style={labelStyle}>
                  Business Email
                  <input
                    type="email"
                    value={profile.business_email}
                    onChange={(event) =>
                      updateField("business_email", event.target.value)
                    }
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  Business Phone
                  <input
                    value={profile.business_phone}
                    onChange={(event) =>
                      updateField("business_phone", event.target.value)
                    }
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  Website
                  <input
                    value={profile.website}
                    onChange={(event) =>
                      updateField("website", event.target.value)
                    }
                    style={inputStyle}
                    placeholder="https://example.com"
                  />
                </label>
              </div>
            </section>

            <section style={cardStyle}>
              <h2 style={sectionTitleStyle}>Address</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 14,
                }}
              >
                <label style={labelStyle}>
                  Address Line 1
                  <input
                    value={profile.address_line_1}
                    onChange={(event) =>
                      updateField("address_line_1", event.target.value)
                    }
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  Address Line 2
                  <input
                    value={profile.address_line_2}
                    onChange={(event) =>
                      updateField("address_line_2", event.target.value)
                    }
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  City
                  <input
                    value={profile.city}
                    onChange={(event) =>
                      updateField("city", event.target.value)
                    }
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  {isUS ? "State" : "Region / County / State"}
                  <input
                    value={profile.region}
                    onChange={(event) =>
                      updateField("region", event.target.value)
                    }
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  {isUS ? "ZIP Code" : "Postcode / ZIP"}
                  <input
                    value={profile.postcode}
                    onChange={(event) =>
                      updateField("postcode", event.target.value)
                    }
                    style={inputStyle}
                  />
                </label>
              </div>
            </section>

            <section style={cardStyle}>
              <h2 style={sectionTitleStyle}>Tax & Compliance</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 14,
                }}
              >
                {isUS ? (
                  <label style={labelStyle}>
                    EIN
                    <input
                      value={profile.us_ein}
                      onChange={(event) =>
                        updateField("us_ein", event.target.value)
                      }
                      style={inputStyle}
                    />
                  </label>
                ) : (
                  <label style={labelStyle}>
                    Tax Number
                    <input
                      value={profile.tax_number}
                      onChange={(event) =>
                        updateField("tax_number", event.target.value)
                      }
                      style={inputStyle}
                    />
                  </label>
                )}

                {isGB ? (
                  <>
                    <label style={labelStyle}>
                      VAT Number
                      <input
                        value={profile.vat_number}
                        onChange={(event) =>
                          updateField("vat_number", event.target.value)
                        }
                        style={inputStyle}
                      />
                    </label>

                    <label style={labelStyle}>
                      EORI Number
                      <input
                        value={profile.eori_number}
                        onChange={(event) =>
                          updateField("eori_number", event.target.value)
                        }
                        style={inputStyle}
                      />
                    </label>
                  </>
                ) : null}
              </div>
            </section>

            {isTransportRelated ? (
              <section style={cardStyle}>
                <h2 style={sectionTitleStyle}>
                  Transport Authority / Licensing
                </h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: 14,
                  }}
                >
                  {isGB ? (
                    <label style={labelStyle}>
                      Operator Licence Number
                      <input
                        value={profile.operator_licence_number}
                        onChange={(event) =>
                          updateField(
                            "operator_licence_number",
                            event.target.value
                          )
                        }
                        style={inputStyle}
                      />
                    </label>
                  ) : null}

                  {isUS ? (
                    <>
                      <label style={labelStyle}>
                        USDOT Number
                        <input
                          value={profile.usdot_number}
                          onChange={(event) =>
                            updateField("usdot_number", event.target.value)
                          }
                          style={inputStyle}
                        />
                      </label>

                      <label style={labelStyle}>
                        MC Number
                        <input
                          value={profile.mc_number}
                          onChange={(event) =>
                            updateField("mc_number", event.target.value)
                          }
                          style={inputStyle}
                        />
                      </label>

                      <label style={labelStyle}>
                        IFTA Number
                        <input
                          value={profile.ifta_number}
                          onChange={(event) =>
                            updateField("ifta_number", event.target.value)
                          }
                          style={inputStyle}
                        />
                      </label>

                      <label style={labelStyle}>
                        IRP Number
                        <input
                          value={profile.irp_number}
                          onChange={(event) =>
                            updateField("irp_number", event.target.value)
                          }
                          style={inputStyle}
                        />
                      </label>

                      <label style={labelStyle}>
                        SCAC Code
                        <input
                          value={profile.scac_code}
                          onChange={(event) =>
                            updateField("scac_code", event.target.value)
                          }
                          style={inputStyle}
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section style={cardStyle}>
              <h2 style={sectionTitleStyle}>Regional Settings</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 14,
                }}
              >
                <label style={labelStyle}>
                  Currency
                  <input
                    value={profile.currency_code}
                    onChange={(event) =>
                      updateField("currency_code", event.target.value)
                    }
                    style={inputStyle}
                    placeholder="GBP / USD / EUR"
                  />
                </label>

                <label style={labelStyle}>
                  Timezone
                  <input
                    value={profile.timezone}
                    onChange={(event) =>
                      updateField("timezone", event.target.value)
                    }
                    style={inputStyle}
                    placeholder="Europe/London"
                  />
                </label>

                <label style={labelStyle}>
                  Language
                  <input
                    value={profile.language_code}
                    onChange={(event) =>
                      updateField("language_code", event.target.value)
                    }
                    style={inputStyle}
                    placeholder="en"
                  />
                </label>
              </div>
            </section>

            <section style={cardStyle}>
              <h2 style={sectionTitleStyle}>Notes</h2>
              <label style={labelStyle}>
                Internal Notes
                <textarea
                  value={profile.notes}
                  onChange={(event) =>
                    updateField("notes", event.target.value)
                  }
                  style={{
                    ...inputStyle,
                    minHeight: 120,
                    resize: "vertical",
                  }}
                />
              </label>
            </section>

            {message ? <div style={messageCardStyle}>{message}</div> : null}

            <div>
              <button
                type="submit"
                disabled={saving}
                style={{
                  ...buttonStyle,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.8 : 1,
                }}
              >
                {saving ? "Saving..." : "Save Company Profile"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
