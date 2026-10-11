import { NextRequest,NextResponse } from 'next/server';
import { requireTenant,ApiError } from '../../../lib/api/server';
import { createAdminClient } from '../../../lib/supabase/admin';
import { hasActiveDriverLink } from '../../../lib/jobs/officeAccess';
import { projectAssistantContext,advise,LocalGuidance,type AssistantArea } from '../../../lib/assistant/context';
import { isUuid } from '../../../lib/auth/serverTenantAccess';
import { RULE_SOURCES } from '../../../lib/compliance/sources';
export const dynamic='force-dynamic';
// GET is read-only. Context is constructed from server-authorized rows; the
// browser cannot submit an arbitrary customer history or AI instructions.
export async function GET(request:NextRequest){
 try{
  const caller=await requireTenant(request);const area=request.nextUrl.searchParams.get('area') as AssistantArea;
  if(!['jobs','planning','customers','invoices','compliance'].includes(area))throw new ApiError(400,'Choose an operational area.');
  const driver=caller.tier==='staff'?await hasActiveDriverLink(createAdminClient(),caller.user.id):false;
  const entityId=request.nextUrl.searchParams.get('entityId')||undefined;const facts:Record<string,string|number|null>={};
  const context=projectAssistantContext({tier:caller.tier,roleName:caller.roleName,hasActiveDriverLink:driver},caller.tenantId,{tenantId:caller.tenantId,area,entityId,facts,warnings:[]});
  if(entityId){
   if(!isUuid(entityId)||!['jobs','customers','invoices'].includes(area))throw new ApiError(400,'Choose a valid record.');
   const select=area==='jobs'?'id,tenant_id,status':area==='customers'?'id,tenant_id,name':'id,tenant_id,invoice_number,status,currency,po_reference';
   const{data,error}=await caller.supabase.from(area).select(select).eq('tenant_id',caller.tenantId).eq('id',entityId).maybeSingle();
   if(error)throw new ApiError(503,'The record could not be loaded.');if(!data)throw new ApiError(404,'Record unavailable.');
   const row=data as unknown as Record<string,unknown>;
   const permitted=area==='customers'?['name']:area==='jobs'?['status']:['status','currency','po_reference'];
   for(const key of permitted)context.facts[key==='po_reference'?'poReference':key]=typeof row[key]==='string'?String(row[key]).slice(0,500):null;
   if(area==='invoices')context.facts.invoiceReference=typeof row.invoice_number==='string'?row.invoice_number.slice(0,500):null;
  }
  if(area==='compliance')context.warnings=RULE_SOURCES.map(r=>`${r.reference}: ${r.classification}. ${r.applicability}`);
  return NextResponse.json({mode:'local-guidance',context,proposals:await advise(new LocalGuidance(),context,''),sources:area==='compliance'?RULE_SOURCES:[],providerConfigured:false},{headers:{'Cache-Control':'no-store'}});
 }catch(error){const status=error instanceof ApiError?error.status:error instanceof Error&&error.message==='ASSISTANT_FORBIDDEN'?403:503;return NextResponse.json({error:status===403?'You cannot use the Assistant in this area.':error instanceof ApiError?error.message:'Assistant context is unavailable.'},{status,headers:{'Cache-Control':'no-store'}});}
}
