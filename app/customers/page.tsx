"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";

type Customer = {
  id: string;
  name: string;
  legal_name: string | null;
  trading_name: string | null;
  account_code: string | null;
  company_number: string | null;
  vat_number: string | null;
  eori_number: string | null;
  website: string | null;
  industry_type: string | null;
  active: boolean;
  contact_name: string | null;
  job_title: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  accounts_email: string | null;
  operations_email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county_region: string | null;
  postcode: string | null;
  country_code: string | null;
  payment_terms_days: number | null;
  credit_limit: number | null;
  credit_status: string | null;
  currency_code: string | null;
  requires_po: boolean;
  default_po_reference: string | null;
  fuel_surcharge_percent: number | null;
  vat_rate: number | null;
  default_collection_instructions: string | null;
  default_delivery_instructions: string | null;
  default_vehicle_type: string | null;
  tail_lift_required: boolean;
  adr_required: boolean;
  temperature_control_required: boolean;
  timed_delivery_required: boolean;
  pod_required: boolean;
  invoice_pod_attachment_required: boolean;
  pallet_exchange_required: boolean;
  weekend_delivery_allowed: boolean;
  booking_reference_required: boolean;
  default_depot: string | null;
  default_contact_method: string | null;
  account_manager: string | null;
  service_level: string | null;
  customer_status: string | null;
  credit_hold: boolean;
  out_of_hours_contact: string | null;
  external_customer_id: string | null;
  accounting_customer_id: string | null;
  crm_customer_id: string | null;
  api_enabled: boolean;
  webhook_url: string | null;
  notes: string | null;
};

type CustomerForm = {
  name: string;
  legal_name: string;
  trading_name: string;
  account_code: string;
  company_number: string;
  vat_number: string;
  eori_number: string;
  website: string;
  industry_type: string;
  active: boolean;
  contact_name: string;
  job_title: string;
  phone: string;
  mobile: string;
  email: string;
  accounts_email: string;
  operations_email: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  county_region: string;
  postcode: string;
  country_code: string;
  payment_terms_days: string;
  credit_limit: string;
  credit_status: string;
  currency_code: string;
  requires_po: boolean;
  default_po_reference: string;
  fuel_surcharge_percent: string;
  vat_rate: string;
  default_collection_instructions: string;
  default_delivery_instructions: string;
  default_vehicle_type: string;
  tail_lift_required: boolean;
  adr_required: boolean;
  temperature_control_required: boolean;
  timed_delivery_required: boolean;
  pod_required: boolean;
  invoice_pod_attachment_required: boolean;
  pallet_exchange_required: boolean;
  weekend_delivery_allowed: boolean;
  booking_reference_required: boolean;
  default_depot: string;
  default_contact_method: string;
  account_manager: string;
  service_level: string;
  customer_status: string;
  credit_hold: boolean;
  out_of_hours_contact: string;
  external_customer_id: string;
  accounting_customer_id: string;
  crm_customer_id: string;
  api_enabled: boolean;
  webhook_url: string;
  notes: string;
};

const EMPTY_FORM: CustomerForm = {
  name: "",
  legal_name: "",
  trading_name: "",
  account_code: "",
  company_number: "",
  vat_number: "",
  eori_number: "",
  website: "",
  industry_type: "",
  active: true,
  contact_name: "",
  job_title: "",
  phone: "",
  mobile: "",
  email: "",
  accounts_email: "",
  operations_email: "",
  address_line_1: "",
  address_line_2: "",
  city: "",
  county_region: "",
  postcode: "",
  country_code: "GB",
  payment_terms_days: "30",
  credit_limit: "",
  credit_status: "ok",
  currency_code: "GBP",
  requires_po: false,
  default_po_reference: "",
  fuel_surcharge_percent: "",
  vat_rate: "20",
  default_collection_instructions: "",
  default_delivery_instructions: "",
  default_vehicle_type: "",
  tail_lift_required: false,
  adr_required: false,
  temperature_control_required: false,
  timed_delivery_required: false,
  pod_required: true,
  invoice_pod_attachment_required: false,
  pallet_exchange_required: false,
  weekend_delivery_allowed: false,
  booking_reference_required: false,
  default_depot: "",
  default_contact_method: "email",
  account_manager: "",
  service_level: "",
  customer_status: "active",
  credit_hold: false,
  out_of_hours_contact: "",
  external_customer_id: "",
  accounting_customer_id: "",
  crm_customer_id: "",
  api_enabled: false,
  webhook_url: "",
  notes: "",
};

