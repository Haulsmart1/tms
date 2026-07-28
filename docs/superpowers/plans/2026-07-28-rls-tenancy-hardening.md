# RLS Tenancy Hardening Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct multi-tenant Row Level Security so every table isolates by `tenant_id`, with tenant / company-admin / super_admin access levels, and writes to sensitive tables closed to the public API.

**Architecture:** Two SECURITY DEFINER functions drive the policies: `can_access_tenant` (read/isolation across the three levels) and `can_manage_tenant` (admin-or-super write only). Tables staff operate get read+write; the fleet (`vehicles`, `drivers`) is staff-read / admin-write; system-owned tables (audit, finance, telemetry, credentials) are read-only with writes via the service role. A new `tenants.company_id` column provides the tenant-to-company link. Based on `docs/superpowers/specs/2026-07-28-rls-tenancy-hardening-design.md` and the adversarial review of 2026-07-28.

**Tech Stack:** PostgreSQL RLS, Supabase (SQL editor for application), plpgsql.

**Execution model (read first):** These scripts are committed to the repo, but take effect only when **Ethan runs them in the Supabase SQL editor**. Every migration is safe to re-run. The corrected `profiles` escalation guard (`docs/sql/profiles_privileged_columns_guard.sql`, now INSERT+UPDATE) is a prerequisite and must be applied first.

**Apply order (matters):** `company_profiles` and the fleet become admin-write, so an admin must exist before those policies land or company-settings saving and roster edits lock to super_admin. Run:
`rls_01` (add column) → **`rls_01b` (reseed: companies, tenants, profiles.tenant_id, admin roles)** → `rls_02` (helpers) → `rls_03` (re-key) → `rls_04` (identity) → `rls_04b` (vehicles) → `rls_05` (revokes) → `rls_09` (verify) → then the optional NOT NULL / data cleanup.

**Incorporates the adversarial review (F1-F9):** enumerate-and-drop instead of drop-by-name (F5); `tenants` read-only (F1); reads/writes split so system tables are not client-writable (F2); `profiles`/`company_profiles`/`companies` stacks consolidated in Phase 1, not deferred (F5); table coverage enumerated not assumed (F4); `asset_types` left locked rather than blindly opened (F6); stray `TRUNCATE`/write grants revoked (F8); harness expanded to insert/delete/closed-write probes and a policy-count assertion (F7); `roles` readability documented as non-security (F9).

---

## File structure

- Create `docs/sql/rls_01_tenants_company_id.sql`
- Create `docs/sql/rls_02_helpers.sql`
- Create `docs/sql/rls_03_rekey_data_tables.sql`
- Create `docs/sql/rls_04_identity_tables.sql`
- Create `docs/sql/rls_05_revoke_grants.sql`
- Create `docs/sql/rls_09_verify.sql`

Applied in numeric order.

---

## Task 1: Add `tenants.company_id`

**Files:** Create `docs/sql/rls_01_tenants_company_id.sql`

- [ ] **Step 1: Probe**
```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'tenants' order by column_name;
```
Expected: no `company_id` yet.

- [ ] **Step 2: Migration**
```sql
-- docs/sql/rls_01_tenants_company_id.sql  (safe to re-run)
alter table public.tenants
  add column if not exists company_id uuid references public.companies(id);

insert into public.tenants (id, name)  -- tenants.name is NOT NULL
  values ('2f7cc0dc-b7fd-4556-92be-445e4b42ddcd', 'Shared placeholder tenant')
  on conflict (id) do nothing;

comment on column public.tenants.company_id is
  'Owning company. Used by can_access_tenant() for the admin level. Set NOT NULL after the reseed (Task 7).';
```

- [ ] **Step 3: Verify + commit**
```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='tenants' and column_name='company_id';  -- one row
```
```bash
git add docs/sql/rls_01_tenants_company_id.sql && git commit -m "RLS: add tenants.company_id link"
```

---

## Task 2: Helper functions

