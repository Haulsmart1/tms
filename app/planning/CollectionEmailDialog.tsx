"use client";

import { useEffect, useRef, useState } from "react";
import type { PlanJob } from "../../lib/planning/types";
import type { CollectionEmailKind, CollectionEmailOptions, CollectionEmailPreview } from "../../lib/planning/collectionEmail";

const control = "min-h-11 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-40";
type Result = { status: string; message: string };

export default function CollectionEmailDialog({ jobs, date, kind, vehicleRegistration, onClose }: {
  jobs: PlanJob[]; date: string; kind: CollectionEmailKind; vehicleRegistration: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [collectionDate, setCollectionDate] = useState(date);
  const [window, setWindow] = useState<"AM" | "PM">("AM");
  const [collectedAt, setCollectedAt] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [confirmed, setConfirmed] = useState(false);
  const [rows, setRows] = useState<CollectionEmailPreview[]>([]);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const receipt = kind === "collection_receipt";
  useEffect(() => { dialog.current?.showModal(); }, []);

  function options(): CollectionEmailOptions {
    return { kind, date: collectionDate, window, collectedAt: collectedAt && Number.isFinite(new Date(collectedAt).getTime()) ? new Date(collectedAt).toISOString() : "" };
  }
  function changed() { setRows([]); setResults({}); setError(""); }
  async function request(body: Record<string, unknown>) {
    const response = await fetch("/api/planning/collection-email", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || "Unable to reach the email service. Try again.");
    return value;
  }
  async function preview() {
    setBusy("preview"); setError(""); setRows([]); setResults({});
    try {
      const tenantId = jobs[0]?.tenant_id;
      if (!tenantId || jobs.some((job) => job.tenant_id !== tenantId)) throw new Error("Select one workspace before emailing collections.");
      const value = await request({ action: "preview", tenantId, jobIds: jobs.map((job) => job.id), options: options() });
      setRows(value.rows);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to preview emails."); }
    finally { setBusy(null); }
  }
  async function send() {
    setBusy("send"); setError("");
    const remaining = rows.filter((row) => !row.issue && !results[row.jobId]);
    // Each contact has its own bounded request and durable duplicate guard.
    // Partial success is kept visible; retrying never repeats accepted emails.
    for (const row of remaining) {
      let result: Result;
      try {
        result = await request({ action: "send", tenantId: row.tenantId, jobIds: [row.jobId], options: options(),
          fingerprint: row.fingerprint, confirmCollected: confirmed });
      } catch (err) { result = { status: "failed", message: err instanceof Error ? err.message : "Send could not be confirmed." }; }
      setResults((previous) => ({ ...previous, [row.jobId]: result }));
    }
    setBusy(null);
  }
  const ready = rows.filter((row) => !row.issue && !results[row.jobId]).length;
  const sent = Object.values(results).filter((r) => r.status === "accepted").length;
  const already = Object.values(results).filter((r) => r.status === "already_sent").length;
  const problems = rows.filter((r) => r.issue).length + Object.values(results).filter((r) => !["accepted", "already_sent"].includes(r.status)).length;

  return (
    <dialog ref={dialog} aria-labelledby="collection-email-title" onClose={onClose}
      onCancel={(event) => { if (busy) event.preventDefault(); }} onClick={(event) => event.stopPropagation()}
      className="m-auto w-[min(46rem,95vw)] max-h-[90vh] overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/60">
      <h2 id="collection-email-title" className="text-lg font-semibold">{receipt ? "Email collection receipt" : "Email collection appointments"}</h2>
      <p className="mt-1 text-sm text-ink-3">{vehicleRegistration} · {jobs.length} {jobs.length === 1 ? "job" : "jobs"}</p>
      <form onSubmit={(event) => { event.preventDefault(); void preview(); }} className="mt-4 grid gap-3">
        {receipt ? <>
          <label className="grid gap-1 text-sm">Actual collection date and time ({Intl.DateTimeFormat().resolvedOptions().timeZone})
            <input type="datetime-local" required disabled={Boolean(busy)} value={collectedAt} className={control}
              onChange={(event) => { setCollectedAt(event.target.value); changed(); }} />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={(event) => setConfirmed(event.target.checked)} />
            I confirm these goods have been collected.
          </label>
        </> : <div className="flex flex-wrap gap-3">
          <label className="grid gap-1 text-sm">Collection date
            <input type="date" required disabled={Boolean(busy)} value={collectionDate} className={control}
              onChange={(event) => { setCollectionDate(event.target.value); changed(); }} />
          </label>
          <label className="grid gap-1 text-sm">Collection window (UK time)
            <select value={window} disabled={Boolean(busy)} className={control} onChange={(event) => { setWindow(event.target.value as "AM" | "PM"); changed(); }}>
              <option value="AM">AM · 09:00–12:00</option><option value="PM">PM · 12:00–17:00</option>
            </select>
          </label>
        </div>}
        <button type="submit" disabled={Boolean(busy)} className={`${control} justify-self-start`}>{busy === "preview" ? "Loading contacts…" : "Preview emails"}</button>
      </form>
      {error ? <p role="alert" className="mt-3 text-sm text-warning">{error}</p> : null}
      {rows.length > 0 ? <div className="mt-4 grid gap-2">
        <p className="text-sm" aria-live="polite">{ready} ready · {sent} sent · {already} already sent · {problems} need attention</p>
        <p className="text-xs text-ink-3">Each contact receives their own email. Open a row to read its message.</p>
        {rows.map((row) => <details key={row.jobId} className="rounded-md border border-line p-3">
          <summary className="cursor-pointer text-sm">
            <strong>{row.reference}</strong> · {row.name || "No contact name"} · {row.email || "No email"}
            <span className={`mt-1 block ${row.issue || results[row.jobId]?.status === "failed" ? "text-warning" : "text-ink-3"}`}>{row.issue || results[row.jobId]?.message || "Ready to send"}</span>
          </summary>
          <p className="mt-3 text-sm font-semibold">{row.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-ink-2">{row.text}</pre>
        </details>)}
      </div> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" disabled={Boolean(busy)} className={control} onClick={onClose}>Close</button>
        <button type="button" disabled={Boolean(busy) || ready === 0 || (receipt && !confirmed)}
          className={`${control} bg-primary font-semibold`} onClick={() => void send()}>
          {busy === "send" ? "Sending…" : receipt ? "Send collection receipt" : `Send ${ready} collection emails`}
        </button>
      </div>
    </dialog>
  );
}
