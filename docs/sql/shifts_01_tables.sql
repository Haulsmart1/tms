-- shifts_01: tables for driver shifts and DVSA walkaround checks.
-- Spec: docs/superpowers/specs/2026-09-29-driver-shifts-walkaround-design.md
--
-- Every table here is READ-ONLY from the browser: RLS allows SELECT within the
-- caller's tenant (or company, for the catalogue and settings) and all client
-- DML is revoked. Writes happen only in route handlers using the service role,
-- through the RPCs in shifts_04, after the route has authorized the caller.
-- A walkaround check is a DVSA written record; the browser must not be able to
-- edit or delete it.
--
-- Apply after rls_02 (can_access_tenant, get_my_company_id, get_my_role).
-- Safe to re-run.

begin;

do $$
begin
  if to_regprocedure('public.can_access_tenant(uuid)') is null
     or to_regprocedure('public.get_my_company_id()') is null
     or to_regprocedure('public.get_my_role()') is null then
    raise exception 'shifts_01: rls_02 helpers are missing. Nothing changed.';
  end if;
end $$;

-- Catalogue: company_id null = the locked baseline (seeded in shifts_02,
-- guarded by a trigger in shifts_03).
create table if not exists public.defect_catalogue_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id),
  code          text not null,
  category      text not null,
  item_label    text not null,
  defect_label  text not null,
  guidance      text not null default '',
  severity      text not null check (severity in ('minor', 'dangerous')),
  applies_to    text not null default 'vehicle' check (applies_to in ('vehicle', 'trailer', 'both')),
  sort_order    int  not null default 0,
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint defect_catalogue_company_code_prefix check (company_id is null or code like 'co.%')
);
create unique index if not exists defect_catalogue_baseline_code
  on public.defect_catalogue_items (code) where company_id is null;
create unique index if not exists defect_catalogue_company_code
  on public.defect_catalogue_items (company_id, code) where company_id is not null;

create table if not exists public.walkaround_settings (
  company_id          uuid primary key references public.companies(id),
  on_call_phone       text check (on_call_phone is null or length(on_call_phone) <= 32),
  updated_by_user_id  uuid,
  updated_at          timestamptz not null default now()
);

create table if not exists public.driver_shifts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id),
  driver_id           uuid not null references public.drivers(id),
  client_id           uuid not null,
  end_client_id       uuid,
  started_at          timestamptz not null,
  ended_at            timestamptz,
  start_received_at   timestamptz not null default now(),
  end_received_at     timestamptz,
  ended_by            text check (ended_by in ('driver', 'office')),
  end_defect_answer   text check (end_defect_answer in ('none', 'reported')),
  flags               text[] not null default '{}',
  created_by_user_id  uuid,
  created_at          timestamptz not null default now(),
  constraint driver_shifts_client unique (tenant_id, client_id),
  constraint driver_shifts_end_client unique (tenant_id, end_client_id),
  constraint driver_shifts_order check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists driver_shifts_one_open
  on public.driver_shifts (driver_id) where ended_at is null;
create index if not exists driver_shifts_tenant_started on public.driver_shifts (tenant_id, started_at desc);

create table if not exists public.shift_breaks (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id),
  shift_id            uuid not null references public.driver_shifts(id) on delete restrict,
  client_id           uuid not null,
  end_client_id       uuid,
  started_at          timestamptz not null,
  ended_at            timestamptz,
  start_received_at   timestamptz not null default now(),
  end_received_at     timestamptz,
  flags               text[] not null default '{}',
  constraint shift_breaks_client unique (tenant_id, client_id),
  constraint shift_breaks_end_client unique (tenant_id, end_client_id),
  constraint shift_breaks_order check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists shift_breaks_one_open on public.shift_breaks (shift_id) where ended_at is null;

create table if not exists public.walkaround_checks (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id),
  driver_id                uuid not null references public.drivers(id),
  shift_id                 uuid references public.driver_shifts(id) on delete restrict,
  vehicle_id               uuid not null references public.vehicles(id) on delete restrict,
  client_id                uuid not null,
  phase                    text not null check (phase in ('start', 'swap', 'end_of_shift')),
  performed_at             timestamptz not null,
  received_at              timestamptz not null default now(),
  odometer                 int check (odometer is null or odometer >= 0),
  vehicle_confirmation     text not null check (vehicle_confirmation in ('qr', 'registration', 'none')),
  vehicle_mismatch_reason  text,
  result                   text not null check (result in ('pass', 'minor', 'dangerous')),
  checklist_snapshot       jsonb not null,
  declaration_accepted     boolean not null,
  flags                    text[] not null default '{}',
  constraint walkaround_checks_client unique (tenant_id, client_id)
);
create index if not exists walkaround_checks_tenant_performed on public.walkaround_checks (tenant_id, performed_at desc);
create index if not exists walkaround_checks_vehicle on public.walkaround_checks (vehicle_id, performed_at desc);

