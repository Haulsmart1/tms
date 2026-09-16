-- local_00_base_tables_reconstructed.sql
--
-- *** RECONSTRUCTION FOR LOCAL TESTING ONLY. NEVER APPLY TO A HOSTED PROJECT. ***
--
-- The hosted database's base tables (companies, tenants, profiles, roles, memberships,
-- company_profiles, public.users) were created in the Supabase dashboard before docs/sql/
-- existed, so no `create table` for them is in the repo. This file rebuilds them for the
-- local stack started by `supabase start` (2026-09-16, self-serve signup work) so the
-- rls_*, billing_* and prodfix_* series, and then signup_01, can be applied and proven
-- against a real Postgres before anything touches production.
--
-- Every column and every NOT NULL below is annotated with where it came from. Where the
-- evidence did not settle it, the STRICTER option was chosen and the line is tagged
-- `-- GUESS(strict)` so the checkpoint can list it. If the hosted schema turns out to differ,
-- change THIS file, not the migration that fails against it.
--
-- It contains four sections:
--   A. the seven identity tables, with sourced NOT NULLs
--   B. the four helper functions that exist only in the hosted database
--      (rls_02_helpers.sql:4-7) and that get_tenant_context() and every policy depend on
--   C. minimal shapes for the operational tables the local browser run reads (dashboard,
--      billing page, vehicles, drivers, licences) and that the signup-adjacent prodfix files
--      reference. Columns are only what those pages and files name. Loose on purpose.
--   D. empty stubs for the tables rls_05 / rls_06 revoke grants on by name, so those files
--      run as written. They hold nothing and prove nothing.
--
-- Does NOT recreate: the 15 files under supabase/migrations/ (planning, manifests,
-- quotations, Xero, driver activity), the accounts / POD / quotation tables, or the
-- storage buckets. prodfix files that need those raise their own precondition error and
-- change nothing, which is recorded in the checkpoint rather than papered over here.
--
-- Roles seeded here: 'super_admin' and 'admin' (lib/roles.ts requires the exact string
-- 'super_admin'; rls_01b_reseed.sql:23-25 shows 'admin' pre-existing and prodfix_10 assumes
-- both). 'staff' and 'driver' are seeded by prodfix_20 section 5, as in production.
--
-- roles.name is deliberately NOT unique here: prodfix_20's prodfix_role_id raises
-- 'role_ambiguous', which only makes sense if the hosted table allows duplicates.
-- signup_01 adds the unique index (guarded), and this shape lets that guard be exercised.

begin;

create extension if not exists pgcrypto;

-- =============================================================================================
-- A. Identity tables
-- =============================================================================================

-- companies ----------------------------------------------------------------------------------
-- Columns: id, name (app/api/super-admin/users/route.ts:59 selects "id, name"; rls_01b_reseed
-- inserts (id, name)). created_at is assumed (every dashboard-created table gets one).
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),       -- rls_01b inserts an explicit id; default is GUESS(strict: always present)
  name        text not null,                                    -- rls_01b_reseed.sql:30 coalesces to 'Company' so the column refuses NULL
  created_at  timestamptz not null default now()                -- GUESS(strict): dashboard default
);

-- tenants ------------------------------------------------------------------------------------
-- Columns: id, name, company_id, created_at.
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),       -- rls_01b_reseed.sql:37 inserts (name, company_id) only, so id has a default
  name        text not null,                                    -- handoff 3.1 step 2: "name is NOT NULL"; rls_01b coalesces it
  company_id  uuid references public.companies(id),             -- rls_01_tenants_company_id.sql:16 adds it NULLABLE with this FK; get_tenant_context tolerates NULL
  created_at  timestamptz not null default now()                -- rls_01b_reseed.sql:63 orders tenants by created_at
);

-- roles --------------------------------------------------------------------------------------
create table if not exists public.roles (
  id    uuid primary key default gen_random_uuid(),             -- rls_01b_reseed.sql:25 inserts (name) only
  name  text not null                                           -- prodfix_20 matches r.name = p_role; a NULL name is meaningless
  -- no unique index: see header. signup_01 adds it.
);

