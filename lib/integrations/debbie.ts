import { createHash } from 'node:crypto';
import { isValidYmd } from '../invoices/dates';

export type DebbieStatus='received'|'validation-required'|'approved'|'posted'|'rejected'|'reversed'|'failed';
export interface CustomerMapping {tenantId:string;tmsCustomerId:string;debbieCompanyId:string;debbieCustomerId:string;approvedBy:string;approvedAt:string}
export interface InvoiceProposal {
  schema:'tms.debbie.invoice-proposal.v1';commercialEventId:string;idempotencyKey:string;tenantId:string;companyId:string;tmsJobId:string;tmsCustomerId:string;proposalId:string;
  accountingMapping:CustomerMapping;invoiceReference:string;serviceDate:string;currency:'GBP'|'EUR'|'USD';poReference?:string;
  lines:{description:string;quantity:string;netMinor:number;taxProposal:{code:string;ratePercent:string;authority:'proposal'}}[];
  supportingReferences:{kind:'job'|'pod';id:string}[];approvedBy:string;approvedAt:string;
}
export interface DebbieReceipt {schema:'debbie.tms.invoice-result.v1';commercialEventId:string;idempotencyKey:string;status:DebbieStatus;mode:'mock'|'live';accountingInvoiceId?:string;errorCode?:string}
export class IntegrationError extends Error {constructor(readonly code:string){super(code);}}
const id=(s:unknown):s is string=>typeof s==='string'&&s.trim().length>0&&s.length<=150;
export function validateProposal(p:InvoiceProposal){
  const m=p.accountingMapping;
  if(p.schema!=='tms.debbie.invoice-proposal.v1'||![p.tenantId,p.companyId,p.tmsJobId,p.tmsCustomerId,p.proposalId,p.commercialEventId,p.idempotencyKey,p.invoiceReference,p.approvedBy].every(id)||p.commercialEventId!==commercialEventId(p.tenantId,p.proposalId)||!m||m.tenantId!==p.tenantId||m.tmsCustomerId!==p.tmsCustomerId||![m.debbieCompanyId,m.debbieCustomerId,m.approvedBy].every(id)||!Number.isFinite(Date.parse(m.approvedAt))||!Number.isFinite(Date.parse(p.approvedAt)))throw new IntegrationError('MAPPING_OR_APPROVAL_REQUIRED');
  const date=isValidYmd(p.serviceDate);
  if(!date||!['GBP','EUR','USD'].includes(p.currency)||!Array.isArray(p.lines)||!p.lines.length||p.lines.length>100||p.lines.some(l=>!id(l.description)||!/^\d+(\.\d{1,6})?$/.test(l.quantity)||Number(l.quantity)<=0||!Number.isSafeInteger(l.netMinor)||l.netMinor<0||!l.taxProposal||l.taxProposal.authority!=='proposal'||!id(l.taxProposal.code)||!/^\d+(\.\d{1,4})?$/.test(l.taxProposal.ratePercent)||Number(l.taxProposal.ratePercent)>100))throw new IntegrationError('INVALID_INVOICE_PROPOSAL');
  if(!Array.isArray(p.supportingReferences)||p.supportingReferences.length>100||p.supportingReferences.some(r=>!['job','pod'].includes(r.kind)||!id(r.id)))throw new IntegrationError('INVALID_SUPPORTING_REFERENCE');
}
export function commercialEventId(tenantId:string,proposalId:string){return 'tms-invoice:'+createHash('sha256').update(JSON.stringify([tenantId,proposalId])).digest('hex');}
function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>[k,canonical(v)]));return value;}
export function proposalHash(p:InvoiceProposal){return createHash('sha256').update(JSON.stringify(canonical(p))).digest('hex');}
export interface DebbieAdapter {submit(proposal:InvoiceProposal):Promise<DebbieReceipt>}
// No network or ledger access. Independent durable idempotency belongs to both
// sender outbox and receiving Debbie API; this mock models receiver replay.
export class MockDebbieAdapter implements DebbieAdapter {
  private receipts=new Map<string,{hash:string;receipt:DebbieReceipt}>();
  async submit(p:InvoiceProposal){validateProposal(p);const key=JSON.stringify([p.tenantId,p.idempotencyKey]);const hash=proposalHash(p);const old=this.receipts.get(key);if(old){if(old.hash!==hash)throw new IntegrationError('IDEMPOTENCY_CONFLICT');return structuredClone(old.receipt);}
    const receipt:DebbieReceipt={schema:'debbie.tms.invoice-result.v1',commercialEventId:p.commercialEventId,idempotencyKey:p.idempotencyKey,status:'validation-required',mode:'mock'};this.receipts.set(key,{hash,receipt});return structuredClone(receipt);
  }
}
export interface OutboxJob {id:string;tenantId:string;proposal:InvoiceProposal;hash:string;state:'queued'|'sending'|'completed'|'failed';generation:number;leaseToken?:string;leaseExpiresAt?:number;receipt?:DebbieReceipt;errorCode?:string}
// Production repositories implement each method atomically in Postgres. Claim
// increments generation; finish requires token+generation+unexpired lease.
export interface IntegrationOutbox {
  enqueue(job:OutboxJob):Promise<'created'|'replay'>;
  claim(tenantId:string,id:string,token:string,now:number):Promise<OutboxJob|null>;
  finish(tenantId:string,id:string,token:string,generation:number,now:number,result:{receipt?:DebbieReceipt;errorCode?:string}):Promise<boolean>;
}
export async function processDebbie(outbox:IntegrationOutbox,adapter:DebbieAdapter,tenantId:string,jobId:string,token:string,now:()=>number){
  const job=await outbox.claim(tenantId,jobId,token,now());if(!job)return 'unclaimed';
  if(job.tenantId!==tenantId||job.proposal.tenantId!==tenantId)throw new IntegrationError('TENANT_MISMATCH');
  let result:{receipt?:DebbieReceipt;errorCode?:string};
  try{validateProposal(job.proposal);if(proposalHash(job.proposal)!==job.hash)throw new IntegrationError('PROPOSAL_CHANGED');const receipt=await adapter.submit(job.proposal);if(receipt.schema!=='debbie.tms.invoice-result.v1'||receipt.commercialEventId!==job.proposal.commercialEventId||receipt.idempotencyKey!==job.proposal.idempotencyKey||!['mock','live'].includes(receipt.mode)||!['received','validation-required','approved','posted','rejected','reversed','failed'].includes(receipt.status)||receipt.status==='posted'&&!id(receipt.accountingInvoiceId))throw new IntegrationError('INVALID_RECEIPT');result={receipt:{schema:receipt.schema,commercialEventId:receipt.commercialEventId,idempotencyKey:receipt.idempotencyKey,status:receipt.status,mode:receipt.mode,...(receipt.accountingInvoiceId?{accountingInvoiceId:receipt.accountingInvoiceId}:{})}};}
  catch(error){result={errorCode:error instanceof IntegrationError?error.code:'PROVIDER_UNAVAILABLE'};}
  return await outbox.finish(tenantId,jobId,token,job.generation,now(),result)?'finished':'fenced';
}
