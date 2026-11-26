"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Button from "../../../components/Button";
import Field from "../../../components/Field";
import type { BankStatus } from "../../../lib/accounts/subcontractorBank";

export default function BankDetails({ linkId, preview, visible }: { linkId: string; preview: boolean; visible: boolean }) {
  const [status, setStatus] = useState<BankStatus | null>(preview ? { latest: null, approved: null } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/subcontractor/bank-details?link=${encodeURIComponent(linkId)}`;

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const response = await fetch(url, { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load bank details.");
      setStatus(body);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Unable to load bank details.");
    }
  }, [url]);

  useEffect(() => {
    if (preview || !visible) return;
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus, preview, visible]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || preview || !status || status.latest?.status === "pending") return;
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const body = await response.json();
      if (response.status === 409) {
        form.reset();
        await loadStatus();
        return;
      }
      if (!response.ok) throw new Error(body.error || "Unable to submit bank details.");
      form.reset();
      setStatus({ ...status, latest: body.latest });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit bank details.");
    } finally {
      setBusy(false);
    }
  }

  const pending = status?.latest?.status === "pending";
  return (
    <section className="mt-5 grid gap-3 border-t border-line pt-4" aria-labelledby="bank-details-title">
      <h3 id="bank-details-title" className="font-semibold">Bank details</h3>
      <p className="text-sm">An administrator must approve new bank details before they take effect.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {!status && (error
        ? <div><Button variant="secondary" onClick={() => void loadStatus()}>Retry</Button></div>
        : <p role="status">Loading bank details…</p>)}
      {status && <>
        <p>{status.approved ? `Approved account ending ${status.approved.account_last_four}` : "No approved bank details."}</p>
        {pending && <p role="status">Account ending {status.latest?.account_last_four} is awaiting approval.</p>}
        {status.latest?.status === "rejected" && <p>The latest request was rejected. You can submit new details.</p>}
        {!pending && <form onSubmit={submit} className="grid gap-3" autoComplete="off">
          <fieldset disabled={preview || busy} className="grid gap-3 sm:grid-cols-3">
            <Field id="bank-name" name="accountName" label="Account holder" maxLength={120} required />
            <Field id="bank-sort" name="sortCode" label="Sort code" maxLength={8}
              pattern="[0-9]{6}|[0-9]{2}-[0-9]{2}-[0-9]{2}" required />
            <Field id="bank-account" name="accountNumber" label="Account number" maxLength={8}
              inputMode="numeric" pattern="[0-9]{8}" required />
          </fieldset>
          <div><Button type="submit" loading={busy} disabled={preview}>Submit for approval</Button></div>
        </form>}
      </>}
    </section>
  );
}
