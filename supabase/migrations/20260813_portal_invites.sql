-- NOTE 2026-09-14 (review SQL-4 / POD-15): the driver_users_select_tenant policy below uses
-- auth_tenant_id(), which is defined nowhere in the repo and may read user-editable JWT
-- user_metadata. It is replaced by a can_access_tenant(tenant_id) policy of the same name in
-- docs/sql/prodfix_85_replace_auth_tenant_id_policies.sql. Do not re-run this file after that.
-- Hygiene (SQL-17): `create table if not exists` silently accepts a different pre-existing shape.
create table if not exists public.driver_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists driver_users_tenant_driver_idx
  on public.driver_users (tenant_id, driver_id);

create unique index if not exists driver_users_tenant_user_idx
  on public.driver_users (tenant_id, user_id);

alter table public.driver_users enable row level security;

drop policy if exists driver_users_select_tenant on public.driver_users;

create policy driver_users_select_tenant
on public.driver_users
for select
to authenticated
using (tenant_id = public.auth_tenant_id());

grant select on public.driver_users to authenticated;
grant select, insert, update, delete on public.driver_users to service_role;

notify pgrst, 'reload schema';
