import { hasCapability, type Capability, type CapabilityCaller } from '../permissions/capabilities';
export type AssistantArea='jobs'|'planning'|'customers'|'invoices'|'compliance';
export interface AssistantContext {tenantId:string;area:AssistantArea;entityId?:string;facts:Record<string,string|number|null>;warnings:string[]}
export interface AssistantProposal {kind:'summary'|'missing-information'|'communication-draft'|'next-step'|'explanation';text:string;requiresApproval:true}
export interface AssistantProvider {propose(context:AssistantContext,question:string):Promise<AssistantProposal[]>}
const AREA_PERMISSION:Record<AssistantArea,Capability>={jobs:'jobs.view',planning:'planning.view',customers:'customers.view',invoices:'invoices.view',compliance:'compliance.view'};
const ALLOWED_FACTS:Record<AssistantArea,readonly string[]>={jobs:['reference','status','serviceDate','collectionCount','deliveryCount'],planning:['date','assignedJobs','unassignedJobs'],customers:['name','openJobs'],invoices:['invoiceReference','status','currency','netMinor','poReference'],compliance:['ruleId','classification','effectiveDate','source']};
export function projectAssistantContext(caller:CapabilityCaller,authorizedTenantId:string,input:AssistantContext):AssistantContext{
  if(input.tenantId!==authorizedTenantId||!Object.hasOwn(AREA_PERMISSION,input.area)||!hasCapability(caller,'assistant.use')||!hasCapability(caller,AREA_PERMISSION[input.area]))throw new Error('ASSISTANT_FORBIDDEN');
  const facts=Object.fromEntries(Object.entries(input.facts).filter(([key,value])=>ALLOWED_FACTS[input.area].includes(key)&&(typeof value==='string'&&value.length<=500||typeof value==='number'&&Number.isFinite(value)||value===null)));
  return{tenantId:authorizedTenantId,area:input.area,...(input.entityId?{entityId:input.entityId}:{}),facts,warnings:input.warnings.filter(w=>typeof w==='string').slice(0,20).map(w=>w.slice(0,1000))};
}
export class LocalGuidance implements AssistantProvider {
  async propose(context:AssistantContext):Promise<AssistantProposal[]>{
    return[{kind:'summary',text:`You are reviewing ${context.area}. This is local operational guidance, not a model-generated assessment.`,requiresApproval:true},...context.warnings.map(text=>({kind:'explanation' as const,text,requiresApproval:true as const})),{kind:'next-step',text:context.area==='invoices'?'Check the customer mapping, amounts, tax proposal and POD before approving any accounting transfer.':context.area==='planning'?'Review driver hours, vehicle eligibility and all scheduling conflicts before assigning work.':'Review the authorised record and missing fields before taking the next action.',requiresApproval:true}];
  }
}
export async function advise(provider:AssistantProvider,context:AssistantContext,question:string){if(question.length>2000)throw new Error('INVALID_QUESTION');const proposals=await provider.propose(context,question);if(!Array.isArray(proposals)||proposals.length>30||proposals.some(p=>!p||p.requiresApproval!==true||!['summary','missing-information','communication-draft','next-step','explanation'].includes(p.kind)||typeof p.text!=='string'||p.text.length>10000))throw new Error('INVALID_AI_PROPOSAL');return proposals.map(p=>({kind:p.kind,text:p.text,requiresApproval:true as const}));}