-- public.users (separate from auth.users) -----------------------------------------------------
-- memberships.user_id references it (rls_06_lock_secrets.sql A4). The invite routes insert
-- { id, email } (app/api/settings/portal-invites/route.ts:115) and prodfix_20 upserts on (id).
create table if not exists public.users (
  id          uuid primary key,                                 -- prodfix_20:158 `on conflict (id)`; the value is the auth user id
  email       text not null,                                    -- prodfix_20:157 writes coalesce(p_email, '') rather than NULL, so NULL is refused
  created_at  timestamptz not null default now()                -- GUESS(strict)
);

-- profiles -----------------------------------------------------------------------------------
-- Columns named by the app: id, tenant_id, company_id, role_id, full_name, phone, created_at
-- (app/api/settings/users/[userId]/route.ts, app/api/super-admin/users/route.ts:55-57).
-- prodfix_20:163 inserts (id) alone, so every other column must be nullable or defaulted.
-- profiles.email is NOT included: app/settings/permissions/page.tsx:12 says it "may not
-- exist" and no app code selects it.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,  -- profiles_privileged_columns_guard.sql: id is the auth user id
  tenant_id   uuid references public.tenants(id),               -- rls_02: current_tenant_id() reads profiles.tenant_id. FK is GUESS(strict)
  company_id  uuid references public.companies(id),             -- guard file header: get_my_company_id() reads profiles.company_id. FK is GUESS(strict)
  role_id     uuid references public.roles(id),                 -- guard file header: get_my_role() reads profiles.role_id. FK is GUESS(strict)
  full_name   text,                                             -- app/api/settings/users/[userId]/route.ts updates full_name
  phone       text,                                             -- same route updates phone
  created_at  timestamptz not null default now()                -- super-admin users route orders by it with nullsFirst:false, which hints it may be nullable live. GUESS(strict): NOT NULL with default
);

-- memberships (legacy; written for compatibility, never read for authorization) -------------
create table if not exists public.memberships (
  id          bigint generated always as identity primary key,  -- GUESS(strict): some key; nothing names it
  tenant_id   uuid not null references public.tenants(id),      -- prodfix_20:206 always writes it
  user_id     uuid not null references public.users(id),        -- rls_06 A4: "FK user_id -> public.users"
  role        text not null,                                    -- prodfix_20:207 coalesces to p_role so it is never NULL. GUESS(strict)
  created_at  timestamptz not null default now()                -- GUESS(strict)
  -- no unique (tenant_id, user_id): AUTH-9 says "add unique ... if missing" and prodfix_20
  -- guards with `where not exists`, both of which imply it is absent live.
);

-- company_profiles ---------------------------------------------------------------------------
-- tenant_id holds the COMPANY id (rls_04_identity_tables.sql:27, lib/superAdmin/companyEdit.ts).
-- The super-admin route upserts with onConflict "tenant_id", so tenant_id is unique; making it
-- the primary key is GUESS(strict). The 28 editable columns are EDITABLE_PROFILE_FIELDS in
-- lib/superAdmin/companyEdit.ts and CompanyProfileRow in app/settings/company/page.tsx:50-80,
-- all text and all nullable there (the page maps NULL to "").
create table if not exists public.company_profiles (
  tenant_id                uuid primary key references public.companies(id),  -- FK is GUESS(strict); rls_01b's left join hints it is absent live
  company_name             text,
  trading_name             text,
  legal_entity_type        text,
  industry_type            text,
  registration_number      text,
  tax_number               text,
  vat_number               text,
  eori_number              text,
  operator_licence_number  text,
  us_ein                   text,
  usdot_number             text,
  mc_number                text,
  ifta_number              text,
  irp_number               text,
  scac_code                text,
  business_email           text,
  business_phone           text,
  website                  text,
  address_line_1           text,
  address_line_2           text,
  city                     text,
  region                   text,
  postcode                 text,
  country_code             text,
  currency_code            text,
  timezone                 text,                                -- lib/planning/companyTimeZone.ts reads it
  language_code            text,
  notes                    text,
  created_at               timestamptz not null default now(),  -- GUESS(strict)
  updated_at               timestamptz not null default now()   -- GUESS(strict)
);

