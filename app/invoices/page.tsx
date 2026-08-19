"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import Card from "../../components/Card";
import MessageBanner from "../../components/MessageBanner";
import Stat from "../../components/Stat";
import Tabs from "../../components/Tabs";

type Tab =
  | "ready"
  | "invoices"
  | "credits"
  | "payments"
  | "statements"
  | "chase"
  | "customer-pos"
  | "supplier-pos"
  | "accounting";

type ReadyJob = {
  job_id: string;
  customer_id: string;
  customer_name: string | null;
  job_reference: string | null;
  completed_at: string | null;
  customer_price: number | null;
  pod_status: string | null;
  requires_po: boolean;
  pod_required: boolean;
  invoice_pod_attachment_required: boolean;
  vat_rate: number | null;
  currency_code: string | null;
};

type Invoice = {
  id: string;
  customer_id: string | null;
  customer_name?: string | null;
  invoice_number: string | null;
  status: string | null;
  issue_date: string | null;
  due_date: string | null;
  subtotal?: number | null;
  vat_total?: number | null;
  total: number | null;
  amount_paid?: number | null;
  credit_total?: number | null;
  balance_due: number | null;
  currency: string | null;
  accounting_sync_status?: string | null;
};

type Customer = {
  id: string;
  name: string;
  accounts_email: string | null;
  account_code: string | null;
  currency_code: string | null;
  payment_terms_days: number | null;
  requires_po: boolean;
  pod_required: boolean;
  invoice_pod_attachment_required: boolean;
  vat_rate: number | null;
  credit_status: string | null;
  credit_hold: boolean;
};

type Subcontractor = {
  id: string;
  name: string;
};

type Integration = {
  id: string;
  provider: string;
  display_name: string | null;
  connection_status: string;
  active: boolean;
  last_sync_at: string | null;
};

type XeroStatus = {
  connected: boolean;
  integration: {
    id: string;
    provider: string;
    display_name: string | null;
    active: boolean;
    connection_status: string;
    external_tenant_id: string | null;
    external_tenant_name: string | null;
    default_sales_account_code: string | null;
    default_purchase_account_code: string | null;
    default_tax_code: string | null;
    default_currency: string | null;
    connected_at: string | null;
    last_sync_at: string | null;
    updated_at: string | null;
  } | null;
};

type GenericRow = Record<string, unknown>;

const TABS: Array<[Tab, string]> = [
  ["ready", "Ready to Invoice"],
  ["invoices", "Invoices"],
  ["credits", "Credit Notes"],
  ["payments", "Payments"],
  ["statements", "Statements"],
  ["chase", "Chase Letters"],
  ["customer-pos", "Customer POs"],
  ["supplier-pos", "Supplier POs"],
  ["accounting", "Accounting"],
];

