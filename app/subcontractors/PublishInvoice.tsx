"use client";

import { useState, type FormEvent } from "react";
import Button from "../../components/Button";
import Field from "../../components/Field";

export default function PublishInvoice({ id, tenantId, name }: { id: string; tenantId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

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
      const response = await fetch(`/api/subcontractors/${encodeURIComponent(id)}/invoices`, {
        method: "POST", headers: { "x-tenant-id": tenantId }, body: data,
      });
      if (response.status === 413) throw new Error("Choose a PDF up to 4 MB.");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to publish the invoice.");
      form.reset();
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
          <Field id="supplier-invoice-date" name="issueDate" label="Invoice date" type="date" required />
          <Field id="supplier-invoice-pdf" name="invoice" label="Issued invoice PDF (up to 4 MB)"
            type="file" accept="application/pdf,.pdf" required />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy}>Publish to portal</Button>
          {message && <p role={error ? "alert" : "status"} className={error ? "text-danger" : "text-success"}>{message}</p>}
        </div>
      </form>
    </section>
  );
}