**Files:** Create `docs/sql/rls_02_helpers.sql`

- [ ] **Step 1: Write**
```sql
-- docs/sql/rls_02_helpers.sql  (safe to re-run)
-- get_my_tenant_id is NOT created: public.current_tenant_id() already exists and is
-- identical (select tenant_id from profiles where id = auth.uid()); we reuse it.
create or replace function public.can_access_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    public.get_my_role() = 'super_admin'
    or target_tenant = public.current_tenant_id()
    or (public.get_my_role() = 'admin'
        and target_tenant in (
          select t.id from public.tenants t where t.company_id = public.get_my_company_id()
        ));
$$;

-- Like can_access_tenant but WITHOUT the own-tenant branch: true only for an admin
-- over the tenant's company, or a super_admin. Drives admin-only write policies so a
-- regular staff user can read but not write the fleet.
create or replace function public.can_manage_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and target_tenant in (
          select t.id from public.tenants t where t.company_id = public.get_my_company_id()
        ));
$$;
```

- [ ] **Step 2: Verify + commit**
```sql
select public.can_access_tenant('2f7cc0dc-b7fd-4556-92be-445e4b42ddcd');  -- runs, no error
```
```bash
git add docs/sql/rls_02_helpers.sql && git commit -m "RLS: add get_my_tenant_id and can_access_tenant"
```

---

## Task 3: Re-key every standard data table (enumerate-and-drop, split reads/writes)

**Files:** Create `docs/sql/rls_03_rekey_data_tables.sql`

- [ ] **Step 1: Probe the mis-key (expect the bug)**
```sql
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  select count(*) as visible_jobs_before from public.jobs;   -- expect 0 (mis-key)
rollback;
```

- [ ] **Step 2: Write the loop**

Two arrays drive it. `excluded` = tables handled elsewhere (identity, company, legacy, foreign-app). `writes_closed` = system-owned tables that get read-only (writes via the service role, confirmed with Ethan and against the app: the app only reads or never touches them).

```sql
-- docs/sql/rls_03_rekey_data_tables.sql  (safe to re-run)
-- For every table with a tenant_id column (minus the excluded set): drop EVERY
-- existing policy (not just by name, mirroring registration_requests_rls.sql), then
-- create one policy. writes_closed tables get SELECT-only; the rest get FOR ALL.
do $$
declare
  t   record;
  pol record;
  excluded text[] := array[
    'profiles','company_profiles','companies','tenants','roles',
    'user_permissions','memberships','registration_requests','asset_types','users',
    'ai_signals','paper_trade_logs','portfolio_history',
    'vehicles'  -- handled in Task 4b: admin roster + staff status-only carve-out
  ];
  writes_closed text[] := array[
    'audit_logs','integration_connections','accounting_exports','billing',
    'subscriptions','rate_cards','vehicle_subscription_usage',
    'telematics_devices','telematics_events','telematics_fuel','telematics_positions',
    'telematics_trips','gps_events','vehicle_locations',
    -- system-fed via the company's tacho / telematics, and derived stats. Confirmed
    -- read-only or untouched in the app (2026-07-28).
    'tachograph_downloads','tachograph_infringements','driver_activity_logs',
    'driver_daily_summary','driver_wtd_weeks'
  ];
  -- Staff read, admin writes: roster changes are a company-admin job. (vehicles
  -- is excluded and handled in Task 4b because staff also need the VOR toggle.)
  admin_write text[] := array['drivers'];
begin
  for t in
    select c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname <> all(excluded)
      and exists (
        select 1 from information_schema.columns col
        where col.table_schema = 'public' and col.table_name = c.relname
          and col.column_name = 'tenant_id'
      )
  loop
    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t.table_name
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t.table_name);
    end loop;

    if t.table_name = any(writes_closed) then
      execute format(
        'create policy tenant_read on public.%I for select to authenticated '
        'using (public.can_access_tenant(tenant_id))', t.table_name);
    elsif t.table_name = any(admin_write) then
      -- staff can read the fleet...
      execute format(
        'create policy tenant_read on public.%I for select to authenticated '
        'using (public.can_access_tenant(tenant_id))', t.table_name);
      -- ...but only an admin (or super_admin) can write it.
      execute format(
        'create policy admin_all on public.%I for all to authenticated '
        'using (public.can_manage_tenant(tenant_id)) '
        'with check (public.can_manage_tenant(tenant_id))', t.table_name);
    else
      execute format(
        'create policy tenant_access on public.%I for all to authenticated '
        'using (public.can_access_tenant(tenant_id)) '
        'with check (public.can_access_tenant(tenant_id))', t.table_name);
    end if;
    raise notice 're-keyed % (%).', t.table_name,
      case
        when t.table_name = any(writes_closed) then 'read-only'
        when t.table_name = any(admin_write) then 'staff-read / admin-write'
        else 'read+write'
      end;
  end loop;
end $$;
```

