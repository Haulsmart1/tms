-- NOTE 2026-09-14 (review SQL-4 / POD-15 / SQL-16): the four job_items_*_tenant policies below
-- use auth_tenant_id(), which is defined nowhere in the repo and may read user-editable JWT
-- user_metadata. docs/sql/prodfix_85_replace_auth_tenant_id_policies.sql replaces them with
-- can_access_tenant(tenant_id) policies under the same names (so the `if not exists` guards
-- below make a re-run a no-op), and docs/sql/prodfix_90_child_tenant_binding.sql binds
-- job_items.tenant_id to its job's tenant.
--
-- Baseline the existing production job_items schema so clean migration
-- histories can reproduce the table before barcode scan migrations run.
--
-- Production already contains this table. CREATE TABLE/INDEX IF NOT EXISTS
-- and guarded policy creation preserve the existing production objects.

create table if not exists public.job_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null
    references public.jobs(id) on delete cascade,
  sku text,
  description text,
  quantity integer not null default 1
    check (quantity > 0),
  serial_numbers text[],
  external_reference text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists job_items_job_idx
  on public.job_items (job_id);

create index if not exists job_items_tenant_idx
  on public.job_items (tenant_id);

alter table public.job_items
  enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'job_items'
      and policyname = 'job_items_select_tenant'
  ) then
    create policy job_items_select_tenant
      on public.job_items
      for select
      to authenticated
      using (tenant_id = auth_tenant_id());
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'job_items'
      and policyname = 'job_items_insert_tenant'
  ) then
    create policy job_items_insert_tenant
      on public.job_items
      for insert
      to authenticated
      with check (tenant_id = auth_tenant_id());
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'job_items'
      and policyname = 'job_items_update_tenant'
  ) then
    create policy job_items_update_tenant
      on public.job_items
      for update
      to authenticated
      using (tenant_id = auth_tenant_id())
      with check (tenant_id = auth_tenant_id());
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'job_items'
      and policyname = 'job_items_delete_tenant'
  ) then
    create policy job_items_delete_tenant
      on public.job_items
      for delete
      to authenticated
      using (tenant_id = auth_tenant_id());
  end if;
end
$$;