'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
import {useTenant} from '../../app/components/TenantProvider';
import Button from '../Button';
import type {AssistantArea} from '../../lib/assistant/context';
import AssistantReview from './AssistantReview';
import styles from './contextualAssistant.module.css';
const AREAS:Record<string,AssistantArea>={'/jobs':'jobs','/planning':'planning','/customers':'customers','/invoices':'invoices','/maintenance':'compliance','/tachograph':'compliance'};
export default function ContextualAssistant(){
 const path=usePathname();const tenant=useTenant();const area=AREAS[path];const [open,setOpen]=useState(false);const id=tenant.writeTenantId;
 useEffect(()=>{setOpen(false);},[path,id]);
 if(!area||tenant.status!=='ready')return null;
 return <aside className={`ds font-sans text-ink ${styles.assistant}`} aria-label="TMS Assistant">
  <Button className={styles.touchTarget} variant="secondary" aria-expanded={open} aria-controls="tms-assistant-panel" onClick={()=>setOpen(!open)}>TMS Assistant</Button>
  {open&&<section id="tms-assistant-panel" className={`mt-2 rounded-lg border border-line bg-surface p-4 shadow-lg ${styles.panel}`}>
    <h2 className="font-semibold">TMS Assistant</h2>
    {id?<AssistantReview key={`${id}:${area}`} tenantId={id} area={area}/>:<p>Choose one tenant to continue.</p>}
    <Button className={styles.touchTarget} variant="ghost" size="sm" onClick={()=>setOpen(false)}>Close guidance</Button>
  </section>}
 </aside>;
}
