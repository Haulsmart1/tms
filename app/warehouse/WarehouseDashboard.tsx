"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Barcode, Boxes, CheckCircle2, PackageCheck, Truck } from "lucide-react";
import Button from "../../components/Button";
import TenantGate from "../components/TenantGate";
import { useTenant } from "../components/TenantProvider";
import { planningReturnHref } from "../../lib/planning/navigation";
import { WAREHOUSE_ACTION_LABELS, type WarehouseAction, type WarehouseJob, type WarehouseResult } from "../../lib/warehouse/types";
import type { ScannerCopy } from "../driver/CameraScanner";
import styles from "./warehouse.module.css";

const CameraScanner = dynamic(() => import("../driver/CameraScanner"), { ssr: false });
const scannerCopy: ScannerCopy = { open: "Use camera", title: "Warehouse scanner",
  aim: "Point the camera at a barcode or QR code.", scanning: "Looking for a barcode…",
  checking: "Finding the job…", manualEntry: "barcode or job reference",
  footer: "A matching job is added to your selection. Choose an action to save changes." };
const emptyOptions = { vehicles: [], drivers: [], plans: [] };
const filters = [{ value: "all", label: "All jobs" }, { value: "outstanding", label: "Outstanding" },
  { value: "collected", label: "Collected" }, { value: "delivered", label: "Delivered" }, { value: "unassigned", label: "Unassigned" }];

