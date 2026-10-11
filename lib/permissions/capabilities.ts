import { isOfficeCaller } from '../jobs/officeRoles';
import type { RoleTier } from '../auth/tenantAccess';

export const CAPABILITIES = ['jobs.view','jobs.create','jobs.edit','jobs.assign','customers.view','customers.edit','quotes.view','quotes.approve','planning.view','planning.assign','drivers.view','drivers.edit','vehicles.view','vehicles.edit','pod.view','pod.export','invoices.view','invoices.propose','invoices.approve','reports.view','compliance.view','compliance.approve','integrations.view','integrations.administer','users.administer','billing.administer','assistant.use'] as const;
export type Capability = typeof CAPABILITIES[number];
export interface CapabilityCaller { tier:RoleTier; roleName:string|null; hasActiveDriverLink:boolean; grants?:readonly Capability[] }
const ADMIN_ONLY = new Set<Capability>(['integrations.administer','users.administer','billing.administer','compliance.approve','invoices.approve']);
// Applies on top of existing tenant authorization and RLS. Explicit grants may
// restrict an office user but cannot turn a driver into an office administrator.
// Existing routes retain their current policy until deliberately migrated.
export function hasCapability(caller:CapabilityCaller,capability:Capability):boolean {
  if(!isOfficeCaller(caller)||!CAPABILITIES.includes(capability))return false;
  if(ADMIN_ONLY.has(capability)&&caller.tier!=='admin'&&caller.tier!=='super_admin')return false;
  return caller.grants===undefined||caller.grants.includes(capability);
}
