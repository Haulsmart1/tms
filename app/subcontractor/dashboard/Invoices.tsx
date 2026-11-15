"use client";

import { useEffect, useState } from "react";
import Button from "../../../components/Button";

type Invoice = { id: string; invoice_number: string; issue_date: string };
type InvoicePage = { invoices: Invoice[]; hasNext: boolean };

export default function Invoices({ linkId }: { linkId: string }) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<InvoicePage | null>(null);
  const [error, setError] = useState("");
  const url = `/api/subcontractor/invoices?link=${encodeURIComponent(linkId)}`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${url}&page=${page}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load invoices.");
        setResult(body);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load invoices.");
      });
    return () => controller.abort();
  }, [url, page, attempt]);

  function goToPage(nextPage: number) {
    setError("");
    setResult(null);
    setPage(nextPage);
    setAttempt((value) => value + 1);
  }

  if (error) return <div className="grid gap-2"><p role="alert">{error}</p>
    <Button type="button" variant="secondary" onClick={() => goToPage(page)}>Retry</Button></div>;
  if (!result) return <p role="status">Loading invoices…</p>;

  return (
    <div className="grid gap-3">
      {result.invoices.length === 0 ? <p className="text-ink-3">No invoices published yet.</p> : (
        <ul className="grid gap-2">
          {result.invoices.map((invoice) => (
            <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3">
              <div><strong>{invoice.invoice_number}</strong>
                <p className="text-sm text-ink-3">{new Date(invoice.issue_date).toLocaleDateString("en-GB", { timeZone: "UTC" })}</p></div>
              <a className="font-semibold underline" href={`${url}&download=${encodeURIComponent(invoice.id)}`}
                aria-label={`Download invoice ${invoice.invoice_number} PDF`}>Download PDF</a>
            </li>
          ))}
        </ul>
      )}
      {(page > 1 || result.hasNext) && <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" disabled={page === 1} onClick={() => goToPage(page - 1)}>Previous</Button>
        <span>Page {page}</span>
        <Button type="button" variant="secondary" disabled={!result.hasNext} onClick={() => goToPage(page + 1)}>Next</Button>
      </div>}
    </div>
  );
}