function jobState(job: WarehouseJob) {
  if (["completed", "delivered"].includes(job.status ?? "") || job.pod_status === "delivered") return "delivered";
  if (job.status === "collected" || job.stops.some(s => s.type === "collection" && s.pod_status === "collected")) return "collected";
  return "outstanding";
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Warehouse request failed. Please retry."; }

export default function WarehouseDashboard() {
  const tenant = useTenant();
  return <TenantGate><main className={`ds font-sans bg-canvas text-ink ${styles.page}`}>
    {tenant.status === "ready" && tenant.activeTenantId
      ? <WarehouseWorkspace key={tenant.activeTenantId} tenantId={tenant.activeTenantId} />
      : <><h1>Warehouse</h1><p>Select a workspace to scan and manage its jobs.</p></>}
  </main></TenantGate>;
}

export function WarehouseWorkspace({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<WarehouseResult | null>(null);
  const [selected, setSelected] = useState<Map<string, WarehouseJob>>(new Map());
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("scan");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [planId, setPlanId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const scanInput = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const operationLock = useRef(false);
  const retry = useRef<{ signature: string; id: string } | null>(null);
  const currentSearch = useRef({ query: "", exact: false, filter: "all", page: 0 });
  const options = data?.options ?? emptyOptions;
  const selectedPlan = options.plans.find(p => p.id === planId);

  const load = useCallback(async (search: typeof currentSearch.current) => {
    const seq = ++sequence.current;
    setLoading(true); setError(""); currentSearch.current = search;
    try {
      const params = new URLSearchParams({ tenantId, q: search.query, scan: search.exact ? "1" : "0", filter: search.filter, page: String(search.page) });
      const response = await fetch(`/api/warehouse?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Jobs could not be loaded.");
      if (sequence.current !== seq) return null;
      setData(result); setPage(search.page);
      return result as WarehouseResult;
    } catch (error) { if (sequence.current === seq) setError(errorMessage(error)); return null; }
    finally { if (sequence.current === seq) setLoading(false); }
  }, [tenantId]);

  useEffect(() => { void load({ query: "", exact: false, filter: "all", page: 0 }); return () => { sequence.current++; }; }, [load]);

  async function scan(value: string) {
    if (operationLock.current) return { ok: false, message: "Wait for the current save to finish." };
    const text = value.trim();
    if (!text) return { ok: false, message: "Scan or enter a barcode first." };
    setQuery(text); setMode("scan"); setFilter("all"); setMessage("");
    const result = await load({ query: text, exact: true, filter: "all", page: 0 });
    if (!result) return { ok: false, message: "The lookup failed. Please try again." };
    if (!result.total) { setMessage("No matching barcode. Choose Search jobs to find the name, address or reference."); return { ok: false, message: "No matching job. Search by name or address." }; }
    if (result.total === 1) {
      const job = result.jobs[0];
      setSelected(previous => {
        if (!previous.has(job.id) && previous.size >= 200) return previous;
        return new Map(previous).set(job.id, job);
      });
      if (selected.size >= 200 && !selected.has(job.id)) { setError("Save or clear your selection before adding more than 200 jobs."); return { ok: false, message: "Selection is full." }; }
      const msg = selected.has(job.id) ? `${job.reference || "Job"} is already selected.` : `${job.reference || "Job"} added. Ready for the next scan.`;
      setMessage(msg); setQuery(""); scanInput.current?.focus();
      return { ok: true, message: msg };
    }
    const msg = result.manifest ? `${result.total} jobs on this load. Select the jobs to update.` : `${result.total} jobs match. Select the correct job below.`;
    setMessage(msg); return { ok: true, message: msg };
  }

  function toggleJob(job: WarehouseJob) {
    setSelected(previous => {
      const next = new Map(previous);
      if (next.has(job.id)) next.delete(job.id);
      else if (next.size < 200) next.set(job.id, job);
      return next;
    });
  }
  function selectPage() {
    setSelected(previous => {
      const next = new Map(previous);
      for (const job of data?.jobs ?? []) if (next.size < 200 || next.has(job.id)) next.set(job.id, job);
      return next;
    });
  }
  async function apply(action: WarehouseAction) {
    if (operationLock.current || selected.size === 0) return;
    operationLock.current = true; setBusy(true); setError(""); setMessage("");
    const payload = { tenantId, action, jobIds: [...selected.keys()].sort(), note,
      ...(action === "move" ? { vehicleId: vehicleId || null, driverId: driverId || null, planId: planId || null,
        planningDate: selectedPlan?.planning_date || date || null } : {}) };
    const signature = JSON.stringify(payload);
    if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() };
    try {
      const response = await fetch("/api/warehouse/actions", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId: retry.current.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The changes could not be saved.");
      retry.current = null; setSelected(new Map()); setNote("");
      await load(currentSearch.current);
      const label = action === "collect" ? "collected" : action === "deliver" ? "delivered" : action === "reopen" ? "reopened for collection" : vehicleId ? "moved" : "unassigned";
      setMessage(`${result.result.count} job${result.result.count === 1 ? "" : "s"} ${label}. Saved successfully.`);
      scanInput.current?.focus();
    } catch (error) { setError(errorMessage(error)); }
    finally { operationLock.current = false; setBusy(false); }
  }

  return <>
    <header className={styles.header}><div><p className={styles.eyebrow}>OPERATIONS / WAREHOUSE</p>
      <h1><Boxes aria-hidden="true" /> Warehouse</h1><p>Scan, sign off and move jobs from one place.</p></div>
      <Link href="/planning" className={styles.link}>Back to planning →</Link></header>

    <div className={styles.stats}>{filters.slice(0, 4).map((item, index) => <button key={item.value}
      type="button" className={filter === item.value ? styles.activeStat : ""} disabled={busy || loading}
      onClick={() => { setFilter(item.value); setQuery(""); void load({ query: "", exact: false, filter: item.value, page: 0 }); }}>
      <span>{item.label}</span><strong>{data ? [data.stats.total, data.stats.outstanding, data.stats.collected, data.stats.delivered][index] : "—"}</strong>
    </button>)}</div>

    <section className={styles.scan} aria-label="Barcode scanner">
      <div className={styles.sectionTitle}><Barcode aria-hidden="true" /><h2>Scan a job</h2><span>USB scanner, camera or keyboard</span></div>
      <form className={styles.scanForm} onSubmit={event => { event.preventDefault(); if (busy || loading) return;
        if (mode === "scan") void scan(query); else { setMessage(""); void load({ query, exact: false, filter, page: 0 }); } }}>
        <label className={styles.field}>Find by<select value={mode} onChange={e => setMode(e.target.value)} disabled={busy || loading}>
          <option value="scan">Scan barcode</option><option value="search">Search jobs</option></select></label>
        <label className={`${styles.field} ${styles.grow}`}>{mode === "scan" ? "Barcode or job reference" : "Name, address, phone or reference"}
          <input ref={scanInput} autoFocus autoComplete="off" value={query} onChange={e => setQuery(e.target.value)}
            disabled={busy} placeholder={mode === "scan" ? "Scan here, then press Enter" : "Search across every job"} maxLength={250} /></label>
        <Button type="submit" disabled={busy || loading} loading={loading}>Find job</Button>
        <CameraScanner mode="all" copy={scannerCopy} disabled={busy || loading} onScan={scan} />
      </form>
      <p>Scans find matching item barcodes, job references and master load labels, including completed or cancelled jobs.</p>
    </section>

    <div aria-live="polite">{message && <p className={styles.message} role="status">{message}</p>}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}

    <div className={styles.workspace}>
      <section className={styles.results} aria-label="Warehouse jobs">
        <div className={styles.resultsHeader}><h2>{data?.total ?? 0} matching jobs</h2>
          <label className={styles.field}>Show<select value={filter} disabled={busy || loading} onChange={e => {
            setFilter(e.target.value); void load({ ...currentSearch.current, filter: e.target.value, page: 0 });
          }}>{filters.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
          <Button variant="secondary" size="sm" disabled={busy || loading || !data?.jobs.length} onClick={selectPage}>Select this page</Button>
          <Button variant="ghost" size="sm" disabled={busy || loading} onClick={() => void load(currentSearch.current)}>Refresh</Button></div>
        {loading && <p role="status">Loading jobs…</p>}
        {!loading && data?.jobs.length === 0 && <p className={styles.empty}>No jobs found. Try a different barcode or search.</p>}
        <div className={styles.jobs}>{data?.jobs.map(job => <article key={job.id} className={`${styles.job} ${styles[jobState(job)]}`}>
          <div className={styles.jobTop}><label className={styles.jobSelect}><input type="checkbox" checked={selected.has(job.id)}
            disabled={busy || (!selected.has(job.id) && selected.size >= 200)} onChange={() => toggleJob(job)} aria-label={`Select ${job.reference || job.id}`} />
            <strong>{job.reference || "Job without reference"}</strong></label>
            <span className={styles.badge}>{jobState(job) === "outstanding" ? job.status || "Planned" : jobState(job)}</span></div>
          <p className={styles.assignment}><Truck size={15} aria-hidden="true" />{options.vehicles.find(v => v.id === job.vehicle_id)?.registration || (job.vehicle_id ? "Assigned vehicle" : "Unassigned")}
            {job.driver_id && ` · ${options.drivers.find(d => d.id === job.driver_id)?.name || "Assigned driver"}`}
            {job.planning_date && ` · ${job.planning_date}`}</p>
          <div className={styles.stops}>{job.stops.map(stop => <div key={stop.id}><span className={styles.eyebrow}>{stop.type}</span>
            {stop.contact_name && <strong>{stop.contact_name}</strong>}<p>{[stop.address_line, stop.city, stop.postcode].filter(Boolean).join(", ")}</p>
            {stop.contact_phone && <a href={`tel:${stop.contact_phone}`}>{stop.contact_phone}</a>}
            {stop.contact_email && <a href={`mailto:${stop.contact_email}`}>{stop.contact_email}</a>}</div>)}</div>
          {job.barcodes.length > 0 && <div className={styles.barcodes}>{job.barcodes.map(code => <code key={code}>{code}</code>)}</div>}
          <Link href={`/jobs?job=${job.id}`} className={styles.link}>Open job / add photo or POD →</Link>
        </article>)}</div>
        <div className={styles.pagination}><Button variant="secondary" disabled={busy || loading || page === 0}
          onClick={() => void load({ ...currentSearch.current, page: page - 1 })}>Previous</Button>
          <span>Page {page + 1} of {Math.max(1, Math.ceil((data?.total ?? 0) / 50))}</span>
          <Button variant="secondary" disabled={busy || loading || (page + 1) * 50 >= (data?.total ?? 0)}
            onClick={() => void load({ ...currentSearch.current, page: page + 1 })}>Next</Button></div>
      </section>

      <aside className={styles.actions} aria-label="Selected job actions">
        <div className={styles.actionHeading}><h2>{selected.size} selected</h2><Button variant="ghost" size="sm" disabled={busy || !selected.size} onClick={() => setSelected(new Map())}>Clear</Button></div>
        <p>Scan more jobs to build a batch. Actions apply to the whole selected jobs.</p>
        {selected.size > 0 && <div className={styles.selection}>{[...selected.values()].map(job => <button key={job.id} type="button" disabled={busy}
          onClick={() => toggleJob(job)} aria-label={`Remove ${job.reference || job.id} from selection`}>{job.reference || job.id} ×</button>)}</div>}
        <label className={styles.field}>Warehouse note (optional)<textarea value={note} maxLength={2000} disabled={busy} onChange={e => setNote(e.target.value)} placeholder="Received by, bay number or reason for correction" /></label>
        <div className={styles.signoff}><Button disabled={busy || loading || !selected.size} onClick={() => void apply("collect")} variant="secondary"><PackageCheck size={18} aria-hidden="true" />Mark collected</Button>
          <Button disabled={busy || loading || !selected.size} onClick={() => void apply("deliver")}><CheckCircle2 size={18} aria-hidden="true" />Mark delivered</Button></div>
        <p className={styles.hint}>Delivery signs off all collection and delivery stops. Photos and POD documents can be added later.</p>
        <div className={styles.move}><h3>Move jobs</h3><p>Change the van, driver or saved plan at any job status.</p>
          <label className={styles.field}>Destination van<select value={vehicleId} disabled={busy} onChange={e => { setVehicleId(e.target.value); if (!e.target.value) { setDriverId(""); setPlanId(""); } }}>
            <option value="">Unassigned / warehouse</option>{options.vehicles.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}</select></label>
          <label className={styles.field}>Driver<select value={driverId} disabled={busy || !vehicleId} onChange={e => setDriverId(e.target.value)}>
            <option value="">No driver</option>{options.drivers.map(d => <option key={d.id} value={d.id}>{d.name || "Unnamed driver"}</option>)}</select></label>
          <label className={styles.field}>Saved plan<select value={planId} disabled={busy || !vehicleId} onChange={e => setPlanId(e.target.value)}>
            <option value="">Planning board only</option>{options.plans.map(p => <option key={p.id} value={p.id}>{p.name} · {p.planning_date}</option>)}</select></label>
          <label className={styles.field}>Planning date<input type="date" value={selectedPlan?.planning_date || date} disabled={busy || !!selectedPlan} onChange={e => setDate(e.target.value)} /></label>
          <Button disabled={busy || loading || !selected.size} variant="secondary" onClick={() => void apply("move")}>{vehicleId ? "Move selected jobs" : "Remove from van / plan"}</Button>
          {selectedPlan && <Link className={styles.link} href={planningReturnHref({ tenantId, date: selectedPlan.planning_date, planId, vehicleId: vehicleId || null })}>Open saved plan →</Link>}
        </div>
        <div className={styles.reopen}><h3>Correct a sign-off</h3><p>Reopen every stop for collection. Previous completion details stay in warehouse history.</p>
          <Button variant="secondary" disabled={busy || loading || !selected.size} onClick={() => void apply("reopen")}>Reopen for collection</Button></div>
        {busy && <p role="status">Saving warehouse changes…</p>}
      </aside>
    </div>
    <section className={styles.history}><h2>Recent warehouse activity</h2>{!data?.recent.length && <p>Saved warehouse actions will appear here.</p>}
      {data?.recent.map(entry => <div key={entry.request_id}><strong>{WAREHOUSE_ACTION_LABELS[entry.action]} · {entry.result.count} jobs</strong>
        <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("en-GB")}</time><p>{entry.result.references.join(", ")}</p>{entry.note && <p>{entry.note}</p>}</div>)}</section>
  </>;
}
