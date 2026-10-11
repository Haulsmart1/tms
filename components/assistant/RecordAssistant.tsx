"use client";

import { useEffect, useId, useState } from "react";
import Button from "../Button";
import { useTenant } from "../../app/components/TenantProvider";
import type { AssistantContext, AssistantProposal } from "../../lib/assistant/context";

const FACT_LABELS: Record<string, string> = {
  status: "Status", name: "Customer", currency: "Currency",
  invoiceReference: "Invoice", poReference: "Purchase order",
};

/** Loads only server-authorised, projected context after an explicit request. */
export default function RecordAssistant({ area, entityId }: {
  area: "jobs" | "customers" | "invoices";
  entityId: string;
}) {
  const tenant = useTenant();
  const tenantId = tenant.writeTenantId;
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ context: AssistantContext; proposals: AssistantProposal[] } | null>(null);

  useEffect(() => {
    setOpen(false);
    setResult(null);
    setError("");
  }, [area, entityId, tenantId]);

  useEffect(() => {
    if (!open || !tenantId || tenant.status !== "ready") return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setResult(null);
    const params = new URLSearchParams({ area, entityId });
    fetch(`/api/assistant?${params}`, {
      headers: { "x-tenant-id": tenantId }, signal: abort.signal, cache: "no-store",
    }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Record guidance is unavailable.");
      if (!abort.signal.aborted) setResult(body);
    }).catch(reason => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Record guidance is unavailable.");
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [open, tenantId, tenant.status, area, entityId]);

  if (tenant.status !== "ready" || !tenantId) return null;
  // A changed selection must not render the previous record's response while
  // the effect clears state; compare the server-attributed identity as well.
  const current = result?.context.entityId === entityId && result.context.tenantId === tenantId && result.context.area === area ? result : null;
  return (
    <div className="mt-4">
      <Button variant="secondary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
        {open ? "Close record guidance" : "Review this record with Assistant"}
      </Button>
      {open && <section id={panelId} aria-label="Selected record guidance" className="mt-3 rounded-lg border border-line bg-surface p-4">
        <p className="text-xs text-ink-3">Local guidance. Review before acting.</p>
        {loading && <p role="status">Loading authorised record…</p>}
        {error && <p role="alert">{error}</p>}
        {current && <>
          <dl className="mt-2 grid gap-1 text-sm">
            {Object.entries(current.context.facts).map(([key, value]) => <div key={key}><dt className="inline font-semibold">{FACT_LABELS[key] ?? key}: </dt><dd className="inline">{value ?? "Not recorded"}</dd></div>)}
          </dl>
          {current.proposals.map((proposal, index) => <p key={`${proposal.kind}-${index}`} className="mt-2 text-sm">{proposal.text}</p>)}
        </>}
      </section>}
    </div>
  );
}
