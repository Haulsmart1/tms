-- Row Level Security for public.registration_requests
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- THE MODEL
--   Writes  : nobody through the public API. The app writes with the SERVICE
--             ROLE key from app/api/request-access/route.ts, which bypasses RLS
--             by design and is never exposed to the browser.
--   Reads   : super admins only.
--   Updates : super admins only (so they can move `status` along).
--   Deletes : nobody through the API.
--
-- WHY NO ANON INSERT POLICY
--   The anon key is public; it ships inside the client bundle. If anon could
--   INSERT, anyone could POST directly to
--       {SUPABASE_URL}/rest/v1/registration_requests
--   and bypass the honeypot and the per-IP rate limit in our route entirely.
--   Routing writes through the service role means the guarded route is the only
--   way in. The trade-off is that the service role key must stay server-side.

alter table public.registration_requests enable row level security;

-- Reads: super admins only.
drop policy if exists "super admins read registration requests"
  on public.registration_requests;

create policy "super admins read registration requests"
  on public.registration_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and r.name = 'super_admin'
    )
  );

-- Updates: super admins only, e.g. moving status from new to contacted.
drop policy if exists "super admins update registration requests"
  on public.registration_requests;

create policy "super admins update registration requests"
  on public.registration_requests
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and r.name = 'super_admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and r.name = 'super_admin'
    )
  );

-- Deliberately NO insert policy and NO delete policy. With RLS enabled and no
-- matching policy, those operations are denied for every API role. The service
-- role bypasses RLS, so the application route can still insert.

-- OPTIONAL BELT AND BRACES
-- If you would rather anon could not even attempt a write, revoke the grants
-- as well. RLS already denies it; this removes the ability to try.
-- revoke insert, update, delete on public.registration_requests from anon;

-- VERIFY (expect: rowsecurity = true, then three or four policies listed)
-- select relname, relrowsecurity from pg_class where relname = 'registration_requests';
-- select policyname, cmd, roles from pg_policies where tablename = 'registration_requests';