- [ ] **Step 3: Apply, re-run the probe (expect the fix)**
```sql
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  select count(*) as visible_jobs_after from public.jobs;   -- expect > 0
rollback;
```

- [ ] **Step 4: HARD assertion, no unexpected policy survived**

Enumerate-and-drop should leave each re-keyed table carrying only our policies (`tenant_access`, or `tenant_read`, or `tenant_read` + `admin_all`). Anything else is a leftover permissive policy.
```sql
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in (
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id')
  and tablename not in (
    'profiles','company_profiles','companies','tenants','roles',
    'user_permissions','memberships','registration_requests','asset_types','users',
    'ai_signals','paper_trade_logs','portfolio_history')
  and policyname not in ('tenant_access','tenant_read','admin_all');
```
Expected: **0 rows.** Any row is a leftover permissive policy and blocks sign-off.

- [ ] **Step 5: Commit**
```bash
git add docs/sql/rls_03_rekey_data_tables.sql && git commit -m "RLS: re-key data tables, enumerate-and-drop, reads/writes split"
```

---

## Task 4: Identity and company tables (`profiles`, `company_profiles`, `companies`, `tenants`, `asset_types`)

**Files:** Create `docs/sql/rls_04_identity_tables.sql`

These are consolidated in Phase 1 (not deferred): each has its full policy stack enumerated, dropped, and replaced with one clear policy per command, so no leftover broad policy can OR its way to a cross-company read.

- [ ] **Step 1: Write**
```sql
-- docs/sql/rls_04_identity_tables.sql  (safe to re-run)

-- Helper to wipe a table's policies cleanly.
do $$
declare pol record; tbl text;
  tables text[] := array['profiles','company_profiles','companies','tenants'];
begin
  foreach tbl in array tables loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=tbl loop
      execute format('drop policy %I on public.%I', pol.policyname, tbl);
    end loop;
  end loop;
end $$;

-- profiles: read self / own-company (admin) / all (super). Update self or super
-- only, with the guard trigger blocking privileged-column changes. No INSERT or
-- DELETE policy: provisioning is service-role only.
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.get_my_role() = 'super_admin'
  or (public.get_my_role() = 'admin' and company_id = public.get_my_company_id())
);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.get_my_role() = 'super_admin')
  with check (id = auth.uid() or public.get_my_role() = 'super_admin');

-- company_profiles: tenant_id holds the COMPANY id. Read own company / super.
-- Insert+update by that company's admin or super (settings page upserts). No delete.
create policy company_profiles_select on public.company_profiles for select to authenticated using (
  tenant_id = public.get_my_company_id() or public.get_my_role() = 'super_admin'
);
create policy company_profiles_insert on public.company_profiles for insert to authenticated
  with check (public.get_my_role() = 'super_admin'
              or (public.get_my_role() = 'admin' and tenant_id = public.get_my_company_id()));
create policy company_profiles_update on public.company_profiles for update to authenticated
  using (public.get_my_role() = 'super_admin'
         or (public.get_my_role() = 'admin' and tenant_id = public.get_my_company_id()))
  with check (public.get_my_role() = 'super_admin'
              or (public.get_my_role() = 'admin' and tenant_id = public.get_my_company_id()));

-- companies: read own / super. No write policy (service role provisions).
create policy companies_select on public.companies for select to authenticated using (
  id = public.get_my_company_id() or public.get_my_role() = 'super_admin'
);

-- tenants: read own tenant / admin over its company / super. NO write policy;
-- tenants is the root of trust for can_access_tenant, so writes are service-role only.
create policy tenants_select on public.tenants for select to authenticated using (
  id = public.current_tenant_id()
  or public.get_my_role() = 'super_admin'
  or (public.get_my_role() = 'admin' and company_id = public.get_my_company_id())
);
```

