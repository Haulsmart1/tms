"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";

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
  customer_name: string | null;
  invoice_number: string | null;
  status: string | null;
  issue_date: string | null;
  due_date: string | null;
  subtotal: number | null;
  vat_total: number | null;
  total: number | null;
  amount_paid: number | null;
  credit_total: number | null;
  balance_due: number | null;
  currency: string | null;
  accounting_sync_status: string | null;
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
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const tenantId = tenant.activeTenantId;

  const load = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      if (tab === "ready") {
        const response = await fetch(
          `/api/accounts/ready-to-invoice?tenantId=${encodeURIComponent(tenantId)}`,
          { cache: "no-store" }
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load jobs.");
        setReadyJobs(body.jobs ?? []);
        setRows([]);
      } else if (tab === "invoices") {
        const response = await fetch(
          `/api/accounts/invoices?tenantId=${encodeURIComponent(tenantId)}`,
          { cache: "no-store" }
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load invoices.");
        setInvoices(body.invoices ?? []);
        setRows([]);
      } else {
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
          `/api/accounts/${endpoint}?tenantId=${encodeURIComponent(tenantId)}${suffix}`,
          { cache: "no-store" }
        );

        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load accounts data.");

        const value =
          body.creditNotes ??
          body.payments ??
          body.statements ??
          body.chaseLetters ??
          body.purchaseOrders ??
          body.integrations ??
          [];

        setRows(value);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load accounts.");
    } finally {
      setLoading(false);
    }
  }, [tab, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function createInvoice() {
    if (!tenant.writeTenantId || selectedReady.length === 0) {
      setMessage("Choose at least one completed job.");
      return;
    }

    if (selectedCustomerIds.length !== 1) {
      setMessage("A consolidated invoice can only contain jobs for one customer.");
      return;
    }

    const first = selectedReady[0];

    if (
      selectedReady.some(
        (job) => job.requires_po && !job.job_reference
      )
    ) {
      setMessage("One or more selected jobs require a customer PO/reference.");
      return;
    }

    setWorking(true);
    setMessage("");

    try {
      const response = await fetch("/api/accounts/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant.writeTenantId,
          customerId: first.customer_id,
          jobIds: selectedJobs,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Unable to create invoice.");
      }

      setSelectedJobs([]);
      setMessage("Invoice created.");
      setTab("invoices");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create invoice.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <TenantGate>
      <main style={styles.page}>
        <div style={styles.container}>
          <header style={styles.header}>
            <div>
              <p style={styles.eyebrow}>Customer Accounts</p>
              <h1 style={styles.title}>Invoices & Accounts</h1>
              <p style={styles.subtitle}>
                Jobs, PODs, invoices, credits, payments, statements, purchase orders,
                debt chasing and accounting-package sync.
              </p>
            </div>
          </header>

          <nav style={styles.tabs}>
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                style={{
                  ...styles.tab,
                  ...(tab === key ? styles.activeTab : {}),
                }}
              >
                {label}
              </button>
            ))}
          </nav>

          {message ? <div style={styles.message}>{message}</div> : null}

          {loading ? (
            <section style={styles.card}>Loading accounts...</section>
          ) : tab === "ready" ? (
            <section style={styles.card}>
              <div style={styles.rowBetween}>
                <div>
                  <h2 style={styles.sectionTitle}>Ready to Invoice</h2>
                  <p style={styles.muted}>
                    Select completed jobs for one customer to create a consolidated invoice.
                  </p>
                </div>

                <div style={styles.summary}>
                  <strong>{selectedReady.length} selected</strong>
                  <span>{money(selectedTotal, selectedReady[0]?.currency_code || "GBP")}</span>
                </div>
              </div>

              <button
                type="button"
                disabled={working || selectedReady.length === 0}
                onClick={() => void createInvoice()}
                style={styles.primaryButton}
              >
                {working ? "Creating..." : "Create Consolidated Invoice"}
              </button>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Job</th>
                      <th>Customer</th>
                      <th>Completed</th>
                      <th>POD</th>
                      <th>PO Required</th>
                      <th style={styles.right}>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readyJobs.map((job) => (
                      <tr key={job.job_id}>
                        <td>
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
                        <td>{job.job_reference || job.job_id.slice(0, 8)}</td>
                        <td>{job.customer_name || "Customer"}</td>
                        <td>{formatDate(job.completed_at)}</td>
                        <td>
                          <Status value={job.pod_status || "Not set"} />
                        </td>
                        <td>{job.requires_po ? "Yes" : "No"}</td>
                        <td style={styles.right}>
                          {money(job.customer_price, job.currency_code || "GBP")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : tab === "invoices" ? (
            <section style={styles.card}>
              <h2 style={styles.sectionTitle}>Invoices</h2>
              <div style={styles.listGrid}>
                {invoices.map((invoice) => (
                  <article key={invoice.id} style={styles.invoiceCard}>
                    <div style={styles.rowBetween}>
                      <div>
                        <strong style={styles.invoiceNumber}>
                          {invoice.invoice_number || "Invoice"}
                        </strong>
                        <div style={styles.muted}>
                          {invoice.customer_name || "Customer"}
                        </div>
                      </div>
                      <Status value={invoice.status || "draft"} />
                    </div>

                    <div style={styles.infoGrid}>
                      <Info label="Issue Date" value={formatDate(invoice.issue_date)} />
                      <Info label="Due Date" value={formatDate(invoice.due_date)} />
                      <Info
                        label="Total"
                        value={money(invoice.total, invoice.currency || "GBP")}
                      />
                      <Info
                        label="Balance"
                        value={money(invoice.balance_due, invoice.currency || "GBP")}
                      />
                      <Info
                        label="Accounting"
                        value={invoice.accounting_sync_status || "not_synced"}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section style={styles.card}>
              <h2 style={styles.sectionTitle}>{TABS.find(([key]) => key === tab)?.[1]}</h2>
              {rows.length === 0 ? (
                <p style={styles.muted}>No records yet.</p>
              ) : (
                <div style={styles.listGrid}>
                  {rows.map((row, index) => (
                    <article key={String(row.id ?? index)} style={styles.invoiceCard}>
                      <pre style={styles.pre}>
                        {JSON.stringify(row, null, 2)}
                      </pre>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </TenantGate>
  );
}

function Status({ value }: { value: string }) {
  return <span style={styles.status}>{value.replaceAll("_", " ")}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={styles.smallLabel}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function money(value: number | null | undefined, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "GBP",
  }).format(Number(value ?? 0));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB");
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "28px 18px 60px",
    background: "#f8fafc",
    color: "#0f172a",
  },
  container: {
    maxWidth: 1500,
    margin: "0 auto",
  },
  header: {
    marginBottom: 20,
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  title: {
    margin: "4px 0",
    fontSize: 42,
  },
  subtitle: {
    color: "#64748b",
    margin: 0,
  },
  tabs: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 18,
  },
  tab: {
    border: "1px solid #cbd5e1",
    borderRadius: 999,
    padding: "9px 12px",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  activeTab: {
    background: "#0f172a",
    color: "#fff",
    borderColor: "#0f172a",
  },
  card: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 20,
    boxShadow: "0 8px 28px rgba(15,23,42,.05)",
  },
  message: {
    marginBottom: 16,
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: 12,
  },
  sectionTitle: {
    marginTop: 0,
  },
  muted: {
    color: "#64748b",
    fontSize: 12,
  },
  rowBetween: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  summary: {
    display: "grid",
    textAlign: "right",
    gap: 2,
  },
  primaryButton: {
    margin: "14px 0",
    border: "none",
    borderRadius: 10,
    background: "#2563eb",
    color: "#fff",
    padding: "11px 14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  right: {
    textAlign: "right",
  },
  status: {
    display: "inline-block",
    padding: "5px 8px",
    borderRadius: 999,
    background: "#e2e8f0",
    fontSize: 11,
    fontWeight: 800,
    textTransform: "capitalize",
  },
  listGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
    gap: 14,
  },
  invoiceCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 16,
    background: "#f8fafc",
  },
  invoiceNumber: {
    fontSize: 18,
  },
  infoGrid: {
    marginTop: 14,
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    gap: 10,
  },
  smallLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  pre: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    margin: 0,
    fontSize: 11,
  },
};
