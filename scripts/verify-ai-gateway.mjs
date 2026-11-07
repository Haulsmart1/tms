// Explicit, one-request smoke test for the linked Vercel environment.
// No customer records or emails are sent. Never log credentials or raw errors.
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

let stage = 'configuration';
try {
  if (process.env.TMS_AI_ENABLED !== 'true' || !process.env.TMS_AI_MODEL) throw new Error('configuration_missing');
  stage = 'gateway';
  const result = await generateText({
    model: process.env.TMS_AI_MODEL,
    system: 'Review the fictional operational facts. Return only the requested short status. Collected means on the van, not delivered. Unassigned is not evidence of collection.',
    prompt: 'Fictional TEST-1: collection complete, delivery pending. State the progress and whether delivered.',
    output: Output.object({schema: z.object({progress: z.enum(['collected']), delivered: z.literal(false)})}),
    reasoning: 'low', maxOutputTokens: 500, maxRetries: 0, timeout: 30000,
  });
  if (result.output.progress !== 'collected' || result.output.delivered !== false) throw new Error('unexpected_answer');
  console.log('TMS_AI_GATEWAY_PASS', JSON.stringify({model: process.env.TMS_AI_MODEL, progress: result.output.progress, delivered: result.output.delivered, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens}));
  if (!process.argv.includes('--gateway-only')) {
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
  }
  console.log('TMS_AI_SMOKE_PASS', JSON.stringify({model: process.env.TMS_AI_MODEL, progress: result.output.progress, delivered: result.output.delivered, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, databaseChecks: process.argv.includes('--gateway-only') ? 'skipped' : 'passed'}));
} catch (error) {
  const safeCode = error instanceof Error && /^(configuration_missing|context_query_[A-Za-z0-9]*|rate_limiter_[A-Za-z0-9]+|unexpected_answer)$/.test(error.message) ? error.message : 'gateway_request_failed';
  console.error('TMS_AI_SMOKE_FAILED', JSON.stringify({stage, code: safeCode, type: error?.name, status: error?.statusCode}));
  process.exitCode = 1;
}
