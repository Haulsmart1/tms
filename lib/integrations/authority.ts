import {hasCapability,type CapabilityCaller} from '../permissions/capabilities';
import {installationAllows,type Installation,type IntegrationCapability} from './registry';
import {IntegrationError,validateProposal,proposalHash,type InvoiceProposal,type IntegrationOutbox} from './debbie';
export function requireIntegrationAuthority(caller:CapabilityCaller,tenantId:string,installation:Installation,capability:IntegrationCapability){
 if(!hasCapability(caller,'integrations.administer')||!installationAllows(installation,tenantId,capability))throw new IntegrationError('INTEGRATION_FORBIDDEN');
}
// Consequential enqueue requires verified tenant authority, explicit installation
// scope and an approved immutable proposal. The API caller must supply its
// authenticated principal, never take approver identity from arbitrary JSON.
export async function enqueueApprovedInvoice(input:{caller:CapabilityCaller;principalId:string;tenantId:string;installation:Installation;proposal:InvoiceProposal;outbox:IntegrationOutbox}){
 requireIntegrationAuthority(input.caller,input.tenantId,input.installation,'accounting.invoice-proposal');
 if(!hasCapability(input.caller,'invoices.approve')||input.proposal.tenantId!==input.tenantId||input.proposal.approvedBy!==input.principalId)throw new IntegrationError('INTEGRATION_FORBIDDEN');
 validateProposal(input.proposal);
 return input.outbox.enqueue({id:input.proposal.proposalId,tenantId:input.tenantId,proposal:structuredClone(input.proposal),hash:proposalHash(input.proposal),state:'queued',generation:0});
}
