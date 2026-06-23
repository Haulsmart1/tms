"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";

const TENANT_ID = "2f7cc0dc-b7fd-4556-92be-445e4b42ddcd";

function formatMoney(value: any) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(value));
}

function buildInvoiceNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const random = String(Math.floor(Math.random() * 900) + 100);
  return `INV-${y}${m}${d}-${random}`;
}

const tableCardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.95)",
  padding: 22,
  borderRadius: 16,
  boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
  overflowX: "auto"
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "transparent"
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: 12,
  borderBottom: "1px solid #e5e7eb",
  color: "#111827",
  fontSize: 14
};

const tdStyle: React.CSSProperties = {
  padding: 12,
  borderBottom: "1px solid #f1f5f9",
  color: "#111827",
  verticalAlign: "top"
};

const buttonStyle = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 600,
  cursor: "pointer"
};

const selectStyle = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  color: "#111827"
};

export default function InvoicesPage() {
  const supabase = createClient();

  const [invoices, setInvoices] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  async function loadData() {
    setMessage("");

    const { data: invoiceData, error: invoiceError } = await supabase
      .from("invoices")
      .select(`
        id,
        job_id,
        invoice_number,
        issue_date,
        due_date,
        subtotal,
        vat_amount,
        total_amount,
        status,
        jobs (
          reference
        ),
        customers (
          name
        )
      `)
      .eq("tenant_id", TENANT_ID)
      .order("created_at", { ascending: false });

    const { data: jobsData, error: jobsError } = await supabase
      .from("jobs")
      .select(`
        id,
        reference,
        status,
        customer_id,
        customer_price,
        customers (
          name
        )
      `)
      .eq("tenant_id", TENANT_ID)
      .eq("status", "completed")
      .order("created_at", { ascending: false });

    if (invoiceError) {
      setMessage(`Invoice load error: ${invoiceError.message}`);
      return;
    }

    if (jobsError) {
      setMessage(`Job load error: ${jobsError.message}`);
      return;
    }

    setInvoices(invoiceData || []);

    const invoicedJobIds = new Set((invoiceData || []).map((invoice: any) => invoice.job_id));
    const readyJobs = (jobsData || []).filter(
      (job: any) => !invoicedJobIds.has(job.id) && job.customer_id && job.customer_price != null
    );

    setJobs(readyJobs);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function createInvoice(job: any) {
    const subtotal = Number(job.customer_price || 0);
    const vatAmount = 0;
    const totalAmount = subtotal + vatAmount;

    const issueDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const { error } = await supabase.from("invoices").insert([
      {
        tenant_id: TENANT_ID,
        job_id: job.id,
        customer_id: job.customer_id,
        invoice_number: buildInvoiceNumber(),
        issue_date: issueDate.toISOString().slice(0, 10),
        due_date: dueDate.toISOString().slice(0, 10),
        subtotal: subtotal,
        vat_amount: vatAmount,
        total_amount: totalAmount,
        status: "draft",
      },
    ]);

    if (error) {
      setMessage(`Create invoice error: ${error.message}`);
      return;
    }

    setMessage("Invoice created.");
    await loadData();
  }

  async function updateInvoiceStatus(id: any, status: any) {
    const { error } = await supabase
      .from("invoices")
      .update({ status })
      .eq("id", id)
      .eq("tenant_id", TENANT_ID);

    if (error) {
      setMessage(`Update error: ${error.message}`);
      return;
    }

    await loadData();
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 30,
        backgroundImage:
          "url('https://images.unsplash.com/photo-1554224155-8d04cb21cd6c')",
        backgroundSize: "cover",
        backgroundPosition: "center"
      }}
    >
      <div
        style={{
          background: "rgba(0,0,0,0.60)",
          padding: 30,
          borderRadius: 20
        }}
      >
        <div style={{ color: "white", marginBottom: 24 }}>
          <h1 style={{ marginTop: 0, fontSize: 38 }}>Invoices</h1>
          <p style={{ opacity: 0.85, marginBottom: 0 }}>
            Create invoices from completed jobs and manage invoice status.
          </p>
        </div>

        {message ? (
          <div
            style={{
              marginBottom: 20,
              background: "rgba(255,255,255,0.94)",
              padding: 14,
              borderRadius: 12,
              color: "#111827"
            }}
          >
            {message}
          </div>
        ) : null}

        <section style={{ marginBottom: 24 }}>
          <div style={tableCardStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 14 }}>Ready to Invoice</h2>

            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Job</th>
                  <th style={thStyle}>Customer</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job: any) => (
                  <tr key={job.id}>
                    <td style={tdStyle}>{job.reference}</td>
                    <td style={tdStyle}>{job.customers?.name || "-"}</td>
                    <td style={tdStyle}>{formatMoney(job.customer_price)}</td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        style={buttonStyle}
                        onClick={() => createInvoice(job)}
                      >
                        Create Invoice
                      </button>
                    </td>
                  </tr>
                ))}

                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={tdStyle}>
                      No completed uninvoiced jobs ready yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div style={tableCardStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 14 }}>Invoices</h2>

            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Invoice #</th>
                  <th style={thStyle}>Job</th>
                  <th style={thStyle}>Customer</th>
                  <th style={thStyle}>Issue</th>
                  <th style={thStyle}>Due</th>
                  <th style={thStyle}>Total</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Update</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice: any) => (
                  <tr key={invoice.id}>
                    <td style={tdStyle}>{invoice.invoice_number}</td>
                    <td style={tdStyle}>{invoice.jobs?.reference || "-"}</td>
                    <td style={tdStyle}>{invoice.customers?.name || "-"}</td>
                    <td style={tdStyle}>{invoice.issue_date}</td>
                    <td style={tdStyle}>{invoice.due_date || "-"}</td>
                    <td style={tdStyle}>{formatMoney(invoice.total_amount)}</td>
                    <td style={tdStyle}>{invoice.status}</td>
                    <td style={tdStyle}>
                      <select
                        style={selectStyle}
                        value={invoice.status}
                        onChange={(e: any) => updateInvoiceStatus(invoice.id, e.target.value)}
                      >
                        <option value="draft">draft</option>
                        <option value="sent">sent</option>
                        <option value="paid">paid</option>
                      </select>
                    </td>
                  </tr>
                ))}

                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={tdStyle}>
                      No invoices yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}