`asset_types` (id, name) is a global lookup referenced by `assets.asset_type_id`, but was locked with no policy. rls_04 now makes it readable by any authenticated user (`select true`), with no write policy so writes stay denied.

- [ ] **Step 2: Verify**
```sql
select tablename, policyname, cmd from pg_policies
where schemaname='public' and tablename in ('profiles','company_profiles','companies','tenants')
order by tablename, cmd, policyname;
```
Expected: exactly the policies above, no `Tenant ID Matches` or `*_own_tenant`/`*_own_company` leftovers, no INSERT/DELETE policy on `profiles`, no write policy on `companies`/`tenants`.

- [ ] **Step 2b: HARD assertion, no unexpected policy on the identity tables**
```sql
select tablename, policyname from pg_policies
where schemaname='public'
  and tablename in ('profiles','company_profiles','companies','tenants')
  and policyname not in (
    'profiles_select','profiles_update_self',
    'company_profiles_select','company_profiles_insert','company_profiles_update',
    'companies_select','tenants_select');
```
Expected: **0 rows.** Any row is a leftover on a PII/billing table and blocks sign-off.

- [ ] **Step 3: Commit**
```bash
git add docs/sql/rls_04_identity_tables.sql && git commit -m "RLS: consolidate profiles/company_profiles/companies/tenants policies"
```

---

## Task 4b: The fleet table `vehicles` (admin roster, staff status)

**Files:** Create `docs/sql/rls_04b_vehicles.sql`

Admins manage the vehicle roster (add / remove / edit); staff may flip operational
status (VOR / roadworthy, the `active` column) but nothing structural. Three
policies plus a column guard deliver that.

- [ ] **Step 0: Pre-apply schema check (STORED generated columns)**

The guard diffs `to_jsonb(new)` vs `to_jsonb(old)`. In a BEFORE UPDATE trigger a
`GENERATED ALWAYS AS (...) STORED` column is NULL in `new` but holds its value in `old`, so
it would look "changed" on every staff toggle and the guard would wrongly reject. Check first:
```sql
select attname, attgenerated from pg_attribute
where attrelid = 'public.vehicles'::regclass and attnum > 0 and not attisdropped and attgenerated = 's';
```
Expected: 0 rows. If any appear, add `- '<colname>'` for each to BOTH sides of the diff in the
guard below (next to `- 'active' - 'updated_at'`). This also confirms whether `updated_at` exists
(harmless if not).

