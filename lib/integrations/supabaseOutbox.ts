import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { IntegrationError, validateProposal, proposalHash, type IntegrationOutbox, type OutboxJob, type DebbieReceipt } from './debbie';

// Only a server-authenticated, capability-authorized caller may construct this
// repository. RPCs are service-role-only; no browser writes or direct Debbie DB.
export class SupabaseIntegrationOutbox implements IntegrationOutbox {
  constructor(private db:SupabaseClient){}
  async enqueue(job:OutboxJob):Promise<'created'|'replay'>{
    validateProposal(job.proposal);
    if(job.tenantId!==job.proposal.tenantId||job.hash!==proposalHash(job.proposal)||job.id!==job.proposal.proposalId)throw new IntegrationError('PROPOSAL_CHANGED');
    const{data,error}=await this.db.rpc('integration_enqueue_v1',{p_tenant:job.tenantId,p_id:job.id,p_key:job.proposal.idempotencyKey,p_hash:job.hash,p_proposal:job.proposal});
    if(error||!['created','replay'].includes(data))throw new IntegrationError('OUTBOX_UNAVAILABLE');return data;
  }
  async claim(tenantId:string,id:string,token:string,_now:number):Promise<OutboxJob|null>{
    const{data,error}=await this.db.rpc('integration_claim_v1',{p_tenant:tenantId,p_id:id,p_token:token});if(error)throw new IntegrationError('OUTBOX_UNAVAILABLE');return data as OutboxJob|null;
  }
  async finish(tenantId:string,id:string,token:string,generation:number,_now:number,result:{receipt?:DebbieReceipt;errorCode?:string}){
    const{data,error}=await this.db.rpc('integration_finish_v1',{p_tenant:tenantId,p_id:id,p_token:token,p_generation:generation,p_result:result});if(error)throw new IntegrationError('OUTBOX_UNAVAILABLE');return data===true;
  }
}