export default function CustomerAccountsPage() {
  const tenant = useTenant();

  const [tab, setTab] = useState<Tab>("ready");
  const [readyJobs, setReadyJobs] = useState<ReadyJob[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);

  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const [invoicePoReference, setInvoicePoReference] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");

  const [paymentCustomerId, setPaymentCustomerId] = useState("");
  const [paymentInvoiceId, setPaymentInvoiceId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");

  const [creditInvoiceId, setCreditInvoiceId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");

  const [statementCustomerId, setStatementCustomerId] = useState("");

  const [chaseCustomerId, setChaseCustomerId] = useState("");
  const [chaseLevel, setChaseLevel] = useState("reminder_1");
  const [chaseSubject, setChaseSubject] = useState(
    "Outstanding account reminder"
  );
  const [chaseBody, setChaseBody] = useState("");

  const [customerPoCustomerId, setCustomerPoCustomerId] = useState("");
  const [customerPoNumber, setCustomerPoNumber] = useState("");
  const [customerPoValue, setCustomerPoValue] = useState("");
  const [customerPoDescription, setCustomerPoDescription] = useState("");

  const [supplierPoSubcontractorId, setSupplierPoSubcontractorId] =
    useState("");
  const [supplierPoNumber, setSupplierPoNumber] = useState("");
  const [supplierPoSubtotal, setSupplierPoSubtotal] = useState("");
  const [supplierPoVat, setSupplierPoVat] = useState("");
  const [supplierPoDescription, setSupplierPoDescription] = useState("");

  const [provider, setProvider] = useState("xero");
  const [providerDisplayName, setProviderDisplayName] = useState("");
  const [salesAccountCode, setSalesAccountCode] = useState("");
  const [purchaseAccountCode, setPurchaseAccountCode] = useState("");
  const [taxCode, setTaxCode] = useState("");

  const [xeroStatus, setXeroStatus] = useState<XeroStatus>({
    connected: false,
    integration: null,
  });
  const [xeroWorking, setXeroWorking] = useState(false);

  const tenantId = tenant.activeTenantId;

  const loadXeroStatus = useCallback(async () => {
    if (!tenantId) {
      setXeroStatus({
        connected: false,
        integration: null,
      });
      return;
    }

    const response = await fetch(
      `/api/accounts/accounting/xero/status?tenantId=${encodeURIComponent(
        tenantId
      )}`,
      {
        cache: "no-store",
      }
    );

    const body = (await response.json()) as XeroStatus & {
      error?: string;
    };

    if (!response.ok) {
      throw new Error(body.error || "Unable to load Xero connection status.");
    }

    setXeroStatus({
      connected: body.connected === true,
      integration: body.integration ?? null,
    });

    const integration = body.integration;

    if (integration) {
      setProvider("xero");
      setProviderDisplayName(integration.display_name || "Xero");
      setSalesAccountCode(
        integration.default_sales_account_code || ""
      );
      setPurchaseAccountCode(
        integration.default_purchase_account_code || ""
      );
      setTaxCode(integration.default_tax_code || "");
    }
  }, [tenantId]);

  const loadLookups = useCallback(async () => {
    if (!tenantId) return;

    const response = await fetch(
      `/api/accounts/lookups?tenantId=${encodeURIComponent(tenantId)}`,
      { cache: "no-store" }
    );

    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error || "Unable to load account lookups.");
    }

    setCustomers(body.customers ?? []);
    setSubcontractors(body.subcontractors ?? []);

    setInvoices((current) => {
      if (current.length > 0) return current;

      return (body.invoices ?? []).map((invoice: Invoice) => ({
        ...invoice,
        customer_name:
          body.customers?.find(
            (customer: Customer) => customer.id === invoice.customer_id
          )?.name ?? null,
      }));
    });
  }, [tenantId]);

  const loadTab = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      await loadLookups();

      if (tab === "ready") {
        const response = await fetch(
          `/api/accounts/ready-to-invoice?tenantId=${encodeURIComponent(
            tenantId
          )}`,
          { cache: "no-store" }
        );

        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error || "Unable to load completed jobs.");
        }

        setReadyJobs(body.jobs ?? []);
        setRows([]);
        return;
      }

      if (tab === "invoices") {
        const response = await fetch(
          `/api/accounts/invoices?tenantId=${encodeURIComponent(tenantId)}`,
          { cache: "no-store" }
        );

        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error || "Unable to load invoices.");
        }

        setInvoices(body.invoices ?? []);
        setRows([]);
        return;
      }

      const endpoint =
        tab === "credits"
          ? "credit-notes"
          : tab === "payments"
            ? "payments"
            : tab === "statements"
              ? "statements"
              : tab === "chase"
                ? "chase-letters"
                : tab === "accounting"
                  ? "accounting"
                  : "purchase-orders";

      const suffix =
        tab === "supplier-pos"
          ? "&type=supplier"
          : tab === "customer-pos"
            ? "&type=customer"
            : "";

      const response = await fetch(
        `/api/accounts/${endpoint}?tenantId=${encodeURIComponent(
          tenantId
        )}${suffix}`,
        { cache: "no-store" }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Unable to load accounts data.");
      }

      if (tab === "accounting") {
        setIntegrations(body.integrations ?? []);
        setRows([]);
      } else {
        setRows(
          body.creditNotes ??
            body.payments ??
            body.statements ??
            body.chaseLetters ??
            body.purchaseOrders ??
            []
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load accounts."
      );
    } finally {
      setLoading(false);
    }
  }, [loadLookups, tab, tenantId]);

  useEffect(() => {
    void loadTab();
  }, [loadTab]);

  useEffect(() => {
    if (tab !== "accounting" || !tenantId) {
      return;
    }

    void loadXeroStatus().catch((error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load Xero status."
      );
    });
  }, [loadXeroStatus, tab, tenantId]);

  const selectedReady = useMemo(
    () => readyJobs.filter((job) => selectedJobs.includes(job.job_id)),
    [readyJobs, selectedJobs]
  );

  const selectedCustomerIds = Array.from(
    new Set(selectedReady.map((job) => job.customer_id))
  );

  const selectedTotal = selectedReady.reduce(
    (sum, job) => sum + Number(job.customer_price ?? 0),
    0
  );

  const openInvoices = invoices.filter(
    (invoice) =>
      Number(invoice.balance_due ?? 0) > 0 &&
      !["void", "credited"].includes(String(invoice.status ?? "").toLowerCase())
  );

  const overdueInvoices = openInvoices.filter(
    (invoice) =>
      invoice.due_date &&
      invoice.due_date < new Date().toISOString().slice(0, 10)
  );

  const outstandingTotal = openInvoices.reduce(
    (sum, invoice) => sum + Number(invoice.balance_due ?? 0),
    0
  );

  async function postJson(
    path: string,
    payload: Record<string, unknown>,
    successMessage: string
  ) {
    setWorking(true);
    setMessage("");

    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Unable to save record.");
      }

      setMessage(successMessage);
      await loadTab();
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save record."
      );
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function createInvoice() {
    if (!tenant.writeTenantId || selectedReady.length === 0) {
      setMessage("Choose at least one completed job.");
      return;
    }

    if (selectedCustomerIds.length !== 1) {
      setMessage("All selected jobs must belong to the same customer.");
      return;
    }

    const customer = customers.find(
      (item) => item.id === selectedCustomerIds[0]
    );

    if (customer?.requires_po && !invoicePoReference.trim()) {
      setMessage("This customer requires a PO reference before invoicing.");
      return;
    }

    const success = await postJson(
      "/api/accounts/invoices",
      {
        tenantId: tenant.writeTenantId,
        customerId: selectedCustomerIds[0],
        jobIds: selectedJobs,
        poReference: invoicePoReference.trim() || null,
        notes: invoiceNotes.trim() || null,
      },
      "Invoice created."
    );

    if (success) {
      setSelectedJobs([]);
      setInvoicePoReference("");
      setInvoiceNotes("");
      setTab("invoices");
    }
  }

  async function createPayment() {
    if (!tenant.writeTenantId || !paymentCustomerId || !paymentAmount) {
      setMessage("Customer and payment amount are required.");
      return;
    }

    const success = await postJson(
      "/api/accounts/payments",
      {
        tenantId: tenant.writeTenantId,
        customerId: paymentCustomerId,
        invoiceId: paymentInvoiceId || null,
        amount: Number(paymentAmount),
        allocateAmount: paymentInvoiceId ? Number(paymentAmount) : 0,
        paymentMethod,
        paymentReference: paymentReference.trim() || null,
      },
      "Payment recorded."
    );

    if (success) {
      setPaymentAmount("");
      setPaymentReference("");
    }
  }

  async function createCreditNote() {
    if (!tenant.writeTenantId || !creditInvoiceId || !creditAmount) {
      setMessage("Invoice and credit amount are required.");
      return;
    }

    const success = await postJson(
      "/api/accounts/credit-notes",
      {
        tenantId: tenant.writeTenantId,
        invoiceId: creditInvoiceId,
        amount: Number(creditAmount),
        reason: creditReason.trim() || null,
      },
      "Credit note created."
    );

    if (success) {
      setCreditAmount("");
      setCreditReason("");
    }
  }

  async function createStatement() {
    if (!tenant.writeTenantId || !statementCustomerId) {
      setMessage("Choose a customer.");
      return;
    }

    await postJson(
      "/api/accounts/statements",
      {
        tenantId: tenant.writeTenantId,
        customerId: statementCustomerId,
      },
      "Statement generated."
    );
  }

  async function createChaseLetter() {
    if (!tenant.writeTenantId || !chaseCustomerId) {
      setMessage("Choose a customer.");
      return;
    }

    await postJson(
      "/api/accounts/chase-letters",
      {
        tenantId: tenant.writeTenantId,
        customerId: chaseCustomerId,
        chaseLevel,
        subject: chaseSubject.trim(),
        body: chaseBody.trim() || null,
      },
      "Chase letter created."
    );
  }

  async function createCustomerPo() {
    if (
      !tenant.writeTenantId ||
      !customerPoCustomerId ||
      !customerPoNumber.trim()
    ) {
      setMessage("Customer and PO number are required.");
      return;
    }

    const success = await postJson(
      "/api/accounts/purchase-orders",
      {
        tenantId: tenant.writeTenantId,
        type: "customer",
        customerId: customerPoCustomerId,
        poNumber: customerPoNumber.trim(),
        authorisedValue: customerPoValue
          ? Number(customerPoValue)
          : null,
        description: customerPoDescription.trim() || null,
      },
      "Customer PO created."
    );

    if (success) {
      setCustomerPoNumber("");
      setCustomerPoValue("");
      setCustomerPoDescription("");
    }
  }

  async function createSupplierPo() {
    if (!tenant.writeTenantId || !supplierPoNumber.trim()) {
      setMessage("Supplier PO number is required.");
      return;
    }

    const subtotal = Number(supplierPoSubtotal || 0);
    const vat = Number(supplierPoVat || 0);

    const success = await postJson(
      "/api/accounts/purchase-orders",
      {
        tenantId: tenant.writeTenantId,
        type: "supplier",
        subcontractorId: supplierPoSubcontractorId || null,
        poNumber: supplierPoNumber.trim(),
        description: supplierPoDescription.trim() || null,
        subtotal,
        vatTotal: vat,
        total: subtotal + vat,
      },
      "Supplier PO created."
    );

    if (success) {
      setSupplierPoNumber("");
      setSupplierPoSubtotal("");
      setSupplierPoVat("");
      setSupplierPoDescription("");
    }
  }

  function connectXero() {
    const targetTenantId =
      tenant.writeTenantId || tenant.activeTenantId;

    if (!targetTenantId) {
      setMessage("Choose a tenant before connecting Xero.");
      return;
    }

    window.location.assign(
      `/api/accounts/accounting/xero/connect?tenantId=${encodeURIComponent(
        targetTenantId
      )}`
    );
  }

  async function testXeroConnection() {
    const targetTenantId =
      tenant.writeTenantId || tenant.activeTenantId;

    if (!targetTenantId) {
      setMessage("Choose a tenant before testing Xero.");
      return;
    }

    setXeroWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        "/api/accounts/accounting/xero/test",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId: targetTenantId,
          }),
        }
      );

      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        organisation?: {
          Name?: string;
        } | null;
      };

      if (!response.ok) {
        throw new Error(body.error || "Xero connection test failed.");
      }

      setMessage(
        body.organisation?.Name
          ? `Xero connection successful: ${body.organisation.Name}`
          : "Xero connection successful."
      );

      await loadXeroStatus();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Xero connection test failed."
      );
    } finally {
      setXeroWorking(false);
    }
  }

  async function disconnectXero() {
    const targetTenantId =
      tenant.writeTenantId || tenant.activeTenantId;

    if (!targetTenantId) {
      setMessage("Choose a tenant before disconnecting Xero.");
      return;
    }

    if (
      !window.confirm(
        "Disconnect Xero from this TMS tenant?"
      )
    ) {
      return;
    }

    setXeroWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        "/api/accounts/accounting/xero/disconnect",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId: targetTenantId,
          }),
        }
      );

      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error || "Unable to disconnect Xero.");
      }

      setMessage("Xero disconnected.");

      await loadXeroStatus();
      await loadTab();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to disconnect Xero."
      );
    } finally {
      setXeroWorking(false);
    }
  }

  async function saveAccountingProvider() {
    if (!tenant.writeTenantId) {
      setMessage("Choose a tenant.");
      return;
    }

    await postJson(
      "/api/accounts/accounting",
      {
        tenantId: tenant.writeTenantId,
        provider,
        displayName: providerDisplayName.trim() || provider,
        defaultSalesAccountCode: salesAccountCode.trim() || null,
        defaultPurchaseAccountCode: purchaseAccountCode.trim() || null,
        defaultTaxCode: taxCode.trim() || null,
        connectionStatus:
          provider === "manual" || provider === "csv"
            ? "available"
            : "not_connected",
      },
      "Accounting provider settings saved."
    );
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1500px] px-6 py-8">
          <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-kicker uppercase text-ink-3">
                Customer Accounts
              </div>
              <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                Invoices & Accounts
              </h1>
              <p className="m-0 text-sm text-ink-3">
                Jobs, PODs, invoices, credits, payments, statements, purchase
                orders, debt chasing and accounting-package sync.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Stat
                label="Outstanding"
                value={money(outstandingTotal, "GBP")}
              />
              <Stat
                label="Overdue invoices"
                value={String(overdueInvoices.length)}
              />
              <Stat
                label="Ready to invoice"
                value={String(readyJobs.length)}
              />
            </div>
          </header>

          <div className="-m-0.5 mb-4 overflow-x-auto p-0.5">
            <Tabs
              label="Accounts sections"
              tabs={TABS.map(([key, label]) => ({ id: key, label }))}
              activeId={tab}
              onChange={(id) => setTab(id as Tab)}
            />
          </div>

          <MessageBanner tone="neutral">{message}</MessageBanner>

          {loading ? (
            <Card>Loading accounts...</Card>
          ) : (
            <>
              {tab === "ready" ? (
                <ReadyToInvoicePanel
                  readyJobs={readyJobs}
                  selectedJobs={selectedJobs}
                  setSelectedJobs={setSelectedJobs}
                  selectedReady={selectedReady}
                  selectedTotal={selectedTotal}
                  invoicePoReference={invoicePoReference}
                  setInvoicePoReference={setInvoicePoReference}
                  invoiceNotes={invoiceNotes}
                  setInvoiceNotes={setInvoiceNotes}
                  working={working}
                  createInvoice={createInvoice}
                />
              ) : null}

              {tab === "invoices" ? (
                <InvoicesPanel invoices={invoices} />
              ) : null}

              {tab === "payments" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Record Customer Payment</h2>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Customer">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={paymentCustomerId}
                        onChange={(event) => {
                          setPaymentCustomerId(event.target.value);
                          setPaymentInvoiceId("");
                        }}
                      >
                        <option value="">Choose customer</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Allocate to Invoice">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={paymentInvoiceId}
                        onChange={(event) =>
                          setPaymentInvoiceId(event.target.value)
                        }
                      >
                        <option value="">Unallocated payment</option>
                        {openInvoices
                          .filter(
                            (invoice) =>
                              !paymentCustomerId ||
                              invoice.customer_id === paymentCustomerId
                          )
                          .map((invoice) => (
                            <option key={invoice.id} value={invoice.id}>
                              {invoice.invoice_number} Â·{" "}
                              {money(
                                invoice.balance_due,
                                invoice.currency || "GBP"
                              )}{" "}
                              outstanding
                            </option>
                          ))}
                      </select>
                    </Field>

                    <Field label="Amount">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        type="number"
                        step="0.01"
                        min="0"
                        value={paymentAmount}
                        onChange={(event) =>
                          setPaymentAmount(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Method">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={paymentMethod}
                        onChange={(event) =>
                          setPaymentMethod(event.target.value)
                        }
                      >
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                        <option value="cheque">Cheque</option>
                        <option value="direct_debit">Direct Debit</option>
                        <option value="other">Other</option>
                      </select>
                    </Field>

                    <Field label="Reference">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={paymentReference}
                        onChange={(event) =>
                          setPaymentReference(event.target.value)
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Record Payment"
                      onClick={createPayment}
                    />
                  </div>

                  <RecordCards rows={rows} />
                </section>
              ) : null}

              {tab === "credits" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Create Credit Note</h2>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Original Invoice">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={creditInvoiceId}
                        onChange={(event) =>
                          setCreditInvoiceId(event.target.value)
                        }
                      >
                        <option value="">Choose invoice</option>
                        {invoices.map((invoice) => (
                          <option key={invoice.id} value={invoice.id}>
                            {invoice.invoice_number} Â·{" "}
                            {invoice.customer_name || "Customer"} Â·{" "}
                            {money(invoice.total, invoice.currency || "GBP")}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Credit Amount">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        type="number"
                        step="0.01"
                        min="0"
                        value={creditAmount}
                        onChange={(event) =>
                          setCreditAmount(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Reason">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={creditReason}
                        onChange={(event) =>
                          setCreditReason(event.target.value)
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Create Credit Note"
                      onClick={createCreditNote}
                    />
                  </div>

                  <RecordCards rows={rows} />
                </section>
              ) : null}

              {tab === "statements" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Generate Statement</h2>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Customer">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={statementCustomerId}
                        onChange={(event) =>
                          setStatementCustomerId(event.target.value)
                        }
                      >
                        <option value="">Choose customer</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Generate Statement"
                      onClick={createStatement}
                    />
                  </div>

                  <RecordCards rows={rows} />
                </section>
              ) : null}

              {tab === "chase" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Create Chase Letter</h2>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Customer">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={chaseCustomerId}
                        onChange={(event) =>
                          setChaseCustomerId(event.target.value)
                        }
                      >
                        <option value="">Choose customer</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Level">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={chaseLevel}
                        onChange={(event) =>
                          setChaseLevel(event.target.value)
                        }
                      >
                        <option value="reminder_1">Reminder 1</option>
                        <option value="reminder_2">Reminder 2</option>
                        <option value="final_reminder">Final Reminder</option>
                        <option value="account_hold">Account Hold</option>
                      </select>
                    </Field>

                    <Field label="Subject">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={chaseSubject}
                        onChange={(event) =>
                          setChaseSubject(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Message">
                      <textarea
                        className="min-h-24 w-full min-w-0 resize-y rounded-md border border-ink-3 bg-surface px-3 py-2 text-base text-ink"
                        value={chaseBody}
                        onChange={(event) =>
                          setChaseBody(event.target.value)
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Create Chase Letter"
                      onClick={createChaseLetter}
                    />
                  </div>

                  <RecordCards rows={rows} />
                </section>
              ) : null}

              {tab === "customer-pos" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Customer Purchase Order</h2>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Customer">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={customerPoCustomerId}
                        onChange={(event) =>
                          setCustomerPoCustomerId(event.target.value)
                        }
                      >
                        <option value="">Choose customer</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="PO Number">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={customerPoNumber}
                        onChange={(event) =>
                          setCustomerPoNumber(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Authorised Value">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        type="number"
                        step="0.01"
                        value={customerPoValue}
                        onChange={(event) =>
                          setCustomerPoValue(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Description">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={customerPoDescription}
                        onChange={(event) =>
                          setCustomerPoDescription(event.target.value)
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Create Customer PO"
                      onClick={createCustomerPo}
                    />
                  </div>

                  <RecordCards rows={rows} />
                </section>
              ) : null}

              {tab === "supplier-pos" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Supplier / Subcontractor PO</h2>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Subcontractor">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={supplierPoSubcontractorId}
                        onChange={(event) =>
                          setSupplierPoSubcontractorId(event.target.value)
                        }
                      >
                        <option value="">General supplier / not linked</option>
                        {subcontractors.map((subcontractor) => (
                          <option
                            key={subcontractor.id}
                            value={subcontractor.id}
                          >
                            {subcontractor.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="PO Number">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={supplierPoNumber}
                        onChange={(event) =>
                          setSupplierPoNumber(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Net">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        type="number"
                        step="0.01"
                        value={supplierPoSubtotal}
                        onChange={(event) =>
                          setSupplierPoSubtotal(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="VAT">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        type="number"
                        step="0.01"
                        value={supplierPoVat}
                        onChange={(event) =>
                          setSupplierPoVat(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Description">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={supplierPoDescription}
                        onChange={(event) =>
                          setSupplierPoDescription(event.target.value)
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Create Supplier PO"
                      onClick={createSupplierPo}
                    />
                  </div>

                  <RecordCards rows={rows} />
                </section>
              ) : null}

              {tab === "accounting" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Accounting Integration</h2>

                  <article className="mb-4 rounded-lg border border-line bg-surface-2 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <strong className="font-mono text-sm font-semibold text-ink">
                          Xero
                        </strong>

                        <div className="text-sm text-ink-3">
                          Secure OAuth accounting connection
                        </div>
                      </div>

                      <Status
                        value={
                          xeroStatus.connected
                            ? "connected"
                            : xeroStatus.integration?.connection_status ||
                              "not_connected"
                        }
                      />
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Info
                        label="Organisation"
                        value={
                          xeroStatus.integration?.external_tenant_name ||
                          "Not connected"
                        }
                      />

                      <Info
                        label="Connected"
                        value={formatDate(
                          xeroStatus.integration?.connected_at
                        )}
                      />

                      <Info
                        label="Last Sync"
                        value={formatDate(
                          xeroStatus.integration?.last_sync_at
                        )}
                      />

                      <Info
                        label="Currency"
                        value={
                          xeroStatus.integration?.default_currency ||
                          "GBP"
                        }
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2.5">
                      {!xeroStatus.connected ? (
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={connectXero}
                          disabled={xeroWorking}
                        >
                          Connect Xero
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => void testXeroConnection()}
                            disabled={xeroWorking}
                          >
                            {xeroWorking
                              ? "Testing..."
                              : "Test Connection"}
                          </Button>

                          <Button
                            variant="danger"
                            type="button"
                            onClick={() => void disconnectXero()}
                            disabled={xeroWorking}
                          >
                            Disconnect Xero
                          </Button>
                        </>
                      )}
                    </div>
                  </article>

                  <p className="mb-3 text-sm text-ink-3">
                    Configure nominal/account codes here. Xero credentials are
                    stored securely on the server and are never exposed to the
                    browser.
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Provider">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={provider}
                        onChange={(event) =>
                          setProvider(event.target.value)
                        }
                      >
                        <option value="xero">Xero</option>
                        <option value="quickbooks">QuickBooks Online</option>
                        <option value="sage">Sage</option>
                        <option value="freeagent">FreeAgent</option>
                        <option value="csv">CSV Export</option>
                        <option value="manual">Manual</option>
                      </select>
                    </Field>

                    <Field label="Display Name">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={providerDisplayName}
                        onChange={(event) =>
                          setProviderDisplayName(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Sales Account Code">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={salesAccountCode}
                        onChange={(event) =>
                          setSalesAccountCode(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Purchase Account Code">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={purchaseAccountCode}
                        onChange={(event) =>
                          setPurchaseAccountCode(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Tax Code">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={taxCode}
                        onChange={(event) =>
                          setTaxCode(event.target.value)
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Save Provider Settings"
                      onClick={saveAccountingProvider}
                    />
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {integrations
                      .filter(
                        (integration) =>
                          integration.provider !== "xero" ||
                          integration.id !== xeroStatus.integration?.id
                      )
                      .map((integration) => (
                        <article
                          key={integration.id}
                          className="rounded-lg border border-line bg-surface-2 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <strong className="text-ink">
                              {integration.display_name ||
                                integration.provider}
                            </strong>

                            <Status
                              value={integration.connection_status}
                            />
                          </div>

                          <div className="mt-1 text-sm text-ink-3">
                            Provider: {integration.provider}
                          </div>

                          <div className="text-sm text-ink-3">
                            Last sync:{" "}
                            {formatDate(integration.last_sync_at)}
                          </div>
                        </article>
                      ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </main>
      </div>
    </TenantGate>
  );
}

function ReadyToInvoicePanel({
  readyJobs,
  selectedJobs,
  setSelectedJobs,
  selectedReady,
  selectedTotal,
  invoicePoReference,
  setInvoicePoReference,
  invoiceNotes,
  setInvoiceNotes,
  working,
  createInvoice,
}: {
  readyJobs: ReadyJob[];
  selectedJobs: string[];
  setSelectedJobs: React.Dispatch<React.SetStateAction<string[]>>;
  selectedReady: ReadyJob[];
  selectedTotal: number;
  invoicePoReference: string;
  setInvoicePoReference: (value: string) => void;
  invoiceNotes: string;
  setInvoiceNotes: (value: string) => void;
  working: boolean;
  createInvoice: () => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-md font-semibold text-ink">Ready to Invoice</h2>
          <p className="m-0 text-sm text-ink-3">
            Select completed jobs for one customer to create a consolidated
            invoice.
          </p>
        </div>

        <div className="grid gap-0.5 text-right text-sm">
          <strong className="font-mono tabular-nums text-ink">
            {selectedReady.length} selected
          </strong>
          <span className="font-mono tabular-nums text-ink-2">
            {money(
              selectedTotal,
              selectedReady[0]?.currency_code || "GBP"
            )}
          </span>
        </div>
      </div>

      <div className="my-3 grid gap-3 sm:grid-cols-2">
        <Field label="Customer PO Reference">
          <input
            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
            value={invoicePoReference}
            onChange={(event) =>
              setInvoicePoReference(event.target.value)
            }
          />
        </Field>

        <Field label="Invoice Notes">
          <input
            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
            value={invoiceNotes}
            onChange={(event) => setInvoiceNotes(event.target.value)}
          />
        </Field>
      </div>

      <ActionButton
        working={working}
        label="Create Consolidated Invoice"
        onClick={createInvoice}
        disabled={selectedReady.length === 0}
      />

      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2"></th>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2">Job</th>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2">Customer</th>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2">Completed</th>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2">POD</th>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2">PO Required</th>
              <th className="border-b border-line px-3 py-2 text-right text-kicker uppercase text-ink-2">Price</th>
            </tr>
          </thead>

          <tbody>
            {readyJobs.map((job) => (
              <tr key={job.job_id}>
                <td className="border-b border-line px-3 py-2 text-ink">
                  <input
                    type="checkbox"
                    checked={selectedJobs.includes(job.job_id)}
                    onChange={(event) =>
                      setSelectedJobs((current) =>
                        event.target.checked
                          ? [...current, job.job_id]
                          : current.filter((id) => id !== job.job_id)
                      )
                    }
                  />
                </td>

                <td className="border-b border-line px-3 py-2 text-ink">{job.job_reference || job.job_id.slice(0, 8)}</td>
                <td className="border-b border-line px-3 py-2 text-ink">{job.customer_name || "Customer"}</td>
                <td className="border-b border-line px-3 py-2 text-ink">{formatDate(job.completed_at)}</td>
                <td className="border-b border-line px-3 py-2 text-ink">
                  <Status value={job.pod_status || "Not set"} />
                </td>
                <td className="border-b border-line px-3 py-2 text-ink">{job.requires_po ? "Yes" : "No"}</td>
                <td className="border-b border-line px-3 py-2 text-right font-mono tabular-nums text-ink">
                  {money(
                    job.customer_price,
                    job.currency_code || "GBP"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InvoicesPanel({ invoices }: { invoices: Invoice[] }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <h2 className="m-0 text-md font-semibold text-ink">Invoices</h2>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {invoices.length === 0 ? (
          <p className="col-span-full py-10 text-center text-sm text-ink-3">No invoices yet.</p>
        ) : (
          invoices.map((invoice) => (
            <article
              key={invoice.id}
              className="rounded-lg border border-line bg-surface-2 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <strong className="font-mono text-sm font-semibold text-ink">
                    {invoice.invoice_number || "Invoice"}
                  </strong>
                  <div className="text-sm text-ink-3">
                    {invoice.customer_name || "Customer"}
                  </div>
                </div>

                <Status value={invoice.status || "draft"} />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <Info
                  label="Issue Date"
                  value={formatDate(invoice.issue_date)}
                />
                <Info
                  label="Due Date"
                  value={formatDate(invoice.due_date)}
                />
                <Info
                  label="Total"
                  value={money(invoice.total, invoice.currency || "GBP")}
                />
                <Info
                  label="Balance"
                  value={money(
                    invoice.balance_due,
                    invoice.currency || "GBP"
                  )}
                />
                <Info
                  label="Accounting"
                  value={invoice.accounting_sync_status || "not_synced"}
                />
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function RecordCards({ rows }: { rows: GenericRow[] }) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.length === 0 ? (
        <p className="col-span-full py-10 text-center text-sm text-ink-3">No records yet.</p>
      ) : (
        rows.map((row, index) => (
          <article
            key={String(row.id ?? index)}
            className="rounded-lg border border-line bg-surface-2 p-3"
          >
            <pre className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-xs text-ink-2">
              {JSON.stringify(row, null, 2)}
            </pre>
          </article>
        ))
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

function ActionButton({
  working,
  label,
  onClick,
  disabled = false,
}: {
  working: boolean;
  label: string;
  onClick: () => Promise<void>;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      disabled={working || disabled}
      onClick={() => void onClick()}
    >
      {working ? "Working..." : label}
    </Button>
  );
}

function Status({ value }: { value: string }) {
  return (
    <Badge tone="neutral">
      <span className="capitalize">{value.replaceAll("_", " ")}</span>
    </Badge>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="text-sm">
      <span className="text-kicker uppercase text-ink-2">{label}</span>{" "}
      <strong className="block text-ink">{value}</strong>
    </div>
  );
}

function money(
  value: number | null | undefined,
  currency: string
) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "GBP",
  }).format(Number(value ?? 0));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "â€”";

  const date = new Date(
    value.includes("T") ? value : `${value}T00:00:00`
  );

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB");
}