- [ ] **Step 1: Write**
```sql
-- docs/sql/rls_04b_vehicles.sql  (safe to re-run)
do $$ declare pol record; begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='vehicles' loop
    execute format('drop policy %I on public.vehicles', pol.policyname);
  end loop;
end $$;

-- everyone in the tenant can read the fleet
create policy vehicles_read on public.vehicles for select to authenticated
  using (public.can_access_tenant(tenant_id));
-- admins/super do everything (roster: insert / update / delete)
create policy vehicles_admin_all on public.vehicles for all to authenticated
  using (public.can_manage_tenant(tenant_id))
  with check (public.can_manage_tenant(tenant_id));
-- staff may UPDATE an existing vehicle in their tenant; the trigger below limits
-- WHICH columns. There is deliberately no staff INSERT/DELETE, so roster changes
-- stay admin-only.
create policy vehicles_staff_status on public.vehicles for update to authenticated
  using (public.can_access_tenant(tenant_id))
  with check (public.can_access_tenant(tenant_id));

-- Column guard: a non-admin updating a vehicle may change ONLY operational
-- status. The jsonb diff needs no column list. Add keys if more fields (e.g.
-- odometer) should be staff-editable.
create or replace function public.guard_vehicle_columns()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user in ('service_role','supabase_admin','postgres')
     or public.can_manage_tenant(new.tenant_id)
  then
    return new;  -- admins / super / service: unrestricted
  end if;
  if (to_jsonb(new) - 'active' - 'updated_at')
     is distinct from (to_jsonb(old) - 'active' - 'updated_at')
  then
    raise exception 'Staff may change only vehicle status (active), not the vehicle record'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_vehicle_columns on public.vehicles;
create trigger guard_vehicle_columns before update on public.vehicles
  for each row execute function public.guard_vehicle_columns();
```

- [ ] **Step 2: Verify + commit**
```sql
select policyname, cmd from pg_policies
where schemaname='public' and tablename='vehicles' order by cmd, policyname;
-- expect exactly: vehicles_read (SELECT), vehicles_admin_all (ALL), vehicles_staff_status (UPDATE)
```
```bash
git add docs/sql/rls_04b_vehicles.sql && git commit -m "RLS: vehicles admin roster + staff status-only column guard"
```

Note: the maintenance page's VOR/roadworthy writes currently report success even
when a write affects 0 rows (no `.select()`), so a denied write looks like it
worked. That app fix (treat 0 rows as failure) is app-layer, tracked in Notes.

---

## Task 5: Revoke stray grants (the second layer)

**Files:** Create `docs/sql/rls_05_revoke_grants.sql`

RLS does not gate `TRUNCATE`, and the service-role-only tables should not carry client write grants at all. This restores the belt-and-braces the repo already used for `registration_requests`.

- [ ] **Step 1: Write**
```sql
-- docs/sql/rls_05_revoke_grants.sql  (safe to re-run)

-- 1. TRUNCATE/REFERENCES/TRIGGER are never appropriate for the API roles and RLS
--    does not gate TRUNCATE.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- 2. No direct writes on the system-owned (writes_closed) tables.
revoke insert, update, delete on
  public.audit_logs, public.integration_connections, public.accounting_exports,
  public.billing, public.subscriptions, public.rate_cards, public.vehicle_subscription_usage,
  public.telematics_devices, public.telematics_events, public.telematics_fuel,
  public.telematics_positions, public.telematics_trips, public.gps_events, public.vehicle_locations,
  public.tachograph_downloads, public.tachograph_infringements, public.driver_activity_logs,
  public.driver_daily_summary, public.driver_wtd_weeks
  from anon, authenticated;

-- 3. Identity/structure: no writes for the API roles (service role provisions).
revoke insert, update, delete on public.tenants, public.companies from anon, authenticated;
revoke insert, delete on public.profiles from anon, authenticated;  -- keep UPDATE+SELECT (guarded self-edit)
revoke all on public.profiles from anon;                            -- anon never touches profiles

-- 4. Future tables should not silently re-grant the dangerous three.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
```

