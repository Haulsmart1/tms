'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Button from '../Button';
import type { AssistantArea, AssistantContext, AssistantProposal } from '../../lib/assistant/context';
import { operatorDay } from '../../lib/time';

type Result = {mode: 'local-guidance' | 'ai'; context: AssistantContext; proposals: AssistantProposal[]; providerConfigured: boolean; generatedAt?: string};
const LABELS: Record<string, string> = {
  reference: 'Job', status: 'Recorded status', progress: 'Progress', name: 'Customer',
  serviceDate: 'Service date', vehicleAssigned: 'Vehicle assigned', driverAssigned: 'Driver assigned',
  collectionCount: 'Collection stops', deliveryCount: 'Delivery stops', collectionETA: 'Collection ETA', deliveryETA: 'Delivery ETA',
  collectionLocations: 'Collection towns / postcodes', deliveryLocations: 'Delivery towns / postcodes',
  date: 'Review date', totalJobs: 'Total jobs', assignedJobs: 'Active assigned', unassignedJobs: 'Active unassigned',
  missingDrivers: 'Active jobs without drivers', collectedJobs: 'Collected, awaiting delivery', deliveredJobs: 'Delivered',
  currency: 'Currency', invoiceReference: 'Invoice', poReference: 'Purchase order',
};
const PROGRESS_LABELS: Record<string, string> = {pending: 'Awaiting collection', part_collected: 'Part collected', collected: 'Collected / on the van', delivered: 'Delivered'};
const KINDS: Record<AssistantProposal['kind'], string> = {
  summary: 'Summary', 'missing-information': 'Missing information', 'communication-draft': 'Draft — review before sending', 'next-step': 'Next step', explanation: 'Details',
};

/** The parent keys this component by tenant / area / record. Responses from a
 * previous scope are aborted on unmount and never rendered in the new scope. */
