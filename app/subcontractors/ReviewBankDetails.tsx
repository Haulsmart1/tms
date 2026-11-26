"use client";

import { useState } from "react";
import Button from "../../components/Button";
import type { BankDetails } from "../../lib/accounts/subcontractorBank";

type Review = {
  pending: { id: string; submittedAt: string; canReview: boolean; details: BankDetails } | null;
  approved: { reviewedAt: string; details: BankDetails } | null;
};

export default function ReviewBankDetails({ id, tenantId, name }: { id: string; tenantId: string; name: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const url = `/api/subcontractors/${encodeURIComponent(id)}/bank-details`;
  const headers = { "Content-Type": "application/json", "x-tenant-id": tenantId };

  async function load() {
    const response = await fetch(url, { headers, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load bank details.");
    setReview(body);
  }

  async function act(decision?: "approved" | "rejected") {
    if (busy) return;
    const pending = review?.pending;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (decision && pending?.canReview) {
        const response = await fetch(url, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ requestId: pending.id, decision }),
        });
        const body = await response.json();
        if (response.status === 409) {
          setReview(null);
          await load();
        }
        if (!response.ok) throw new Error(body.error || "Unable to review bank details.");
        setReview(null);
        setMessage(decision === "approved" ? "Bank details approved." : "Bank details rejected.");
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to process bank details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <h2 className="text-md font-semibold">Bank details · {name}</h2>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!review ? <div><Button variant="secondary" loading={busy} onClick={() => void act()}>View bank details</Button></div> : <>
        <div><Button variant="secondary" disabled={busy} onClick={() => setReview(null)}>Hide bank details</Button></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h3 className="font-semibold">Approved account</h3>
            {review.approved ? <AccountDetails details={review.approved.details} /> : <p>No approved bank details.</p>}
          </div>
          <div>
            <h3 className="font-semibold">Awaiting review</h3>
            {review.pending ? <>
              <AccountDetails details={review.pending.details} />
              {review.pending.canReview ? <div className="mt-2 flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void act("approved")}>Approve bank details</Button>
                <Button variant="secondary" disabled={busy} onClick={() => void act("rejected")}>Reject request</Button>
              </div> : <p>Another administrator must review your submission.</p>}
            </> : <p>No pending request.</p>}
          </div>
        </div>
      </>}
    </section>
  );
}

function AccountDetails({ details }: { details: BankDetails }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
      <dt>Account holder</dt><dd>{details.accountName}</dd>
      <dt>Sort code</dt><dd>{details.sortCode.match(/../g)?.join("-")}</dd>
      <dt>Account number</dt><dd>{details.accountNumber}</dd>
    </dl>
  );
}