- [ ] **Step 2: Verify + commit**
```sql
-- Negative: no TRUNCATE/REFERENCES/TRIGGER for the API roles anywhere, and no
-- INSERT/UPDATE/DELETE left on ANY closed or structure table.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated')
  and (privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')
       or (privilege_type in ('INSERT','UPDATE','DELETE') and table_name = any(array[
         'audit_logs','integration_connections','accounting_exports','billing',
         'subscriptions','rate_cards','vehicle_subscription_usage',
         'telematics_devices','telematics_events','telematics_fuel','telematics_positions',
         'telematics_trips','gps_events','vehicle_locations',
         'tachograph_downloads','tachograph_infringements','driver_activity_logs',
         'driver_daily_summary','driver_wtd_weeks','tenants','companies'])))
order by table_name, grantee, privilege_type;   -- expect 0 rows

-- Positive: the revokes did not over-reach. These must all be true.
select has_table_privilege('authenticated','public.profiles','SELECT') as profiles_select,
       has_table_privilege('authenticated','public.profiles','UPDATE') as profiles_update,
       has_table_privilege('authenticated','public.jobs','INSERT')     as jobs_insert,
       has_table_privilege('authenticated','public.audit_logs','SELECT') as auditlog_read;
```
```bash
git add docs/sql/rls_05_revoke_grants.sql && git commit -m "RLS: revoke TRUNCATE and system-table write grants"
```

---

## Task 6: Verification harness (expanded)

**Files:** Create `docs/sql/rls_09_verify.sql`

- [ ] **Step 1: Write the probes**
```sql
-- docs/sql/rls_09_verify.sql  (each block rolls back; changes nothing)

-- 1. Anon sees and writes nothing.
begin;
  set local role anon;
  select 'anon_jobs' as probe, count(*) from public.jobs;               -- expect 0
rollback;

-- 2. Tenant user: own tenant only.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  select 'own_jobs' as probe, count(*) from public.jobs;                -- expect > 0
  select 'foreign_jobs' as probe, count(*) from public.jobs
    where tenant_id <> '2f7cc0dc-b7fd-4556-92be-445e4b42ddcd';          -- expect 0
rollback;

-- 3. Super admin: everything.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"362aa5fd-0ae8-47e3-8a01-f005d246f476","role":"authenticated"}';
  select 'superadmin_jobs' as probe, count(*) from public.jobs;         -- expect all
rollback;

-- 4. Escalation blocked on UPDATE (guard trigger).
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  update public.profiles set role_id = (select id from public.roles where name='super_admin')
    where id = '005e1811-8165-4213-b92b-4fbaed5591d2';                  -- expect ERROR
rollback;

-- 5. Escalation blocked on INSERT (guard trigger + no insert policy).
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  insert into public.profiles (id, role_id)
    values ('11111111-1111-1111-1111-111111111111',
            (select id from public.roles where name='super_admin'));    -- expect ERROR
rollback;

-- 6. System table is read-only for staff.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  insert into public.audit_logs (tenant_id) values ('2f7cc0dc-b7fd-4556-92be-445e4b42ddcd'); -- expect ERROR/denied
rollback;

-- 6b. Roster is admin-only: a null-role staff DELETE of a vehicle is denied.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  with x as (delete from public.vehicles
             where tenant_id = '2f7cc0dc-b7fd-4556-92be-445e4b42ddcd' returning 1)
  select 'staff_vehicle_deletes' as probe, count(*) from x;   -- expect 0 (staff cannot change the roster)
rollback;

-- 7. No profiles INSERT/DELETE policy for authenticated.
select 'profiles_write_policies' as probe, count(*)
from pg_policies where schemaname='public' and tablename='profiles' and cmd in ('INSERT','DELETE');  -- expect 0

-- 8. Fleet is admin-write: null-role staff cannot DELETE (or INSERT) drivers/vehicles.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  with d as (delete from public.drivers where tenant_id='2f7cc0dc-b7fd-4556-92be-445e4b42ddcd' returning 1)
  select 'staff_driver_deletes' as probe, count(*) from d;   -- expect 0
rollback;

-- 9. Company settings are admin-only: a null-role staff update is denied.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  with u as (update public.company_profiles set company_name = company_name
             where tenant_id = (select company_id from public.profiles where id = auth.uid()) returning 1)
  select 'staff_company_update' as probe, count(*) from u;   -- expect 0
rollback;

-- 10. Vehicles: staff may toggle status but NOT structural columns. First confirm a
--     vehicle exists, so a 0 below cannot be misread as "no row".
select 'vehicles_present' as probe, count(*) from public.vehicles
  where tenant_id = '2f7cc0dc-b7fd-4556-92be-445e4b42ddcd';   -- expect > 0 (seed one if needed)

-- 10a. Allowed: a null-role staff user flips active (a REAL change, not a no-op).
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  with s as (update public.vehicles set active = not active
             where tenant_id='2f7cc0dc-b7fd-4556-92be-445e4b42ddcd' returning 1)
  select 'staff_toggle_active' as probe, count(*) from s;   -- expect > 0 (allowed)
rollback;

-- 10b. Blocked: the same user changes a structural column (replace `registration`
--      with any real non-status column). This exercises the guard's reject path.
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  update public.vehicles set registration = registration || '-X'
    where tenant_id='2f7cc0dc-b7fd-4556-92be-445e4b42ddcd';   -- expect ERROR (insufficient_privilege)
rollback;
```

