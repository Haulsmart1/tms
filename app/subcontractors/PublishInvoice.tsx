"use client";

import { useEffect, useState, type FormEvent } from "react";
import Button from "../../components/Button";
import Field from "../../components/Field";

type PublishedInvoice = {
  id: string;
  invoice_number: string;
  issue_date: string;
  expected_payment_date: string | null;
};

export default function PublishInvoice({ id, tenantId, name }: { id: string; tenantId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [issueDate, setIssueDate] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [published, setPublished] = useState<{ invoices: PublishedInvoice[]; pagination: { hasMore: boolean } } | null>(null);
  const [listError, setListError] = useState("");
  const url = `/api/subcontractors/${encodeURIComponent(id)}/invoices`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${url}?page=${page}&pageSize=10`, {
      headers: { "x-tenant-id": tenantId }, cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load published invoices.");
      if (!controller.signal.aborted) {
        setPublished(body);
        setListError("");
      }
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        setListError(cause instanceof Error ? cause.message : "Unable to load published invoices.");
      }
    });
    return () => controller.abort();
  }, [url, tenantId, page, revision]);

  function changePage(nextPage: number) {
    setPublished(null);
    setPage(nextPage);
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const pdf = data.get("invoice");
      if (!(pdf instanceof File) || pdf.size > 4_000_000) throw new Error("Choose a PDF up to 4 MB.");
      const response = await fetch(url, {
        method: "POST", headers: { "x-tenant-id": tenantId }, body: data,
      });
      if (response.status === 413) throw new Error("Choose a PDF up to 4 MB.");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to publish the invoice.");
      form.reset();
      setIssueDate("");
      changePage(1);
      setRevision((value) => value + 1);
      setMessage(`Invoice published to ${name}.`);
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Unable to publish the invoice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-4 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-md font-semibold">Publish an invoice to {name}</h2>
      <form onSubmit={publish} className="mt-3 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="supplier-invoice-number" name="invoiceNumber" label="Invoice number" required maxLength={100} />
          <Field id="supplier-invoice-date" name="issueDate" label="Invoice date" type="date" required
            value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
          <Field id="supplier-invoice-payment-date" name="expectedPaymentDate" label="Expected payment date"
            type="date" min={issueDate || undefined} aria-describedby="supplier-invoice-payment-help" />
          <Field id="supplier-invoice-pdf" name="invoice" label="Issued invoice PDF (up to 4 MB)"
            type="file" accept="application/pdf,.pdf" required />
        </div>
        <p id="supplier-invoice-payment-help" className="m-0 text-xs text-ink-2">
          Leave the date blank to use the subcontractor’s payment terms. The expected date appears in their portal.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy}>Publish to portal</Button>
          {message && <p role={error ? "alert" : "status"} className={error ? "text-danger" : "text-success"}>{message}</p>}
        </div>
      </form>
      <div className="mt-5 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-ink">Published invoices</h3>
        {listError ? <p role="alert" className="text-sm text-danger">{listError}</p> : null}
        {published ? (
          <>
            {published.invoices.length === 0 ? <p className="text-sm text-ink-2">No invoices published yet.</p> : (
              <ul className="mt-2 grid gap-2">
                {published.invoices.map((invoice) => (
                  <PublishedInvoiceDate key={invoice.id} invoice={invoice} tenantId={tenantId} url={url} />
                ))}
              </ul>
            )}
            {page > 1 || published.pagination.hasMore ? (
              <div className="mt-2 flex items-center gap-3">
                <Button type="button" variant="secondary" disabled={page === 1} onClick={() => changePage(page - 1)}>Previous</Button>
                <span>Page {page}</span>
                <Button type="button" variant="secondary" disabled={!published.pagination.hasMore} onClick={() => changePage(page + 1)}>Next</Button>
              </div>
            ) : null}
          </>
        ) : !listError ? <p role="status" className="text-sm text-ink-2">Loading published invoices…</p> : null}
      </div>
    </section>
  );
}

function PublishedInvoiceDate({ invoice, tenantId, url }: { invoice: PublishedInvoice; tenantId: string; url: string }) {
  const [date, setDate] = useState(invoice.expected_payment_date ?? "");
  const [savedDate, setSavedDate] = useState(date);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !date || date === savedDate) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "x-tenant-id": tenantId, "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id, expectedPaymentDate: date }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to update the expected payment date.");
      setSavedDate(date);
      setFeedback({ text: "Expected payment date updated in the portal.", error: false });
    } catch (cause) {
      setFeedback({ text: cause instanceof Error ? cause.message : "Unable to update the expected payment date.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-line p-3">
      <strong className="text-sm">{invoice.invoice_number}</strong>
      <form onSubmit={save} className="mt-2 flex flex-wrap items-end gap-3">
        <Field id={`expected-payment-${invoice.id}`} type="date" label="Expected payment date" required
          min={invoice.issue_date} value={date} disabled={busy} onChange={(event) => {
            setDate(event.target.value);
            setFeedback(null);
          }} />
        <Button type="submit" variant="secondary" loading={busy} disabled={!date || date === savedDate}>Save date</Button>
      </form>
      {feedback ? <p role={feedback.error ? "alert" : "status"} className="mt-2 text-sm">{feedback.text}</p> : null}
    </li>
  );
}
