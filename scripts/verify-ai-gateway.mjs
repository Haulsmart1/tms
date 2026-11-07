// Explicit synthetic workflow acceptance for the linked Vercel environment (Node 24).
// No customer records or emails are sent. Never log credentials or raw errors.
import { generateAssistantReview } from '../lib/assistant/request.ts';
import { createClient } from '@supabase/supabase-js';

let stage = 'configuration';
try {
  const gatewayOnly = process.argv.includes('--gateway-only');
  const databaseOnly = process.argv.includes('--database-only');
  if (gatewayOnly && databaseOnly) throw new Error('configuration_missing');
  if (!databaseOnly) {
    if (process.env.TMS_AI_ENABLED !== 'true' || !process.env.TMS_AI_MODEL) throw new Error('configuration_missing');
    stage = 'gateway';
    const job = {
      tenantId: 'synthetic-only', area: 'jobs',
      facts: {reference: 'TEST-1', status: 'accepted', progress: 'collected', serviceDate: '2027-04-21', vehicleAssigned: 'Yes', driverAssigned: 'Yes', collectionCount: 1, deliveryCount: 1, collectionETA: null, deliveryETA: null},
      warnings: ['No delivery time recorded. Customer name is not included in this snapshot.'],
    };
    const cases = [
      {
        name: 'collected-not-delivered', context: job,
        question: 'Is this job collected or delivered? Give one brief summary of its progress and next step.',
        accepts: proposals => {
          const text = proposals.map(p => p.text).join(' ');
          return /collected|on the van/i.test(text) && /awaiting|pending|not (?:yet )?deliver/i.test(text);
        },
      },
      {
        name: 'saved-planning-counts',
        context: {tenantId: 'synthetic-only', area: 'planning', facts: {date: '2026-11-07', totalJobs: 10, assignedJobs: 4, unassignedJobs: 3, missingDrivers: 1, collectedJobs: 2, deliveredJobs: 3}, warnings: ['This review covers saved assignments only. Unapplied plans are excluded. Unassigned does not mean collected or complete.']},
        question: 'Summarise the saved day, including the date as YYYY-MM-DD and the unassigned, collected and delivered counts as digits. What needs checking?',
        accepts: proposals => {
          const text = proposals.map(p => p.text).join(' ');
          return text.includes('2026-11-07') && /3/.test(text) && /2/.test(text) && /unassigned/i.test(text) && /collected/i.test(text) && /deliver/i.test(text);
        },
      },
      {
        name: 'customer-draft-without-invented-time', context: job,
        question: 'Draft a short customer update based only on this job. Show placeholders for missing names or times; do not send it.',
        accepts: proposals => proposals.some(p => p.kind === 'communication-draft' && /collected/i.test(p.text) && /\[name\]/i.test(p.text) && !/\b\d{1,2}:\d{2}\b|2027|April|21[/-]0?4/i.test(p.text)),
      },
    ];
    for (const test of cases) {
      stage = `gateway-${test.name}`;
      const proposals = await generateAssistantReview(test.context, test.question, {model: process.env.TMS_AI_MODEL});
      if (!test.accepts(proposals) || proposals.some(p => p.requiresApproval !== true)) throw new Error('unexpected_answer');
      // These fixtures contain no customer information; their answers are safe
      // to retain as acceptance evidence. Normal application prompts stay private.
      console.log('TMS_AI_WORKFLOW_PASS', JSON.stringify({scenario: test.name, proposals}));
    }
    console.log('TMS_AI_GATEWAY_PASS', JSON.stringify({model: process.env.TMS_AI_MODEL, scenarios: cases.length}));
  }
  if (!gatewayOnly) {
    stage = 'database-client';
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth: {persistSession: false, autoRefreshToken: false}});
    // The same columns and relationships used by the assistant must exist. The
    // nil tenant returns no customer records even with a service client.
    stage = 'database-query';
    const {error: contextError} = await admin.from('jobs').select('id,tenant_id,reference,status,scheduled_date,planning_date,vehicle_id,driver_id,collection_eta,delivery_eta,job_stops(type,stop_order,status,pod_status,collected_at,delivered_at,city,postcode,contact_name,contact_phone,contact_email)', {count: 'exact'}).eq('tenant_id', '00000000-0000-0000-0000-000000000000').limit(1);
    if (contextError) {console.error('TMS_AI_DATABASE_CHECK', {networkFailure: /fetch failed|ENOTFOUND|ECONN|network/i.test(`${contextError.message} ${contextError.details}`), code: contextError.code}); throw new Error(`context_query_${contextError.code}`);}
    // Consume only a separate smoke-test counter, never the user's allowance.
    stage = 'durable-limiter';
    const {data, error} = await admin.rpc('rate_limit_hit', {p_bucket: 'tms-ai:smoke', p_key: process.env.VERCEL_GIT_COMMIT_SHA || 'manual', p_window_seconds: 60, p_max: 5});
    if (error || data !== true) throw new Error(`rate_limiter_${error?.code || 'denied'}`);
    console.log('TMS_AI_DATABASE_PASS', JSON.stringify({schemaRead: 'passed', durableLimiter: 'passed'}));
  }
  console.log('TMS_AI_SMOKE_PASS', JSON.stringify({model: process.env.TMS_AI_MODEL, gatewayChecks: databaseOnly ? 'skipped' : 'passed', databaseChecks: gatewayOnly ? 'skipped' : 'passed'}));
} catch (error) {
  const safeCode = error instanceof Error && /^(configuration_missing|context_query_[A-Za-z0-9]*|rate_limiter_[A-Za-z0-9]+|unexpected_answer|generation_incomplete)$/.test(error.message) ? error.message : 'gateway_request_failed';
  console.error('TMS_AI_SMOKE_FAILED', JSON.stringify({stage, code: safeCode, type: error?.name, status: error?.statusCode}));
  process.exitCode = 1;
}