export default function CustomersPage() {
  const tenant = useTenant();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const headers = useMemo(() => {
    const result: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (tenant.activeTenantId) {
      result["x-tenant-id"] = tenant.activeTenantId;
    }

    return result;
  }, [tenant.activeTenantId]);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams();

      if (search.trim()) {
        params.set("search", search.trim());
      }

      const response = await fetch(
        `/api/customers${params.toString() ? `?${params}` : ""}`,
        {
          headers,
          cache: "no-store",
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Unable to load customers");
      }

      setCustomers(body.customers ?? []);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to load customers"
      );
    } finally {
      setLoading(false);
    }
  }, [headers, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCustomers();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [loadCustomers]);

  function updateForm<K extends keyof CustomerForm>(
    field: K,
    value: CustomerForm[K]
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  function startEdit(customer: Customer) {
    setEditingId(customer.id);
    setShowForm(true);

    setForm({
      name: customer.name ?? "",
      legal_name: customer.legal_name ?? "",
      trading_name: customer.trading_name ?? "",
      account_code: customer.account_code ?? "",
      company_number: customer.company_number ?? "",
      vat_number: customer.vat_number ?? "",
      eori_number: customer.eori_number ?? "",
      website: customer.website ?? "",
      industry_type: customer.industry_type ?? "",
      active: customer.active ?? true,
      contact_name: customer.contact_name ?? "",
      job_title: customer.job_title ?? "",
      phone: customer.phone ?? "",
      mobile: customer.mobile ?? "",
      email: customer.email ?? "",
      accounts_email: customer.accounts_email ?? "",
      operations_email: customer.operations_email ?? "",
      address_line_1: customer.address_line_1 ?? "",
      address_line_2: customer.address_line_2 ?? "",
      city: customer.city ?? "",
      county_region: customer.county_region ?? "",
      postcode: customer.postcode ?? "",
      country_code: customer.country_code ?? "GB",
      payment_terms_days: String(customer.payment_terms_days ?? 30),
      credit_limit:
        customer.credit_limit === null ? "" : String(customer.credit_limit),
      credit_status: customer.credit_status ?? "ok",
      currency_code: customer.currency_code ?? "GBP",
      requires_po: customer.requires_po ?? false,
      default_po_reference: customer.default_po_reference ?? "",
      fuel_surcharge_percent:
        customer.fuel_surcharge_percent === null
          ? ""
          : String(customer.fuel_surcharge_percent),
      vat_rate: String(customer.vat_rate ?? 20),
      default_collection_instructions:
        customer.default_collection_instructions ?? "",
      default_delivery_instructions:
        customer.default_delivery_instructions ?? "",
      default_vehicle_type: customer.default_vehicle_type ?? "",
      tail_lift_required: customer.tail_lift_required ?? false,
      adr_required: customer.adr_required ?? false,
      temperature_control_required:
        customer.temperature_control_required ?? false,
      timed_delivery_required: customer.timed_delivery_required ?? false,
      pod_required: customer.pod_required ?? true,
      invoice_pod_attachment_required:
        customer.invoice_pod_attachment_required ?? false,
      pallet_exchange_required: customer.pallet_exchange_required ?? false,
      weekend_delivery_allowed: customer.weekend_delivery_allowed ?? false,
      booking_reference_required:
        customer.booking_reference_required ?? false,
      default_depot: customer.default_depot ?? "",
      default_contact_method: customer.default_contact_method ?? "email",
      account_manager: customer.account_manager ?? "",
      service_level: customer.service_level ?? "",
      customer_status: customer.customer_status ?? "active",
      credit_hold: customer.credit_hold ?? false,
      out_of_hours_contact: customer.out_of_hours_contact ?? "",
      external_customer_id: customer.external_customer_id ?? "",
      accounting_customer_id: customer.accounting_customer_id ?? "",
      crm_customer_id: customer.crm_customer_id ?? "",
      api_enabled: customer.api_enabled ?? false,
      webhook_url: customer.webhook_url ?? "",
      notes: customer.notes ?? "",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim()) {
      setErrorMessage("Customer name is required");
      return;
    }

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    const payload = {
      ...form,
      name: form.name.trim(),
      postcode: form.postcode.trim().toUpperCase() || null,
      payment_terms_days: Number(form.payment_terms_days || 30),
      credit_limit:
        form.credit_limit.trim() === "" ? null : Number(form.credit_limit),
      fuel_surcharge_percent:
        form.fuel_surcharge_percent.trim() === ""
          ? null
          : Number(form.fuel_surcharge_percent),
      vat_rate: Number(form.vat_rate || 20),
    };

    try {
      const response = await fetch(
        editingId ? `/api/customers/${editingId}` : "/api/customers",
        {
          method: editingId ? "PATCH" : "POST",
          headers,
          body: JSON.stringify(payload),
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Unable to save customer");
      }

      setMessage(editingId ? "Customer updated" : "Customer created");
      resetForm();
      await loadCustomers();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to save customer"
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteCustomer(customer: Customer) {
    if (
      !window.confirm(
        `Delete ${customer.name}? This will also remove linked customer contacts, sites, rates and integration records.`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/customers/${customer.id}`, {
        method: "DELETE",
        headers,
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Unable to delete customer");
      }

      setMessage("Customer deleted");
      await loadCustomers();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to delete customer"
      );
    }
  }

  return (
    <TenantGate>
      <main style={styles.page}>
        <div style={styles.container}>
          <header style={styles.header}>
            <div>
              <p style={styles.eyebrow}>Commercial</p>
              <h1 style={styles.title}>Customers</h1>
              <p style={styles.subtitle}>
                Customer accounts, contacts, billing, transport requirements,
                credit controls and API references.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              style={styles.primaryButton}
            >
              + Add Customer
            </button>
          </header>

          {errorMessage ? (
            <div style={styles.error}>{errorMessage}</div>
          ) : null}

          {message ? <div style={styles.success}>{message}</div> : null}

          {showForm ? (
            <form onSubmit={saveCustomer} style={styles.card}>
              <div style={styles.sectionHeader}>
                <h2 style={styles.sectionTitle}>
                  {editingId ? "Edit Customer" : "New Customer"}
                </h2>

                <button
                  type="button"
                  onClick={resetForm}
                  style={styles.secondaryButton}
                >
                  Cancel
                </button>
              </div>

              <Section title="Company">
                <div style={styles.grid}>
                  <TextField
                    label="Customer / Display Name"
                    value={form.name}
                    onChange={(value) => updateForm("name", value)}
                    required
                  />
                  <TextField
                    label="Legal Name"
                    value={form.legal_name}
                    onChange={(value) => updateForm("legal_name", value)}
                  />
                  <TextField
                    label="Trading Name"
                    value={form.trading_name}
                    onChange={(value) => updateForm("trading_name", value)}
                  />
                  <TextField
                    label="Account Code"
                    value={form.account_code}
                    onChange={(value) => updateForm("account_code", value)}
                  />
                  <TextField
                    label="Company Number"
                    value={form.company_number}
                    onChange={(value) => updateForm("company_number", value)}
                  />
                  <TextField
                    label="VAT Number"
                    value={form.vat_number}
                    onChange={(value) => updateForm("vat_number", value)}
                  />
                  <TextField
                    label="EORI Number"
                    value={form.eori_number}
                    onChange={(value) => updateForm("eori_number", value)}
                  />
                  <TextField
                    label="Website"
                    value={form.website}
                    onChange={(value) => updateForm("website", value)}
                  />
                </div>
              </Section>

              <Section title="Primary Contacts">
                <div style={styles.grid}>
                  <TextField
                    label="Contact Name"
                    value={form.contact_name}
                    onChange={(value) => updateForm("contact_name", value)}
                  />
                  <TextField
                    label="Job Title"
                    value={form.job_title}
                    onChange={(value) => updateForm("job_title", value)}
                  />
                  <TextField
                    label="Phone"
                    value={form.phone}
                    onChange={(value) => updateForm("phone", value)}
                  />
                  <TextField
                    label="Mobile"
                    value={form.mobile}
                    onChange={(value) => updateForm("mobile", value)}
                  />
                  <TextField
                    label="General Email"
                    value={form.email}
                    onChange={(value) => updateForm("email", value)}
                    type="email"
                  />
                  <TextField
                    label="Accounts Email"
                    value={form.accounts_email}
                    onChange={(value) => updateForm("accounts_email", value)}
                    type="email"
                  />
                  <TextField
                    label="Operations Email"
                    value={form.operations_email}
                    onChange={(value) => updateForm("operations_email", value)}
                    type="email"
                  />
                  <TextField
                    label="Out of Hours Contact"
                    value={form.out_of_hours_contact}
                    onChange={(value) =>
                      updateForm("out_of_hours_contact", value)
                    }
                  />
                </div>
              </Section>

              <Section title="Address">
                <div style={styles.grid}>
                  <TextField
                    label="Address Line 1"
                    value={form.address_line_1}
                    onChange={(value) => updateForm("address_line_1", value)}
                  />
                  <TextField
                    label="Address Line 2"
                    value={form.address_line_2}
                    onChange={(value) => updateForm("address_line_2", value)}
                  />
                  <TextField
                    label="City"
                    value={form.city}
                    onChange={(value) => updateForm("city", value)}
                  />
                  <TextField
                    label="County / Region"
                    value={form.county_region}
                    onChange={(value) => updateForm("county_region", value)}
                  />
                  <TextField
                    label="Postcode"
                    value={form.postcode}
                    onChange={(value) =>
                      updateForm("postcode", value.toUpperCase())
                    }
                  />
                  <TextField
                    label="Country Code"
                    value={form.country_code}
                    onChange={(value) => updateForm("country_code", value)}
                  />
                </div>
              </Section>

              <Section title="Billing & Credit">
                <div style={styles.grid}>
                  <TextField
                    label="Payment Terms (days)"
                    value={form.payment_terms_days}
                    onChange={(value) =>
                      updateForm("payment_terms_days", value)
                    }
                    type="number"
                  />
                  <TextField
                    label="Credit Limit"
                    value={form.credit_limit}
                    onChange={(value) => updateForm("credit_limit", value)}
                    type="number"
                  />
                  <SelectField
                    label="Credit Status"
                    value={form.credit_status}
                    onChange={(value) => updateForm("credit_status", value)}
                    options={[
                      ["ok", "OK"],
                      ["review", "Review"],
                      ["hold", "On Hold"],
                      ["blocked", "Blocked"],
                    ]}
                  />
                  <TextField
                    label="Currency"
                    value={form.currency_code}
                    onChange={(value) => updateForm("currency_code", value)}
                  />
                  <TextField
                    label="Fuel Surcharge %"
                    value={form.fuel_surcharge_percent}
                    onChange={(value) =>
                      updateForm("fuel_surcharge_percent", value)
                    }
                    type="number"
                  />
                  <TextField
                    label="VAT Rate %"
                    value={form.vat_rate}
                    onChange={(value) => updateForm("vat_rate", value)}
                    type="number"
                  />
                  <TextField
                    label="Default PO Reference"
                    value={form.default_po_reference}
                    onChange={(value) =>
                      updateForm("default_po_reference", value)
                    }
                  />
                </div>

                <div style={styles.checkboxGrid}>
                  <CheckboxField
                    label="PO required"
                    checked={form.requires_po}
                    onChange={(value) => updateForm("requires_po", value)}
                  />
                  <CheckboxField
                    label="Credit hold"
                    checked={form.credit_hold}
                    onChange={(value) => updateForm("credit_hold", value)}
                  />
                </div>
              </Section>

              <Section title="Transport Requirements">
                <div style={styles.grid}>
                  <TextField
                    label="Default Vehicle Type"
                    value={form.default_vehicle_type}
                    onChange={(value) =>
                      updateForm("default_vehicle_type", value)
                    }
                  />
                  <TextField
                    label="Default Depot"
                    value={form.default_depot}
                    onChange={(value) => updateForm("default_depot", value)}
                  />
                  <TextField
                    label="Service Level"
                    value={form.service_level}
                    onChange={(value) => updateForm("service_level", value)}
                  />
                  <TextField
                    label="Account Manager"
                    value={form.account_manager}
                    onChange={(value) => updateForm("account_manager", value)}
                  />
                </div>

                <div style={styles.checkboxGrid}>
                  <CheckboxField
                    label="ADR required"
                    checked={form.adr_required}
                    onChange={(value) => updateForm("adr_required", value)}
                  />
                  <CheckboxField
                    label="Tail lift required"
                    checked={form.tail_lift_required}
                    onChange={(value) =>
                      updateForm("tail_lift_required", value)
                    }
                  />
                  <CheckboxField
                    label="Temperature controlled"
                    checked={form.temperature_control_required}
                    onChange={(value) =>
                      updateForm("temperature_control_required", value)
                    }
                  />
                  <CheckboxField
                    label="Timed delivery"
                    checked={form.timed_delivery_required}
                    onChange={(value) =>
                      updateForm("timed_delivery_required", value)
                    }
                  />
                  <CheckboxField
                    label="POD required"
                    checked={form.pod_required}
                    onChange={(value) => updateForm("pod_required", value)}
                  />
                  <CheckboxField
                    label="Attach POD to invoice"
                    checked={form.invoice_pod_attachment_required}
                    onChange={(value) =>
                      updateForm("invoice_pod_attachment_required", value)
                    }
                  />
                  <CheckboxField
                    label="Pallet exchange"
                    checked={form.pallet_exchange_required}
                    onChange={(value) =>
                      updateForm("pallet_exchange_required", value)
                    }
                  />
                  <CheckboxField
                    label="Weekend delivery allowed"
                    checked={form.weekend_delivery_allowed}
                    onChange={(value) =>
                      updateForm("weekend_delivery_allowed", value)
                    }
                  />
                  <CheckboxField
                    label="Booking reference required"
                    checked={form.booking_reference_required}
                    onChange={(value) =>
                      updateForm("booking_reference_required", value)
                    }
                  />
                </div>

                <TextareaField
                  label="Default Collection Instructions"
                  value={form.default_collection_instructions}
                  onChange={(value) =>
                    updateForm("default_collection_instructions", value)
                  }
                />

                <TextareaField
                  label="Default Delivery Instructions"
                  value={form.default_delivery_instructions}
                  onChange={(value) =>
                    updateForm("default_delivery_instructions", value)
                  }
                />
              </Section>

              <Section title="API / External References">
                <div style={styles.grid}>
                  <TextField
                    label="External Customer ID"
                    value={form.external_customer_id}
                    onChange={(value) =>
                      updateForm("external_customer_id", value)
                    }
                  />
                  <TextField
                    label="Accounts System ID"
                    value={form.accounting_customer_id}
                    onChange={(value) =>
                      updateForm("accounting_customer_id", value)
                    }
                  />
                  <TextField
                    label="CRM ID"
                    value={form.crm_customer_id}
                    onChange={(value) => updateForm("crm_customer_id", value)}
                  />
                  <TextField
                    label="Webhook URL"
                    value={form.webhook_url}
                    onChange={(value) => updateForm("webhook_url", value)}
                  />
                </div>

                <CheckboxField
                  label="API enabled for this customer"
                  checked={form.api_enabled}
                  onChange={(value) => updateForm("api_enabled", value)}
                />
              </Section>

              <Section title="Notes">
                <TextareaField
                  label="Internal Notes"
                  value={form.notes}
                  onChange={(value) => updateForm("notes", value)}
                />
              </Section>

              <button
                type="submit"
                disabled={saving}
                style={{
                  ...styles.primaryButton,
                  opacity: saving ? 0.65 : 1,
                }}
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update Customer"
                    : "Create Customer"}
              </button>
            </form>
          ) : null}

          <section style={styles.card}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Customer Accounts</h2>
                <p style={styles.muted}>
                  {customers.length} customer{customers.length === 1 ? "" : "s"}
                </p>
              </div>

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, account code or postcode..."
                style={styles.search}
              />
            </div>

            {loading ? (
              <div style={styles.empty}>Loading customers...</div>
            ) : customers.length === 0 ? (
              <div style={styles.empty}>No customers found.</div>
            ) : (
              <div style={styles.customerGrid}>
                {customers.map((customer) => (
                  <article key={customer.id} style={styles.customerCard}>
                    <div style={styles.customerHeader}>
                      <div>
                        <h3 style={styles.customerName}>{customer.name}</h3>
                        <span style={styles.muted}>
                          {customer.account_code || "No account code"}
                        </span>
                      </div>

                      <span
                        style={
                          customer.credit_hold
                            ? styles.holdBadge
                            : customer.active
                              ? styles.activeBadge
                              : styles.inactiveBadge
                        }
                      >
                        {customer.credit_hold
                          ? "Credit Hold"
                          : customer.active
                            ? "Active"
                            : "Inactive"}
                      </span>
                    </div>

                    <div style={styles.infoGrid}>
                      <Info
                        label="Contact"
                        value={customer.contact_name || customer.email}
                      />
                      <Info label="Phone" value={customer.phone} />
                      <Info
                        label="Location"
                        value={
                          [customer.city, customer.postcode]
                            .filter(Boolean)
                            .join(", ") || null
                        }
                      />
                      <Info
                        label="Terms"
                        value={`${customer.payment_terms_days ?? 30} days`}
                      />
                      <Info
                        label="Credit Limit"
                        value={
                          customer.credit_limit === null
                            ? "—"
                            : `£${Number(customer.credit_limit).toLocaleString(
                                "en-GB",
                                { minimumFractionDigits: 2 }
                              )}`
                        }
                      />
                      <Info
                        label="Service"
                        value={customer.service_level || "Standard"}
                      />
                    </div>

                    <div style={styles.tagRow}>
                      {customer.adr_required ? (
                        <span style={styles.tag}>ADR</span>
                      ) : null}
                      {customer.tail_lift_required ? (
                        <span style={styles.tag}>Tail Lift</span>
                      ) : null}
                      {customer.timed_delivery_required ? (
                        <span style={styles.tag}>Timed</span>
                      ) : null}
                      {customer.pod_required ? (
                        <span style={styles.tag}>POD</span>
                      ) : null}
                      {customer.api_enabled ? (
                        <span style={styles.apiTag}>API</span>
                      ) : null}
                    </div>

                    <div style={styles.actions}>
                      <button
                        type="button"
                        onClick={() => startEdit(customer)}
                        style={styles.secondaryButton}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => void deleteCustomer(customer)}
                        style={styles.deleteButton}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </TenantGate>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={styles.section}>
      <h3 style={styles.subheading}>{title}</h3>
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={styles.input}
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <textarea
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ ...styles.input, resize: "vertical" }}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={styles.input}
      >
        {options.map(([valueOption, labelOption]) => (
          <option key={valueOption} value={valueOption}>
            {labelOption}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={styles.checkbox}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <span style={styles.smallLabel}>{label}</span>
      <strong style={styles.infoValue}>{value || "—"}</strong>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "32px 20px 60px",
    background: "#f8fafc",
    color: "#0f172a",
  },
  container: {
    maxWidth: 1450,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 20,
    flexWrap: "wrap",
    marginBottom: 24,
  },
  eyebrow: {
    margin: "0 0 6px",
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  title: {
    margin: 0,
    fontSize: "clamp(34px, 5vw, 48px)",
    letterSpacing: "-0.04em",
  },
  subtitle: {
    maxWidth: 760,
    margin: "8px 0 0",
    color: "#64748b",
    lineHeight: 1.6,
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 22,
    marginBottom: 22,
    boxShadow: "0 8px 28px rgba(15,23,42,0.06)",
  },
  section: {
    borderTop: "1px solid #e2e8f0",
    paddingTop: 18,
    marginTop: 18,
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  },
  sectionTitle: {
    margin: 0,
    fontSize: 22,
  },
  subheading: {
    margin: "0 0 14px",
    fontSize: 17,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 14,
    marginBottom: 14,
  },
  checkboxGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 8,
    margin: "12px 0",
  },
  field: {
    display: "grid",
    gap: 6,
  },
  label: {
    color: "#334155",
    fontSize: 12,
    fontWeight: 800,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "11px 12px",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: 14,
  },
  checkbox: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: 10,
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    background: "#f8fafc",
    fontSize: 13,
    fontWeight: 700,
  },
  primaryButton: {
    border: "none",
    borderRadius: 10,
    background: "#2563eb",
    color: "#ffffff",
    padding: "12px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    background: "#ffffff",
    color: "#0f172a",
    padding: "9px 12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  deleteButton: {
    border: "1px solid #fecaca",
    borderRadius: 9,
    background: "#fef2f2",
    color: "#b91c1c",
    padding: "9px 12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  search: {
    width: 320,
    maxWidth: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "10px 12px",
  },
  customerGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
    gap: 14,
    marginTop: 18,
  },
  customerCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 17,
    background: "#f8fafc",
  },
  customerHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  customerName: {
    margin: 0,
    fontSize: 20,
  },
  muted: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: 12,
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0,1fr))",
    gap: 12,
    margin: "18px 0",
  },
  smallLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  infoValue: {
    display: "block",
    marginTop: 4,
    fontSize: 13,
  },
  tagRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 16,
  },
  tag: {
    borderRadius: 999,
    padding: "5px 8px",
    background: "#e2e8f0",
    color: "#334155",
    fontSize: 11,
    fontWeight: 800,
  },
  apiTag: {
    borderRadius: 999,
    padding: "5px 8px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontSize: 11,
    fontWeight: 800,
  },
  activeBadge: {
    borderRadius: 999,
    padding: "5px 8px",
    background: "#dcfce7",
    color: "#166534",
    fontSize: 11,
    fontWeight: 800,
  },
  inactiveBadge: {
    borderRadius: 999,
    padding: "5px 8px",
    background: "#e2e8f0",
    color: "#475569",
    fontSize: 11,
    fontWeight: 800,
  },
  holdBadge: {
    borderRadius: 999,
    padding: "5px 8px",
    background: "#fee2e2",
    color: "#991b1b",
    fontSize: 11,
    fontWeight: 800,
  },
  actions: {
    display: "flex",
    gap: 8,
  },
  success: {
    marginBottom: 18,
    padding: 12,
    borderRadius: 10,
    background: "#dcfce7",
    color: "#166534",
  },
  error: {
    marginBottom: 18,
    padding: 12,
    borderRadius: 10,
    background: "#fee2e2",
    color: "#991b1b",
  },
  empty: {
    padding: 40,
    textAlign: "center",
    color: "#64748b",
  },
};
