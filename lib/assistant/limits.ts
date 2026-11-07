import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../api/server';

/** Billable inference must fail closed, including a missing rate-limit RPC.
 * Uses the existing durable rate_limit_hit function; no in-memory allowance. */
export async function reserveAssistantRequest(admin: SupabaseClient, tenantId: string, userId: string) {
  const limits = [
    {bucket: 'tms-ai:user', key: userId, seconds: 3600, max: 20},
    {bucket: 'tms-ai:tenant', key: tenantId, seconds: 86400, max: 100},
    {bucket: 'tms-ai:project', key: 'tms', seconds: 86400, max: 300},
  ];
  for (const limit of limits) {
    const {data, error} = await admin.rpc('rate_limit_hit', {
      p_bucket: limit.bucket, p_key: limit.key, p_window_seconds: limit.seconds, p_max: limit.max,
    });
    if (error) throw new ApiError(503, 'AI usage controls are unavailable. Please try again later.');
    if (data !== true) throw new ApiError(429, 'The AI review limit has been reached. Please try again later.');
  }
}
