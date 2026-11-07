import 'server-only';
import { z } from 'zod';
import { ApiError, requireTenant } from '../api/server';
import { createAdminClient } from '../supabase/admin';
import { hasActiveDriverLink } from '../jobs/officeAccess';
import { projectAssistantContext, type AssistantContext } from './context';
import { RULE_SOURCES } from '../compliance/sources';
import { operatorDay } from '../time';
import { planningJobProgress } from '../planning/jobProgress';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
export const contextInputSchema = z.strictObject({
  area: z.enum(['jobs', 'planning', 'customers', 'invoices', 'compliance']),
  entityId: z.uuid().optional(),
  date: dateSchema.optional(),
});
export const questionInputSchema = contextInputSchema.extend({question: z.string().trim().min(1).max(2000)});
type Caller = Awaited<ReturnType<typeof requireTenant>>;
type Input = z.infer<typeof contextInputSchema>;
const text = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 500) || null : null;

/** Every read uses the authenticated client plus an explicit tenant predicate.
 * Only bounded operational facts go to AI; no attachments, notes, credentials,
 * full addresses, telephone numbers or email addresses are included. */
export async function loadAssistantContext(caller: Caller, input: Input): Promise<AssistantContext> {
  const driver = caller.tier === 'staff' ? await hasActiveDriverLink(createAdminClient(), caller.user.id) : false;
  const permissions = {tier: caller.tier, roleName: caller.roleName, hasActiveDriverLink: driver};
  const context = projectAssistantContext(permissions, caller.tenantId, {
    tenantId: caller.tenantId, area: input.area, entityId: input.entityId, facts: {}, warnings: [],
  });
  if (input.entityId && !['jobs', 'customers', 'invoices'].includes(input.area)) throw new ApiError(400, 'Choose a valid record.');
  if (input.date && input.area !== 'planning') throw new ApiError(400, 'Choose a date in Planning.');
  if (input.entityId) {
    const select = input.area === 'jobs'
      ? 'id,tenant_id,reference,status,scheduled_date,planning_date,vehicle_id,driver_id,collection_eta,delivery_eta,job_stops(type,stop_order,status,pod_status,collected_at,delivered_at,city,postcode,contact_name,contact_phone,contact_email)'
      : input.area === 'customers' ? 'id,tenant_id,name' : 'id,tenant_id,invoice_number,status,currency,po_reference';
    const {data, error} = await caller.supabase.from(input.area).select(select).eq('tenant_id', caller.tenantId).eq('id', input.entityId).maybeSingle();
    if (error) throw new ApiError(503, 'The record could not be loaded.');
    if (!data) throw new ApiError(404, 'Record unavailable.');
    const row = data as unknown as Record<string, unknown>;
    if (input.area === 'jobs') {
      const stops = (Array.isArray(row.job_stops) ? row.job_stops : []) as Array<{
        type: string; stop_order?: number; status?: string; pod_status?: string;
        collected_at?: string; delivered_at?: string; city?: string; postcode?: string;
        contact_name?: string; contact_phone?: string; contact_email?: string;
      }>;
      const collections = stops.filter(s => s.type === 'collection');
      const deliveries = stops.filter(s => s.type === 'delivery');
      context.facts = {
        reference: text(row.reference), status: text(row.status),
        progress: planningJobProgress({status: text(row.status), stops}),
        serviceDate: text(row.planning_date) ?? text(row.scheduled_date),
        vehicleAssigned: row.vehicle_id ? 'Yes' : 'No', driverAssigned: row.driver_id ? 'Yes' : 'No',
        collectionCount: collections.length, deliveryCount: deliveries.length,
        collectionETA: text(row.collection_eta), deliveryETA: text(row.delivery_eta),
        collectionLocations: collections.map(s => [text(s.city), text(s.postcode)].filter(Boolean).join(' ')).join('; ').slice(0, 500) || null,
        deliveryLocations: deliveries.map(s => [text(s.city), text(s.postcode)].filter(Boolean).join(' ')).join('; ').slice(0, 500) || null,
      };
      if (!context.facts.serviceDate) context.warnings.push('No service date recorded.');
      if (!row.vehicle_id) context.warnings.push('No vehicle assigned.');
      if (!row.driver_id) context.warnings.push('No driver assigned.');
      if (!collections.length) context.warnings.push('No collection stops recorded.');
      if (!deliveries.length) context.warnings.push('No delivery stops recorded.');
      for (const stop of [...stops].sort((a,b) => (a.stop_order ?? 0) - (b.stop_order ?? 0)).slice(0,12)) {
        const missing = [['name', stop.contact_name], ['telephone', stop.contact_phone], ['email', stop.contact_email], ['postcode', stop.postcode]].filter(([,v]) => !text(v)).map(([label]) => label);
        if (missing.length) context.warnings.push(`${stop.type} stop ${stop.stop_order ?? '?'}: missing ${missing.join(', ')}.`);
        if ([stop.status, stop.pod_status].some(v => ['failed', 'cancelled', 'canceled'].includes(v ?? ''))) context.warnings.push(`${stop.type} stop ${stop.stop_order ?? '?'} has a failed or cancelled status; check before arranging another visit.`);
      }
      if (stops.length > 12) context.warnings.push('Contact checks cover the first 12 stops only.');
    } else if (input.area === 'customers') context.facts = {name: text(row.name)};
    else context.facts = {invoiceReference: text(row.invoice_number), status: text(row.status), currency: text(row.currency), poReference: text(row.po_reference)};
  } else if (input.area === 'planning') {
    const date = input.date ?? operatorDay(new Date());
    // Same date predicate as the live board. Never pretend an unapplied saved
    // plan, browser selection, or a truncated result is the full live plan.
    const {data, count, error} = await caller.supabase.from('jobs')
      .select('id,status,vehicle_id,driver_id,job_stops(type,status,pod_status,collected_at,delivered_at)', {count: 'exact'})
      .eq('tenant_id', caller.tenantId)
      .or(`planning_date.eq.${date},and(planning_date.is.null,scheduled_date.eq.${date})`)
      .order('id').limit(500);
    if (error || count === null || !data) throw new ApiError(503, 'Planning could not be loaded.');
    context.facts = {date, totalJobs: count};
    if (count > data.length) context.warnings.push(`There are ${count} jobs on this date. Detailed counts are unavailable because the 500-job review limit was reached.`);
    else {
      const active = data.filter(row => !['completed', 'delivered', 'cancelled', 'canceled'].includes((row.status ?? '').trim().toLowerCase()) && planningJobProgress({status: row.status, stops: row.job_stops}) !== 'delivered');
      context.facts.assignedJobs = active.filter(row => row.vehicle_id).length;
      context.facts.unassignedJobs = active.filter(row => !row.vehicle_id).length;
      context.facts.missingDrivers = active.filter(row => !row.driver_id).length;
      context.facts.collectedJobs = active.filter(row => planningJobProgress({status: row.status, stops: row.job_stops}) === 'collected').length;
      context.facts.deliveredJobs = data.filter(row => planningJobProgress({status: row.status, stops: row.job_stops}) === 'delivered').length;
    }
    context.warnings.push('This review covers saved job assignments for the selected date. Unapplied saved plans and unsaved board changes are not included. Unassigned does not mean collected or complete.');
  } else if (input.area !== 'compliance') context.warnings.push('No individual record selected. Open a job, customer or invoice and use Review this record with Assistant for record-specific help.');
  if (input.area === 'compliance') context.warnings = RULE_SOURCES.map(r => `${r.reference}: ${r.classification}. ${r.applicability}`);
  return projectAssistantContext(permissions, caller.tenantId, context);
}
