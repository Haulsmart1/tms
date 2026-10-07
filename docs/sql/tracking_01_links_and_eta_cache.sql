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

-- A table that already existed with another shape would make create table a no-op, so fail loudly.
do $$
declare
  missing text;
begin
  select string_agg(c, ', ') into missing
  from unnest(array['id', 'tenant_id', 'job_id', 'stop_id', 'token_hash', 'expires_at', 'revoked_at', 'last_viewed_at', 'created_by', 'sent_to_email', 'revoked_by']) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stop_tracking_links' and column_name = c
  );
  if missing is not null then
    raise exception 'stop_tracking_links exists but is missing columns: %', missing;
  end if;
end $$;

create unique index if not exists stop_tracking_links_token_hash_uidx
  on public.stop_tracking_links (token_hash);

create index if not exists stop_tracking_links_stop_idx
  on public.stop_tracking_links (tenant_id, stop_id)
  where revoked_at is null;

create index if not exists stop_tracking_links_stop_id_idx
  on public.stop_tracking_links (stop_id);

create index if not exists stop_tracking_links_job_id_idx
  on public.stop_tracking_links (job_id);

create table if not exists public.stop_eta_cache (
  stop_id uuid primary key references public.job_stops(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  eta timestamptz not null,
  computed_at timestamptz not null default now(),
  from_position_at timestamptz not null
);

-- A table that already existed with another shape would make create table a no-op, so fail loudly.
do $$
declare
  missing text;
begin
  select string_agg(c, ', ') into missing
  from unnest(array['stop_id', 'tenant_id', 'eta', 'computed_at', 'from_position_at']) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stop_eta_cache' and column_name = c
  );
  if missing is not null then
    raise exception 'stop_eta_cache exists but is missing columns: %', missing;
  end if;
end $$;

create index if not exists stop_eta_cache_tenant_id_idx
  on public.stop_eta_cache (tenant_id);

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

-- READ THIS RESULT: what document_delivery_log.document_type is, so you know whether 'tracking_link'
-- will be accepted. Read-only. Expect no rows with a check or enum that lacks 'tracking_link'.
-- If a CHECK or enum is listed without it, widen it by hand before emailing a tracking link.
select 'column type' as kind,
       format_type(a.atttypid, a.atttypmod) as detail
from pg_attribute a
where a.attrelid = to_regclass('public.document_delivery_log')
  and a.attname = 'document_type'
  and not a.attisdropped
union all
select 'check constraint', pg_get_constraintdef(c.oid)
from pg_constraint c
where c.conrelid = to_regclass('public.document_delivery_log')
  and c.contype = 'c'
  and pg_get_constraintdef(c.oid) ilike '%document_type%'
union all
select 'enum labels', string_agg(e.enumlabel, ', ' order by e.enumsortorder)
from pg_attribute a
join pg_type t on t.oid = a.atttypid and t.typtype = 'e'
join pg_enum e on e.enumtypid = t.oid
where a.attrelid = to_regclass('public.document_delivery_log')
  and a.attname = 'document_type'
  and not a.attisdropped
group by t.oid;

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