- [ ] **Step 2: Run; any deviation blocks sign-off.** Also re-run the Task 3 Step-4 policy-count assertion and the Task 5 grant check.

- [ ] **Step 3: Commit**
```bash
git add docs/sql/rls_09_verify.sql && git commit -m "RLS: expanded verification harness"
```

---

## Task 7: Data reseed and role assignment (operational, test data)

Throwaway test data, so a reset rather than a migration. **Runs EARLY, before the write-closing Tasks 3-5** (see the apply order up top), so an admin exists per company when the admin-write policies land. **Concrete, idempotent SQL: `docs/sql/rls_01b_reseed.sql`** (ensures `companies` rows, creates one `tenants` row per company, points each user at their tenant, and makes each company's sole user its admin). The steps below are the reasoning; the file is what you run.

- [ ] **Step 1:** For each of the 7 companies, create a `tenants` row (fresh `id`, `company_id` set). Run as postgres/service role (Tasks 3-5 closed API writes to `tenants`).
- [ ] **Step 2:** Set each real user's `profiles.tenant_id` to their company's tenant; set the director's `profiles.role_id` to `admin`. Run as postgres (the guard trigger permits it).
- [ ] **Step 3:** Re-point the existing job(s) to the correct tenant, then `alter table public.tenants alter column company_id set not null;`.
- [ ] **Step 4:** Run the admin-level probe: an `admin` sees every tenant in their company, none outside.
- [ ] **Step 5 (app-layer follow-on, not this plan):** remove the hardcoded `TENANT_ID` so the app reads the user's real tenant. Consider adding foreign keys from data tables' `tenant_id` to `tenants(id)` for integrity.

---

## Notes and deferred

- **Spec correction:** design §7's "writes stay closed" is true only for the `writes_closed` set, the identity tables, and fleet-roster changes; staff-editable tables (jobs, invoices, etc.) stay client-writable until the app-layer follow-on. And §6's "`company_profiles` leave functionally as-is" is no longer accurate (it is now admin-write). Both are corrected in the committed spec.
- **F9:** `roles` stays readable to authenticated; `role_id` secrecy is NOT a security boundary and nothing relies on it. The real control is the guard trigger.
- **Now closed (confirmed 2026-07-28):** `tachograph_downloads`, `tachograph_infringements`, `driver_activity_logs`, `driver_daily_summary`, `driver_wtd_weeks` are system-fed and moved into `writes_closed`. `driver_work_rules` stays read+write (it is admin configuration of WTD rules, not a system feed).
- **Fleet write model (owner, 2026-07-28).** `drivers`: admin-write, staff read-only (the `admin_write` set). `vehicles`: admins manage the roster (insert/update/delete); staff may toggle operational status (`active` = VOR/roadworthy) ONLY, enforced by three policies plus `guard_vehicle_columns` (Task 4b). Consequence: until admin roles are assigned, only super_admin can change the roster, which is why Task 7 steps 1-2 are sequenced first. Driver activate/deactivate is admin-only too; if staff must deactivate drivers, give `drivers` the same status carve-out. `vehicle_licences`/`vehicle_compliance` stay read+write for now.
- **Company settings are admin-only (owner, 2026-07-28).** `company_profiles` insert/update require admin or super. Since all current profiles are null-role, Task 7's role assignment MUST precede Tasks 3-5 (see apply order), or company-settings saving is locked to super_admin until then.
- **Coverage assertion (closes F4, verification):** before sign-off, enumerate every `public` `relkind='r'` table NOT in the loop's tenant_id set and NOT re-keyed here, and confirm each is deny-all (RLS on, no policy) or explicitly scoped, never `TO public`/`using(true)`. Prove the legacy `excluded` tables (`users`, `memberships`, `user_permissions`, `asset_types`, `roles`) too, with an anon SELECT probe against one of them.
- **Behavior change (D):** with `profiles_select` scoped, `/settings/users` and `/settings/permissions` show only the caller's own row for a non-admin (an admin sees their company). Those pages have no server-side role guard today; add one in the app-layer follow-on. This is a tightening that incidentally protects two currently-unguarded pages.
- **Provisioning rule (owner, 2026-07-28):** in full-serve signup, the FIRST profile created for a company is automatically assigned the `admin` role. This is the app-layer signup flow's job (deferred), and it is how each company gets the admin that the fleet-write policies require. Task 7 assigns the director `admin` manually until then.
- **Storage:** the `pod-files` bucket public-URL exposure (a real cross-tenant leak) is still open and out of this plan's scope. Recommend a follow-up task to make it private with a tenant-path `storage.objects` policy.
- **Ground-truth verified (2026-07-28, via `docs/sql/schema_rls_dump.sql`):** the full dump confirmed the uniform mis-keyed `Tenant ID Matches` policy on every tenant table and that every `tenant_id` is foreign-keyed to `tenants.id`. Corrections applied: reuse the pre-existing `current_tenant_id()` rather than creating a twin `get_my_tenant_id()`; make `asset_types` readable. The database also already has `is_super_admin()` (could replace `get_my_role() = 'super_admin'` for clarity later). Open data-integrity item: `drivers`, `defect_reports`, `driver_work_rules`, and `telematics_positions` have a NULLABLE `tenant_id`, so rows with null are invisible to everyone; set NOT NULL once backfilled.

---

## Self-review

- **First-pass findings closed:** F1 (tenants read-only, Task 4), F2 (reads/writes split, Task 3 + Task 5), F3 (guard INSERT+UPDATE, already applied), F4 (enumerate tables, Task 3 loop + assertion + coverage assertion in Notes), F5 (enumerate-and-drop + identity consolidation + Task 4 Step 2b assertion), F6 (asset_types left locked, Task 4), F7 (harness probes 5-10, Task 6), F8 (grant revokes, Task 5), F9 (documented, Notes).
- **Re-validation items closed:** A (company settings admin-only, resequenced apply order + probe 9), B (vehicles staff-status carve-out, Task 4b + probe 10 + app-fix note), C (coverage assertion, Notes), D (settings-page behavior documented), E (identity policy-name assertion, Task 4 Step 2b), F (DELETE / staff-fleet deny probes 8-10), G (broadened grant check, Task 5).
- **Placeholders:** none; every step has runnable SQL and an expected result.
- **Consistency:** functions `can_access_tenant` / `can_manage_tenant` / `guard_vehicle_columns`, policy names `tenant_access` / `tenant_read` / `admin_all` / `vehicles_read` / `vehicles_admin_all` / `vehicles_staff_status` / `tenants_select` / `profiles_select` / `company_profiles_*` / `companies_select`, and the `excluded` / `writes_closed` / `admin_write` arrays, are used consistently across Tasks 2-6.
