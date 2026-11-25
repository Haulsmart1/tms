"use client";

import { useEffect, useState, type FormEvent } from "react";
import Button from "../../components/Button";
import Field from "../../components/Field";
import Select from "../../components/Select";
import { operatorToday } from "../../lib/invoices/dates";

const blankLine = () => ({ description: "", quantity: "1", unitPrice: "", vat: "" });

type SignedOffJob = {
  id: string;
  reference: string | null;
  completed_at: string;
  subcontractor_cost: number | string | null;
};

type PublishedInvoice = {
  id: string;
  invoice_number: string;
  issue_date: string;
  expected_payment_date: string | null;
};

export default function PublishInvoice({ id, tenantId, name, generate = false }: {
  id: string; tenantId: string; name: string; generate?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [issueDate, setIssueDate] = useState(() => generate ? operatorToday() : "");
  const [lines, setLines] = useState([blankLine()]);
  const [draftJob, setDraftJob] = useState<SignedOffJob | null>(null);

  function selectDraft(job: SignedOffJob | null) {
    setDraftJob(job);
    setPreviewUrl("");
    setMessage("");
    setIssueDate(operatorToday());
  }
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function editLine(index: number, field: keyof ReturnType<typeof blankLine>, value: string) {
    setPreviewUrl("");
    setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }
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
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const preview = generate && (submitter instanceof HTMLButtonElement && submitter.value === "preview");
    if (generate) {
      if (!preview && !previewUrl) return;
      data.set("mode", preview ? "preview" : "generate");
      if (draftJob) {
        data.set("jobId", draftJob.id);
        data.set("jobCost", String(draftJob.subcontractor_cost));
        data.set("jobCompletedAt", draftJob.completed_at);
        data.set("jobReference", draftJob.reference ?? "");
      } else {
        data.set("lines", JSON.stringify(lines));
      }
    }
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const pdf = data.get("invoice");
      if (!generate && (!(pdf instanceof File) || pdf.size > 4_000_000)) throw new Error("Choose a PDF up to 4 MB.");
      const response = await fetch(url, {
        method: "POST", headers: { "x-tenant-id": tenantId }, body: data,
      });
      if (!generate && response.status === 413) throw new Error("Choose a PDF up to 4 MB.");
      if (preview && response.ok) {
        setPreviewUrl(URL.createObjectURL(await response.blob()));
        setMessage("Draft generated. Review the PDF before issuing.");
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to publish the invoice.");
      form.reset();
      setIssueDate(generate ? operatorToday() : "");
      setLines([blankLine()]);
      setDraftJob(null);
      setPreviewUrl("");
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
      <h2 className="text-md font-semibold">{generate ? `Generate a self-billing invoice for ${name}` : `Publish an invoice to ${name}`}</h2>
      {generate ? (
        <SignedOffJobs url={url} tenantId={tenantId} revision={revision} disabled={busy}
          selectedId={draftJob?.id} onSelect={selectDraft} />
      ) : null}
      <form key={draftJob?.id ?? "manual"} onSubmit={publish} onChange={(event) => {
        if (event.target instanceof HTMLInputElement && event.target.name === "selfBillingAgreement") return;
        if (previewUrl) setPreviewUrl("");
      }} className="mt-3 grid gap-3">
        <fieldset disabled={busy} className="m-0 grid min-w-0 gap-3 border-0 p-0">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="supplier-invoice-number" name="invoiceNumber" label="Invoice number" required maxLength={100}
            defaultValue={draftJob ? `SB-${(draftJob.reference || "JOB").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40)}-${draftJob.id.slice(0, 8).toUpperCase()}` : ""} />
          <Field id="supplier-invoice-date" name="issueDate" label="Invoice date" type="date" required
            value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
          <Field id="supplier-invoice-payment-date" name="expectedPaymentDate" label="Expected payment date"
            type="date" min={issueDate || undefined} aria-describedby="supplier-invoice-payment-help" />
          {generate ? (
            <Field id="supplier-invoice-supply-date" name="supplyDate" label="Supply date" type="date" required
              readOnly={Boolean(draftJob)} defaultValue={draftJob ? operatorToday(new Date(draftJob.completed_at)) : undefined} />
          ) : (
            <Field id="supplier-invoice-pdf" name="invoice" label="Issued invoice PDF (up to 4 MB)"
              type="file" accept="application/pdf,.pdf" required />
          )}
        </div>
        <p id="supplier-invoice-payment-help" className="m-0 text-xs text-ink-2">
          Leave the date blank to use the subcontractor’s payment terms. The expected date appears in their portal.
        </p>
        {generate ? (
          <div className="grid gap-3">
            <h3 className="text-sm font-semibold">Invoice lines</h3>
            {draftJob ? (
              <div className="grid items-end gap-2 rounded-md border border-line p-3 sm:grid-cols-3">
                <Field id="signed-off-description" label="Job reference" value={draftJob.reference || "Transport job"} readOnly />
                <Field id="signed-off-cost" label="Subcontractor cost (£)" value={Number(draftJob.subcontractor_cost).toFixed(2)} readOnly />
                <Select id="signed-off-vat" name="jobVat" label="VAT" required defaultValue="">
                  <option value="">Choose VAT</option>
                  <option value="none">No VAT</option>
                  <option value="0">0% (zero-rated)</option>
                  <option value="5">5%</option>
                  <option value="20">20%</option>
                </Select>
              </div>
            ) : lines.map((line, index) => (
              <div key={index} className="grid items-end gap-2 rounded-md border border-line p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <Field id={`self-billing-description-${index}`} label="Description / job reference" value={line.description}
                  required maxLength={300} onChange={(event) => editLine(index, "description", event.target.value)} />
                <Field id={`self-billing-quantity-${index}`} label="Quantity" type="number" min="0.01" step="0.01" required
                  value={line.quantity} onChange={(event) => editLine(index, "quantity", event.target.value)} />
                <Field id={`self-billing-price-${index}`} label="Unit price (£)" type="number" min="0.01" step="0.01" required
                  value={line.unitPrice} onChange={(event) => editLine(index, "unitPrice", event.target.value)} />
                <Select id={`self-billing-vat-${index}`} label="VAT" required value={line.vat}
                  onChange={(event) => editLine(index, "vat", event.target.value)}>
                  <option value="">Choose VAT</option>
                  <option value="none">No VAT</option>
                  <option value="0">0% (zero-rated)</option>
                  <option value="5">5%</option>
                  <option value="20">20%</option>
                </Select>
                {lines.length > 1 ? <Button type="button" variant="secondary" onClick={() => {
                  setLines((current) => current.filter((_, i) => i !== index));
                  setPreviewUrl("");
                }}>Remove</Button> : null}
              </div>
            ))}
            {!draftJob ? <div>
              <Button type="button" variant="secondary" disabled={lines.length >= 25} onClick={() => {
                setLines((current) => [...current, blankLine()]);
                setPreviewUrl("");
              }}>Add line</Button>
            </div> : null}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="selfBillingAgreement" />
              A self-billing agreement is in place with this subcontractor.
            </label>
          </div>
        ) : null}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          {generate ? (
            <>
              <Button type="submit" value="preview" variant="secondary" disabled={busy}>Generate draft PDF</Button>
              {previewUrl ? <a className="font-semibold text-primary underline" href={previewUrl}
                target="_blank" rel="noopener noreferrer">Open draft PDF</a> : null}
              <Button type="submit" loading={busy} disabled={!previewUrl}>Issue and publish</Button>
            </>
          ) : <Button type="submit" loading={busy}>Publish to portal</Button>}
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

function SignedOffJobs({ url, tenantId, revision, disabled, selectedId, onSelect }: {
  url: string; tenantId: string; revision: number; disabled: boolean;
  selectedId?: string; onSelect: (job: SignedOffJob | null) => void;
}) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ jobs: SignedOffJob[]; pagination: { hasMore: boolean } } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${url}?drafts=signed-off&page=${page}&pageSize=10`, {
      headers: { "x-tenant-id": tenantId }, cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load signed-off jobs.");
      if (!controller.signal.aborted) setResult(body);
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load signed-off jobs.");
    });
    return () => controller.abort();
  }, [url, tenantId, page, attempt, revision]);

  function loadPage(nextPage: number) {
    setResult(null);
    setError("");
    setPage(nextPage);
    setAttempt((value) => value + 1);
  }

  return (
    <section className="mt-3 rounded-md border border-line p-3" aria-label="Signed-off jobs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Signed-off jobs</h3>
        <div className="flex gap-2">
          {selectedId ? <Button type="button" variant="secondary" disabled={disabled} onClick={() => onSelect(null)}>Manual invoice</Button> : null}
          <Button type="button" variant="secondary" disabled={disabled} onClick={() => loadPage(page)}>Refresh jobs</Button>
        </div>
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {result ? (
        <>
          {result.jobs.length === 0 ? <p className="text-sm text-ink-2">No signed-off jobs awaiting self-billing.</p> : (
            <ul className="mt-2 divide-y divide-line">
              {result.jobs.map((job) => {
                const cost = Number(job.subcontractor_cost);
                const price = cost > 0 ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(cost) : "Subcontractor cost needed";
                return (
                  <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="text-sm">
                      <strong>{job.reference || "Transport job"}</strong>
                      <span className="ml-2 text-ink-2">{new Date(job.completed_at).toLocaleDateString("en-GB", { timeZone: "Europe/London" })} · {price}</span>
                    </div>
                    <Button type="button" variant="secondary" aria-pressed={selectedId === job.id}
                      disabled={disabled || !(cost > 0)} onClick={() => onSelect(job)}>
                      {selectedId === job.id ? "Reload draft" : "Review draft"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {page > 1 || result.pagination.hasMore ? (
            <div className="mt-2 flex items-center gap-3">
              <Button type="button" variant="secondary" disabled={disabled || page === 1} onClick={() => loadPage(page - 1)}>Previous</Button>
              <span>Page {page}</span>
              <Button type="button" variant="secondary" disabled={disabled || !result.pagination.hasMore} onClick={() => loadPage(page + 1)}>Next</Button>
            </div>
          ) : null}
        </>
      ) : !error ? <p role="status" className="text-sm text-ink-2">Loading signed-off jobs…</p> : null}
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

  async function download() {
    setFeedback(null);
    try {
      const response = await fetch(`${url}?download=${encodeURIComponent(invoice.id)}`, {
        headers: { "x-tenant-id": tenantId }, cache: "no-store",
      });
      if (!response.ok) throw new Error("Unable to download the invoice PDF.");
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = href;
      link.download = `${invoice.invoice_number.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (cause) {
      setFeedback({ text: cause instanceof Error ? cause.message : "Unable to download the invoice PDF.", error: true });
    }
  }

  return (
    <li className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{invoice.invoice_number}</strong>
        <Button type="button" variant="secondary" onClick={() => void download()}>Download PDF</Button>
      </div>
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