create table if not exists public.shift_vehicle_periods (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id),
  shift_id             uuid not null references public.driver_shifts(id) on delete restrict,
  vehicle_id           uuid not null references public.vehicles(id) on delete restrict,
  walkaround_check_id  uuid not null references public.walkaround_checks(id) on delete restrict,
  started_at           timestamptz not null,
  ended_at             timestamptz,
  start_odometer       int not null check (start_odometer >= 0),
  end_odometer         int check (end_odometer is null or end_odometer >= 0)
);
create unique index if not exists shift_vehicle_periods_one_open on public.shift_vehicle_periods (shift_id) where ended_at is null;

create table if not exists public.walkaround_defects (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id),
  check_id               uuid not null references public.walkaround_checks(id) on delete restrict,
  vehicle_id             uuid not null references public.vehicles(id) on delete restrict,
  catalogue_item_id      uuid references public.defect_catalogue_items(id) on delete restrict,
  client_id              uuid not null,
  label                  text not null,
  catalogue_severity     text check (catalogue_severity in ('minor', 'dangerous')),
  final_severity         text not null check (final_severity in ('minor', 'dangerous')),
  escalated_by_driver    boolean not null default false,
  severity_source        text not null check (severity_source in ('baseline', 'company', 'driver')),
  note                   text,
  photo_paths            text[] not null default '{}',
  maintenance_record_id  uuid references public.maintenance_records(id) on delete restrict,
  rectified_at           timestamptz,
  created_at             timestamptz not null default now(),
  constraint walkaround_defects_client unique (tenant_id, client_id),
  constraint walkaround_defects_no_downgrade check (not (catalogue_severity = 'dangerous' and final_severity = 'minor'))
);
create index if not exists walkaround_defects_vehicle_open on public.walkaround_defects (vehicle_id) where rectified_at is null;
create index if not exists walkaround_defects_maintenance on public.walkaround_defects (maintenance_record_id);

create table if not exists public.defect_objections (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id),
  defect_id                 uuid not null references public.walkaround_defects(id) on delete restrict,
  driver_id                 uuid not null references public.drivers(id),
  client_id                 uuid not null,
  reason                    text not null check (length(reason) between 3 and 1000),
  status                    text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  raised_at                 timestamptz not null,
  received_at               timestamptz not null default now(),
  decided_by_user_id        uuid,
  decided_at                timestamptz,
  decision_note             text,
  liability_notice_version  text,
  liability_accepted        boolean not null default false,
  constraint defect_objections_client unique (tenant_id, client_id),
  constraint defect_objections_approval check (status <> 'approved' or (liability_accepted and liability_notice_version is not null))
);
create unique index if not exists defect_objections_one_pending on public.defect_objections (defect_id) where status = 'pending';

create table if not exists public.shift_corrections (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id),
  shift_id              uuid not null references public.driver_shifts(id) on delete restrict,
  corrected_by_user_id  uuid not null,
  corrected_at          timestamptz not null default now(),
  field                 text not null check (field in ('started_at', 'ended_at', 'office_started')),
  old_value             text,
  new_value             text,
  reason                text not null check (length(btrim(reason)) >= 3)
);

alter table public.vehicles add column if not exists walkaround_qr_token_hash text;
create unique index if not exists vehicles_walkaround_qr_token_hash
  on public.vehicles (walkaround_qr_token_hash) where walkaround_qr_token_hash is not null;

-- RLS: read within tenant (or company), no client writes.
do $$
declare
  t text;
begin
  foreach t in array array['driver_shifts', 'shift_breaks', 'walkaround_checks', 'shift_vehicle_periods',
                           'walkaround_defects', 'defect_objections', 'shift_corrections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists tenant_read on public.%I', t);
    execute format('create policy tenant_read on public.%I for select to authenticated using (public.can_access_tenant(tenant_id))', t);
  end loop;
end $$;

alter table public.defect_catalogue_items enable row level security;
revoke all on public.defect_catalogue_items from anon, authenticated;
grant select on public.defect_catalogue_items to authenticated;
drop policy if exists catalogue_read on public.defect_catalogue_items;
create policy catalogue_read on public.defect_catalogue_items for select to authenticated using (
  company_id is null
  or company_id = public.get_my_company_id()
  or public.get_my_role() = 'super_admin'
);

alter table public.walkaround_settings enable row level security;
revoke all on public.walkaround_settings from anon, authenticated;
grant select on public.walkaround_settings to authenticated;
drop policy if exists settings_read on public.walkaround_settings;
create policy settings_read on public.walkaround_settings for select to authenticated using (
  company_id = public.get_my_company_id() or public.get_my_role() = 'super_admin'
);

commit;

-- ===========================================================================
-- VERIFY (run shifts_verify.sql for the full check).
--   select relname, relrowsecurity from pg_class
--   where relname in ('driver_shifts','shift_breaks','walkaround_checks','shift_vehicle_periods',
--                     'walkaround_defects','defect_objections','shift_corrections',
--                     'defect_catalogue_items','walkaround_settings');
--   -- expect relrowsecurity = true on all nine rows.
