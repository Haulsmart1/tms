import type { Capability } from '../permissions/capabilities';
export type IntegrationCapability='accounting.invoice-proposal'|'accounting.customer-mapping'|'mapping.routes'|'email.drafts'|'telematics.positions'|'ai.proposals'|'documents.signatures';
export interface IntegrationDescriptor {id:string;name:string;category:string;capabilities:readonly IntegrationCapability[];requiredPermission:Capability;mode:'existing'|'mock'|'unavailable';description:string;settingsHref?:string}
export const INTEGRATIONS:readonly IntegrationDescriptor[]=[
  {id:'debbie',name:'Debbie Accounts',category:'Accounting',capabilities:['accounting.invoice-proposal','accounting.customer-mapping'],requiredPermission:'integrations.administer',mode:'mock',description:'Versioned invoice proposals with explicit customer mappings. Mock adapter only; no accounting connection.'},
  {id:'xero',name:'Xero',category:'Accounting',capabilities:['accounting.invoice-proposal'],requiredPermission:'integrations.administer',mode:'existing',description:'Existing authorised accounting integration. Connection status remains in Invoices.',settingsHref:'/invoices'},
  {id:'tomtom',name:'TomTom',category:'Mapping',capabilities:['mapping.routes'],requiredPermission:'integrations.administer',mode:'existing',description:'Existing routing estimates used by Planning. Does not certify HGV eligibility.',settingsHref:'/planning'},
  {id:'graph',name:'Microsoft Graph',category:'Email',capabilities:['email.drafts'],requiredPermission:'integrations.administer',mode:'existing',description:'Existing document-email service. Emails still require the existing explicit action.',settingsHref:'/settings/documents'},
  {id:'assistant',name:'TMS Assistant',category:'AI',capabilities:['ai.proposals'],requiredPermission:'integrations.administer',mode:'unavailable',description:'Provider-neutral advisory boundary. Local guidance is available without an AI provider.'},
];
export function integration(id:string):IntegrationDescriptor|null{return INTEGRATIONS.find(p=>p.id===id)||null;}
export interface Installation {id:string;tenantId:string;providerId:string;status:'unconfigured'|'connected'|'error'|'revoked';approvedCapabilities:IntegrationCapability[];secretReference?:string;lastSyncAt?:string;lastErrorCode?:string}
export function publicInstallation(value:Installation){const{secretReference,...safe}=value;return safe;}
export function installationAllows(value:Installation,tenantId:string,capability:IntegrationCapability){const p=integration(value.providerId);return value.tenantId===tenantId&&value.status==='connected'&&!!p&&p.capabilities.includes(capability)&&value.approvedCapabilities.includes(capability);}
