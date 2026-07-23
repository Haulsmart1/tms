import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the SERVICE ROLE key.
 *
 * DANGER: the service role key bypasses Row Level Security completely. Never
 * import this from a client component, and never expose the key to the browser.
 * It has no NEXT_PUBLIC_ prefix precisely so Next cannot bundle it client-side.
 *
 * Why this exists: the anon key is public (it ships in the client bundle), so
 * granting anon INSERT on a table means anyone can POST straight to PostgREST
 * and bypass our honeypot and rate limiting. Keeping writes on the service role
 * means the only way into registration_requests is through our guarded route.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
