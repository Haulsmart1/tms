'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
import {useTenant} from '../../app/components/TenantProvider';
import Button from '../Button';
import type {AssistantArea,AssistantProposal} from '../../lib/assistant/context';
import styles from './contextualAssistant.module.css';
const AREAS:Record<string,AssistantArea>={'/jobs':'jobs','/planning':'planning','/customers':'customers','/invoices':'invoices','/maintenance':'compliance','/tachograph':'compliance'};
export default function ContextualAssistant(){
 const path=usePathname();const tenant=useTenant();const area=AREAS[path];const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[proposals,setProposals]=useState<AssistantProposal[]>([]);const id=tenant.writeTenantId;
 useEffect(()=>{setOpen(false);setProposals([]);setError('');},[path,id]);
 useEffect(()=>{if(!open||!area||!id)return;const abort=new AbortController();setLoading(true);setError('');setProposals([]);fetch(`/api/assistant?area=${area}`,{headers:{'x-tenant-id':id},signal:abort.signal,cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||'Assistant unavailable.');setProposals(data.proposals);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[open,area,id]);
 if(!area||tenant.status!=='ready')return null;
 return <aside className={`ds font-sans text-ink ${styles.assistant}`} aria-label="TMS Assistant"><Button className={styles.touchTarget} variant="secondary" aria-expanded={open} aria-controls="tms-assistant-panel" onClick={()=>setOpen(!open)}>TMS Assistant</Button>{open&&<section id="tms-assistant-panel" className={`mt-2 rounded-lg border border-line bg-surface p-4 shadow-lg ${styles.panel}`}><h2 className="font-semibold">{area} guidance</h2><p className="text-xs text-ink-3">Local guidance · no AI provider connected · no actions are executed</p>{!id&&<p>Choose one tenant to continue.</p>}{loading&&<p role="status">Loading authorised context…</p>}{error&&<p role="alert">{error}</p>}{proposals.map((p,i)=><p className="mt-3 text-sm" key={`${p.kind}-${i}`}>{p.text}</p>)}<Button className={styles.touchTarget} variant="ghost" size="sm" onClick={()=>setOpen(false)}>Close guidance</Button></section>}</aside>;
}