-- Dashboard-created tables have RLS on. rls_04 adds the policies; rls_11 would enable RLS
-- on anything still off.
alter table public.companies        enable row level security;
alter table public.tenants          enable row level security;
alter table public.roles            enable row level security;
alter table public.users            enable row level security;
alter table public.profiles         enable row level security;
alter table public.memberships      enable row level security;
alter table public.company_profiles enable row level security;

-- roles is a global lookup every signed-in user may read (the app joins roles(name) through
-- profiles with the user's own key: lib/billing/server.ts:41-45).
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using (true);

insert into public.roles (name)
select v from (values ('super_admin'), ('admin')) as s(v)
where not exists (select 1 from public.roles r where r.name = s.v);

-- =============================================================================================
-- B. Helper functions that exist only in the hosted database
-- =============================================================================================
-- rls_02_helpers.sql:4-7: "public.current_tenant_id() = (select tenant_id from profiles where
-- id = auth.uid()) ... get_my_company_id(), get_my_role() and is_super_admin() also already
-- exist." Bodies below follow the guard file's description of what each reads. SECURITY
-- DEFINER because they are evaluated inside RLS policies on profiles itself.

create or replace function public.current_tenant_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select p.tenant_id from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.get_my_company_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select p.company_id from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.get_my_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select r.name from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.get_my_role() = 'super_admin', false);
$$;

-- Policies evaluate as the querying role, so authenticated must keep EXECUTE
-- (prodfix_86 header, "RLS policy expressions").
revoke all on function public.current_tenant_id()  from public, anon;
revoke all on function public.get_my_company_id()  from public, anon;
revoke all on function public.get_my_role()        from public, anon;
revoke all on function public.is_super_admin()     from public, anon;
grant execute on function public.current_tenant_id() to authenticated, service_role;
grant execute on function public.get_my_company_id() to authenticated, service_role;
grant execute on function public.get_my_role()       to authenticated, service_role;
grant execute on function public.is_super_admin()    to authenticated, service_role;

-- =============================================================================================
-- C. Operational tables the local browser run touches (minimal shapes)
-- =============================================================================================
-- tenant_id NOT NULL on each: rls_08 says "make drivers match every other converted table"
-- when it sets drivers.tenant_id NOT NULL, so the converted tables already had it.

create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  name        text not null,                                    -- app/dashboard/page.tsx joins customers(name)
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.vehicles (                    -- columns: app/vehicles/page.tsx insert payload, app/settings/licences/page.tsx:197
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id),  -- NO company_id column, ever (CLAUDE.md)
  registration                text,                             -- billing_07 says "Registration is nullable on vehicles"
  vehicle_type                text,
  make                        text,
  model                       text,
  mot_expiry                  date,
  tax_expiry                  date,
  insurance_type              text,
  insurance_provider          text,
  insurance_policy_number     text,
  insurance_start_date        date,
  insurance_expiry            date,
  fleet_insurance_policy_id   uuid,
  mam_kg                      integer,
  trailer_mam_kg              integer,
  tachograph_fitted           boolean,
  tachograph_type             text,
  home_country_code           text,
  active                      boolean not null default true,    -- rls_04b: staff may toggle `active` only
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create table if not exists public.vehicle_licences (            -- columns: CLAUDE.md (licence_type, issue_date, expiry_date, notes, active, vehicle_id); billing_07 adds the rest
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,  -- prodfix_31 changes this to RESTRICT
  licence_type  text not null,
  issue_date    date,
  expiry_date   date,
  notes         text,
  active        boolean not null default false,                 -- billing_03 guard: server-only to set true
  created_at    timestamptz not null default now()              -- billing_07 backfills activated_at from it, so it must be NOT NULL
);

