-- tracking_01_links_and_eta_cache.sql
--
-- Why: customer tracking links (docs/superpowers/specs/2026-10-07-offline-pod-and-tracking-links-design.md).
-- The office sends a delivery contact a link to a public page with an ETA and, once the van is heading
-- to that stop, a live map. Tokens are random and only their SHA-256 hash is stored, exactly like
-- pod_share_links (prodfix_60).
--
-- Access model: both tables are read and written ONLY by server routes on the service role
-- (app/api/tracking-links/*, app/api/public/track/[token]). RLS on with no policies, every client
-- grant revoked, so anon and authenticated users cannot see or forge rows.
--
-- Deploy order: the app degrades safely without these tables. Minting a link answers "Tracking links
-- are not available yet" and every token reads as an ended link.
--
-- document_delivery_log: emailed links are logged with document_type 'tracking_link'. The DDL for
-- that table is not in the repo. The block at the end WARNS (does not fail) if a check constraint on
-- document_type exists; if it does, the email route will 500 before sending anything until the
-- constraint is widened by hand to include 'tracking_link'.
--
-- Idempotent.

begin;

create table if not exists public.stop_tracking_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  stop_id uuid not null references public.job_stops(id) on delete cascade,
  token_hash text not null,
  created_by uuid references auth.users(id) on delete set null,
  sent_to_email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  last_viewed_at timestamptz,
  constraint stop_tracking_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint stop_tracking_links_expiry_after_creation check (expires_at > created_at)
);

create unique index if not exists stop_tracking_links_token_hash_uidx
  on public.stop_tracking_links (token_hash);

create index if not exists stop_tracking_links_stop_idx
  on public.stop_tracking_links (tenant_id, stop_id)
  where revoked_at is null;

create table if not exists public.stop_eta_cache (
  stop_id uuid primary key references public.job_stops(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  eta timestamptz not null,
  computed_at timestamptz not null default now(),
  from_position_at timestamptz not null
);

do $$
declare
  t text;
begin
  foreach t in array array['stop_tracking_links', 'stop_eta_cache'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('revoke all on public.%I from public', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

do $$
declare
  def text;
begin
  if to_regclass('public.document_delivery_log') is null then
    raise warning 'document_delivery_log does not exist; tracking link emails cannot be logged.';
    return;
  end if;
  select string_agg(pg_get_constraintdef(c.oid), '; ')
  into def
  from pg_constraint c
  where c.conrelid = 'public.document_delivery_log'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%document_type%';
  if def is not null and def not ilike '%tracking_link%' then
    raise warning 'document_delivery_log has a document_type check that does not allow tracking_link: %', def;
  end if;
end $$;

commit;

-- VERIFY (expect for both tables: rls=true, force=true, policies=0, all client privileges false):
-- select c.relname,
--        c.relrowsecurity as rls,
--        c.relforcerowsecurity as force,
--        (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
--        has_table_privilege('anon', c.oid, 'select') as anon_select,
--        has_table_privilege('authenticated', c.oid, 'select') as auth_select,
--        has_table_privilege('authenticated', c.oid, 'insert') as auth_insert
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname in ('stop_tracking_links', 'stop_eta_cache');
