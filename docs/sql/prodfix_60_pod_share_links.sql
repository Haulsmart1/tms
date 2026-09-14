-- prodfix_60_pod_share_links.sql
--
-- Why: review findings POD-9 (M2) and POD-25. POD share links were stateless
-- 7-day HMAC tokens with no stored record: they could not be revoked, and the
-- token body exposed the tenant and job ids. The app now issues opaque random
-- tokens and stores only their SHA-256 hash here, with expiry and revocation,
-- and re-checks this row, the job and the tenant on every page view and PDF.
--
-- Access model: this table is read and written ONLY by server routes using the
-- service role (app/api/pod/share, app/api/pod/share/email,
-- app/api/pod/share/revoke, the public /pod/share page and PDF route). RLS is
-- enabled with no policies and every client grant is revoked, so anon and
-- authenticated users cannot see or forge rows.
--
-- Deploy order: the app degrades safely without this table. Creating a share
-- answers "POD sharing is unavailable" and every share link reads as invalid;
-- nothing is served without a stored, unrevoked, unexpired row.
--
-- Legacy tokens: links issued in the old HMAC format stop working when the app
-- deploys (decision recorded in the fix report). No table change is needed for that.
--
-- Idempotent. Does not depend on live state beyond public.jobs and
-- public.tenants existing with uuid primary keys.

begin;

create table if not exists public.pod_share_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  token_hash text not null,
  created_by uuid references auth.users(id) on delete set null,
  sent_to_email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  last_viewed_at timestamptz,
  constraint pod_share_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint pod_share_links_expiry_after_creation check (expires_at > created_at)
);

-- `create table if not exists` silently skips when the name is taken, so fail
-- loudly if an older table of this name lacks the columns the app relies on.
do $$
declare
  missing text;
begin
  select string_agg(col, ', ')
  into missing
  from unnest(array['id','tenant_id','job_id','token_hash','expires_at','revoked_at','last_viewed_at','created_by','sent_to_email','revoked_by']) as col
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'pod_share_links' and c.column_name = col
  );
  if missing is not null then
    raise exception 'public.pod_share_links already exists without columns: %', missing;
  end if;
end $$;

create unique index if not exists pod_share_links_token_hash_uidx
  on public.pod_share_links (token_hash);

create index if not exists pod_share_links_job_idx
  on public.pod_share_links (tenant_id, job_id)
  where revoked_at is null;

alter table public.pod_share_links enable row level security;
alter table public.pod_share_links force row level security;

revoke all on public.pod_share_links from anon;
revoke all on public.pod_share_links from authenticated;
revoke all on public.pod_share_links from public;
grant select, insert, update, delete on public.pod_share_links to service_role;

commit;

-- VERIFY (expect: rls=true, force=true, policies=0, and all four client
-- privilege columns false):
-- select c.relrowsecurity as rls,
--        c.relforcerowsecurity as force,
--        (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'pod_share_links') as policies,
--        has_table_privilege('anon', c.oid, 'select') as anon_select,
--        has_table_privilege('authenticated', c.oid, 'select') as auth_select,
--        has_table_privilege('authenticated', c.oid, 'insert') as auth_insert,
--        has_table_privilege('authenticated', c.oid, 'update') as auth_update
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname = 'pod_share_links';
