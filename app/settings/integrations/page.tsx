'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import TenantGate from '../../components/TenantGate';
import {useTenant} from '../../components/TenantProvider';
import MessageBanner from '../../../components/MessageBanner';
import type {IntegrationDescriptor} from '../../../lib/integrations/registry';
export default function IntegrationsPage(){
 const tenant=useTenant();const [providers,setProviders]=useState<IntegrationDescriptor[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const id=tenant.writeTenantId;
 useEffect(()=>{if(tenant.status!=='ready'||!id){setProviders([]);return;}const abort=new AbortController();setLoading(true);setError('');setProviders([]);fetch('/api/integrations/catalogue',{headers:{'x-tenant-id':id},signal:abort.signal,cache:'no-store'}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||'Integrations unavailable.');setProviders(body.integrations);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[tenant.status,id]);
 return <TenantGate><div className="ds min-h-screen bg-canvas font-sans text-ink"><main className="mx-auto max-w-[1480px] px-6 py-8"><Link href="/settings" className="text-primary underline">Back to settings</Link><h1 className="mt-4 text-xl font-semibold">Integrations</h1><p className="text-sm text-ink-3">Review providers and the capabilities they can access. Installation never grants unrestricted tenant data.</p><MessageBanner tone={error?'danger':'info'}>{error||(!id?'Choose one tenant to review its integrations.':loading?'Loading integrations…':'No new external integration is activated here. Existing integrations retain their own connection controls.')}</MessageBanner><div className="mt-6 grid gap-4 md:grid-cols-2">{providers.map(p=><article key={p.id} className="rounded-lg border border-line bg-surface p-5"><h2 className="text-lg font-semibold">{p.name}</h2><p className="text-sm text-ink-3">{p.category} · {p.mode==='mock'?'Mock only':p.mode==='existing'?'Existing integration; status not checked here':'Not configured'}</p><p className="my-3 text-sm">{p.description}</p><p className="text-xs text-ink-3">Capabilities: {p.capabilities.join(', ')}</p>{p.settingsHref&&<Link href={p.settingsHref} className="mt-4 inline-block text-primary underline">Open {p.name} settings</Link>}</article>)}</div></main></div></TenantGate>;
}