create table if not exists public.drivers (                     -- columns: app/drivers/page.tsx insert payload
  id                            uuid primary key default gen_random_uuid(),
  tenant_id                     uuid not null references public.tenants(id),  -- rls_08:26 set not null
  name                          text not null,
  phone                         text,
  email                         text,
  employee_number               text,
  driver_type                   text,
  date_of_birth                 date,
  start_date                    date,
  city                          text,
  postcode                      text,
  depot                         text,
  planning_profile              text,
  normal_start_time             time,
  emergency_contact_name        text,
  emergency_contact_phone       text,
  licence_number                text,
  licence_issue_date            date,
  licence_expiry                date,
  licence_check_date            date,
  licence_check_due             date,
  licence_check_reference       text,
  licence_status                text,
  licence_categories            text[],
  points_total                  integer,
  disqualified                  boolean,
  disqualified_until            date,
  licence_restriction_notes     text,
  tachograph_required           boolean,
  tachograph_card_number        text,
  tachograph_issue_date         date,
  tachograph_expiry             date,
  tachograph_last_download      date,
  tachograph_next_download_due  date,
  cpc_required                  boolean,
  cpc_qualified                 boolean,
  cpc_expiry                    date,
  cpc_training_hours            numeric,
  cpc_notes                     text,
  adr_required                  boolean,
  adr_qualified                 boolean,
  adr_certificate_number        text,
  adr_classes                   text[],
  adr_expiry                    date,
  adr_notes                     text,
  last_medical_date             date,
  next_medical_due              date,
  medical_restrictions          text,
  right_to_work_checked_at      date,
  right_to_work_expiry          date,
  right_to_work_reference       text,
  notes                         text,
  active                        boolean not null default true,
  created_at                    timestamptz not null default now()
);

create table if not exists public.jobs (                        -- columns: app/dashboard/page.tsx:85; prodfix_94 (accepted_by/at); 20260901041500 (planning_date)
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id),
  reference       text,
  status          text,
  vehicle_id      uuid references public.vehicles(id),          -- prodfix_30 gates this column
  driver_id       uuid references public.drivers(id),
  customer_id     uuid references public.customers(id),
  scheduled_date  date,
  planning_date   date,
  accepted_by     uuid,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.job_stops (                   -- columns: app/dashboard/page.tsx:90-101
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  type        text,
  planned_at  timestamptz,
  pod_status  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.invoices (                    -- columns: app/dashboard/page.tsx:105-111
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id),
  invoice_number  text,
  issue_date      date,
  due_date        date,
  total           numeric,
  status          text,
  created_at      timestamptz not null default now()
);

create table if not exists public.vehicle_assignments (         -- prodfix_30 gates vehicle_assignments.vehicle_id
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  vehicle_id  uuid references public.vehicles(id),
  driver_id   uuid references public.drivers(id),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.driver_users (                -- prodfix_20 remove_company_user; prodfix_85 policies; 20260813_portal_invites
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  user_id     uuid not null,
  driver_id   uuid references public.drivers(id),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.subcontractor_users (         -- prodfix_20 remove_company_user
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  user_id     uuid not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.user_permissions (            -- prodfix_91 asserts a uuid user_id; the page upserts (user_id, page)
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  page        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.asset_types (                 -- rls_04 creates a policy on it
  id    uuid primary key default gen_random_uuid(),
  name  text not null
);

-- =============================================================================================
-- D. Empty stubs so rls_05 / rls_06 / rls_03 run as written. Nothing reads them locally.
-- =============================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'audit_logs', 'integration_connections', 'accounting_exports', 'billing', 'subscriptions',
    'rate_cards', 'vehicle_subscription_usage', 'telematics_devices', 'telematics_events',
    'telematics_fuel', 'telematics_positions', 'telematics_trips', 'gps_events',
    'vehicle_locations', 'tachograph_downloads', 'tachograph_infringements',
    'driver_activity_logs', 'driver_daily_summary', 'driver_wtd_weeks', 'driver_work_rules',
    'registration_requests'
  ] loop
    execute format(
      'create table if not exists public.%I (id uuid primary key default gen_random_uuid(), tenant_id uuid, created_at timestamptz not null default now())',
      t);
  end loop;
end $$;

commit;

-- VERIFY (read-only): the seven identity tables exist and roles has the two seeds.
--   select table_name from information_schema.tables where table_schema = 'public'
--     and table_name in ('companies','tenants','roles','users','profiles','memberships','company_profiles')
--   order by 1;
--   select name from public.roles order by name;
