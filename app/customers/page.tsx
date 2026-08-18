"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import MessageBanner from "../../components/MessageBanner";

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
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1450px] px-6 py-8">
          <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-kicker uppercase text-ink-3">Commercial</div>
              <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                Customers
              </h1>
              <p className="m-0 text-sm text-ink-3">
                Customer accounts, contacts, billing, transport requirements,
                credit controls and API references.
              </p>
            </div>

            <Button
              type="button"
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
            >
              + Add Customer
            </Button>
          </header>

          <MessageBanner tone="danger">{errorMessage}</MessageBanner>

          <MessageBanner tone="success">{message}</MessageBanner>

          {showForm ? (
            <form
              onSubmit={saveCustomer}
              className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="m-0 text-md font-semibold text-ink">
                  {editingId ? "Edit Customer" : "New Customer"}
                </h2>

                <Button variant="secondary" type="button" onClick={resetForm}>
                  Cancel
                </Button>
              </div>

              <Section title="Company">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

              <Button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update Customer"
                    : "Create Customer"}
              </Button>
            </form>
          ) : null}

          <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="m-0 text-md font-semibold text-ink">
                  Customer Accounts
                </h2>
                <p className="m-0 text-sm text-ink-3">
                  {customers.length} customer{customers.length === 1 ? "" : "s"}
                </p>
              </div>

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, account code or postcode..."
                className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3 sm:w-64"
              />
            </div>

            {loading ? (
              <p className="text-sm text-ink-3">Loading customers...</p>
            ) : customers.length === 0 ? (
              <p className="text-sm text-ink-3">No customers found.</p>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {customers.map((customer) => (
                  <article
                    key={customer.id}
                    className="rounded-lg border border-line bg-surface-2 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="m-0 text-md font-semibold text-ink">
                          {customer.name}
                        </h3>
                        <span className="font-mono text-xs text-ink-3">
                          {customer.account_code || "No account code"}
                        </span>
                      </div>

                      {customer.credit_hold ? (
                        <Badge tone="danger">Credit Hold</Badge>
                      ) : customer.active ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Inactive</Badge>
                      )}
                    </div>

                    <div className="my-2 grid grid-cols-2 gap-2">
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

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {customer.adr_required ? (
                        <Badge tone="neutral">ADR</Badge>
                      ) : null}
                      {customer.tail_lift_required ? (
                        <Badge tone="neutral">Tail Lift</Badge>
                      ) : null}
                      {customer.timed_delivery_required ? (
                        <Badge tone="neutral">Timed</Badge>
                      ) : null}
                      {customer.pod_required ? (
                        <Badge tone="neutral">POD</Badge>
                      ) : null}
                      {customer.api_enabled ? (
                        <Badge tone="info">API</Badge>
                      ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={() => startEdit(customer)}
                      >
                        Edit
                      </Button>

                      <Button
                        variant="danger"
                        size="sm"
                        type="button"
                        onClick={() => void deleteCustomer(customer)}
                      >
                        Delete
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
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
    <section className="mt-4 border-t border-line pt-4">
      <h3 className="mb-3 text-kicker uppercase text-ink-3">{title}</h3>
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
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
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
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <textarea
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-24 w-full min-w-0 resize-y rounded-md border border-ink-3 bg-surface px-3 py-2 text-base text-ink"
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
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
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
    <label className="flex min-h-10 items-center gap-2 text-sm text-ink-2">
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
    <div className="text-sm">
      <span className="text-kicker uppercase text-ink-3">{label}</span>{" "}
      <strong className="block text-ink">{value || "—"}</strong>
    </div>
  );
}