export default function AssistantReview({area, entityId, tenantId}: {area: AssistantArea; entityId?: string; tenantId: string}) {
  const inputId = useId();
  const [date, setDate] = useState(() => operatorDay(new Date()));
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const generation = useRef<AbortController | null>(null);
  const scope = {area, ...(entityId ? {entityId} : {}), ...(area === 'planning' ? {date} : {})};

  useEffect(() => {
    const abort = new AbortController();
    generation.current?.abort(); generation.current = null;
    setBusy(false); setLoading(true); setResult(null); setError(''); setCopied(null);
    const params = new URLSearchParams({area, ...(entityId ? {entityId} : {}), ...(area === 'planning' ? {date} : {})});
    fetch(`/api/assistant?${params}`, {headers: {'x-tenant-id': tenantId}, cache: 'no-store', signal: abort.signal})
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Assistant context is unavailable.');
        if (!abort.signal.aborted) setResult(body);
      }).catch(reason => {if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Assistant context is unavailable.');})
      .finally(() => {if (!abort.signal.aborted) setLoading(false);});
    return () => {abort.abort(); generation.current?.abort();};
  }, [area, entityId, tenantId, date]);

  const current = result?.context.tenantId === tenantId && result.context.area === area && result.context.entityId === entityId && (area !== 'planning' || result.context.facts.date === date) ? result : null;
  async function ask(prompt: string) {
    if (!prompt.trim() || generation.current || !current?.providerConfigured) return;
    const abort = new AbortController(); generation.current = abort;
    setBusy(true); setError(''); setCopied(null); setQuestion(prompt);
    // Clear an older model answer while a fresh snapshot is being reviewed.
    setResult({...current, mode: 'local-guidance', proposals: []});
    try {
      const response = await fetch('/api/assistant', {method: 'POST', headers: {'content-type': 'application/json', 'x-tenant-id': tenantId}, body: JSON.stringify({...scope, question: prompt}), signal: abort.signal, cache: 'no-store'});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'AI review is unavailable. Please try again.');
      if (!abort.signal.aborted) setResult(body);
    } catch (reason) {if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'AI review is unavailable.');}
    finally {if (generation.current === abort) {generation.current = null; setBusy(false);}}
  }
  async function copy(text: string, index: number) {
    try {await navigator.clipboard.writeText(text); setCopied(index);}
    catch {setError('Copy is unavailable. Select the draft text to copy it.');}
  }
  return <div className="min-w-0 text-sm">
    {area === 'planning' && <label className="mt-2 block">Review saved jobs for
      <input type="date" className="mt-1 block min-h-11 max-w-full rounded border border-line bg-surface px-2 text-ink" value={date} onChange={event => {generation.current?.abort(); setResult(null); setDate(event.target.value);}} />
    </label>}
    {loading && <p role="status" className="mt-2">Loading authorised context…</p>}
    {error && <p role="alert" className="mt-2 text-red-400">{error}</p>}
    {current && <>
      <p className="mt-2 text-xs text-ink-3">{current.mode === 'ai' ? 'AI review — check the suggestions before acting.' : 'Saved record facts. Ask AI for a review below.'}</p>
      <dl className="mt-2 grid gap-1">
        {Object.entries(current.context.facts).map(([key, value]) => <div key={key}><dt className="inline font-semibold">{LABELS[key] ?? key}: </dt><dd className="inline">{key === 'progress' ? (PROGRESS_LABELS[String(value)] ?? value) : (value ?? 'Not recorded')}</dd></div>)}
      </dl>
      {current.mode === 'local-guidance' && current.context.warnings.map((warning, index) => <p key={index} className="mt-2 text-ink-3">{warning}</p>)}
      {current.mode === 'ai' && <div aria-live="polite">
        {current.proposals.map((proposal, index) => <div key={index} className="mt-3 rounded border border-line p-3">
          <p className="font-semibold">{KINDS[proposal.kind]}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{proposal.text}</p>
          {proposal.kind === 'communication-draft' && <Button className="mt-2 min-h-11" variant="secondary" onClick={() => void copy(proposal.text, index)}>{copied === index ? 'Copied' : 'Copy draft'}</Button>}
        </div>)}
      </div>}
      {!current.providerConfigured ? <p className="mt-3">AI is not enabled. The saved facts above are still available.</p> : <>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="min-h-11" size="sm" variant="secondary" disabled={busy} onClick={() => void ask('Summarise this snapshot and the most useful next steps.')}>Review {area === 'planning' ? 'day' : 'record'}</Button>
          <Button className="min-h-11" size="sm" variant="secondary" disabled={busy} onClick={() => void ask('What information is missing or needs checking before the next step?')}>Check missing details</Button>
          {area === 'jobs' && entityId && <Button className="min-h-11" size="sm" variant="secondary" disabled={busy} onClick={() => void ask('Draft a short customer update based only on this job. Show placeholders for missing names or times; do not send it.')}>Draft customer update</Button>}
        </div>
        <form className="mt-3" onSubmit={event => {event.preventDefault(); void ask(question);}}>
          <label htmlFor={inputId} className="font-semibold">Ask about this {area === 'planning' ? 'day' : 'record'}</label>
          <textarea id={inputId} className="mt-1 block min-h-24 w-full rounded border border-line bg-surface p-2 text-ink" value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000} required disabled={busy} placeholder="What needs attention?" />
          <p className="mt-1 text-xs text-ink-3">Your question and the saved facts above go to Vercel AI. Answers are suggestions; drafts are not sent.</p>
          <Button type="submit" className="mt-2 min-h-11" disabled={busy || !question.trim()}>{busy ? 'Reviewing…' : 'Ask AI'}</Button>
          {busy && <Button type="button" className="ml-2 min-h-11" variant="ghost" onClick={() => {generation.current?.abort(); generation.current = null; setBusy(false);}}>Cancel</Button>}
        </form>
      </>}
    </>}
  </div>;
}
