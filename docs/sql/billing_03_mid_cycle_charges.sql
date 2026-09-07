-- billing_03: mid-cycle vehicle charges and paid-cycle coverage.
-- Apply manually in the Supabase SQL editor, like the rls_* and billing_*
-- series. Both steps are safe to re-run.
--
-- ORDER MATTERS. This touches live payment code.
--
--   1. Run STEP 1 (everything down to the STEP 2 banner) BEFORE deploying.
--   2. Deploy the code.
--   3. Soak, then run STEP 2.
--
-- Never run STEP 2 first. It revokes the browser's ability to write
-- vehicle_licences, and until the new code is live the licences page writes
-- that table directly: running it early breaks licence creation outright.
--
-- ROLLBACK. Between the deploy and STEP 2 the code reverts cleanly, because
-- everything in STEP 1 is additive and the old code never reads it. After
-- STEP 2, reverting the code breaks licence creation (the browser has no
-- insert grant and can no longer write `active`), so a revert must restore the
-- old table-level grants first:
--
--   grant insert on public.vehicle_licences to authenticated;
--   grant update on public.vehicle_licences to authenticated;
--
-- A table-level update grant satisfies a write on any column on its own, so
-- that one statement undoes the column guard STEP 2 installs; the leftover
-- per-column grants are harmless.

-- ===========================================================================
-- STEP 1: run BEFORE deploying the code.
-- ===========================================================================

-- One row per vehicle per cycle that has actually been paid for. This is what
-- makes billing a paid-coverage set rather than a snapshot taken on charge
-- day, and it is what stops a company deactivating its licences the night
-- before next_charge_on and reactivating them the morning after.
--
-- cycle_date is the date the cycle STARTED (the date the cron charged), not
-- the date the next charge lands. See currentCycleDate in lib/billing/addon.ts.
create table if not exists public.vehicle_cycle_coverage (
  company_id uuid not null references public.companies(id) on delete cascade,
  cycle_date date not null,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id, cycle_date, vehicle_id)
);

create index if not exists vehicle_cycle_coverage_company_cycle_idx
  on public.vehicle_cycle_coverage (company_id, cycle_date);

-- Audit trail for mid-cycle add-on charges. Deliberately NOT folded into
-- platform_charges: that table is unique on (company_id, cycle_date, attempt),
-- which cannot hold several add-ons inside one cycle.
--
-- The 28 in the covers_days check is CYCLE_DAYS (lib/billing/schedule.ts)
-- written out by hand, because a check constraint cannot import it. If the
-- cycle length ever changes, this constraint has to change with it.
create table if not exists public.vehicle_addon_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  cycle_date date not null,
  attempt int not null check (attempt >= 1),
  covers_days int not null check (covers_days between 0 and 28),
  baseline_count int not null check (baseline_count >= 0),
  net_pence bigint not null,
  vat_pence bigint not null,
  gross_pence bigint not null,
  vat_rate numeric not null default 20.0,
  currency text not null default 'GBP',
  square_payment_id text,
  receipt_url text,
  status text not null check (status in ('succeeded', 'failed')),
  failure_code text,
  created_at timestamptz not null default now(),
  unique (company_id, cycle_date, vehicle_id, attempt)
);

create index if not exists vehicle_addon_charges_company_created_idx
  on public.vehicle_addon_charges (company_id, created_at desc);

alter table public.vehicle_cycle_coverage enable row level security;
alter table public.vehicle_addon_charges enable row level security;

-- Read policies mirror billing_01: company admins see their own company's
-- rows, super_admin sees all.
drop policy if exists vehicle_cycle_coverage_select on public.vehicle_cycle_coverage;
create policy vehicle_cycle_coverage_select on public.vehicle_cycle_coverage
  for select to authenticated
  using (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and company_id = public.get_my_company_id())
  );

drop policy if exists vehicle_addon_charges_select on public.vehicle_addon_charges;
create policy vehicle_addon_charges_select on public.vehicle_addon_charges
  for select to authenticated
  using (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and company_id = public.get_my_company_id())
  );

-- No INSERT/UPDATE/DELETE policies on purpose. All writes come from server
-- routes on the service role, which bypasses RLS. Belt and braces: revoke the
-- table grants too, matching billing_01 and rls_05_revoke_grants.sql.
revoke insert, update, delete on public.vehicle_cycle_coverage from authenticated, anon;
revoke insert, update, delete on public.vehicle_addon_charges from authenticated, anon;

-- Backfill coverage for every subscribed company's CURRENT cycle from the
-- live billable set.
--
-- Without this, every existing company's vehicles look uncovered on the day
-- the code deploys, and the first licence toggle after deploy charges the
-- customer again for a vehicle they have already paid for in this cycle.
--
-- The join mirrors countBillableVehicles exactly: a vehicle is the company's
-- when its tenant belongs to the company, OR when its tenant_id IS the
-- company id (rows written before tenants existed). There is no
-- vehicles.company_id column; do not add one to this query.
insert into public.vehicle_cycle_coverage (company_id, cycle_date, vehicle_id)
select distinct
  cb.company_id,
  cb.next_charge_on - 28,
  v.id
from public.company_billing cb
join public.vehicles v
  on v.tenant_id = cb.company_id
  or v.tenant_id in (
    select t.id from public.tenants t where t.company_id = cb.company_id
  )
where cb.status <> 'canceled'
  and exists (
    select 1
    from public.vehicle_licences vl
    where vl.vehicle_id = v.id
      and vl.active is true
  )
on conflict do nothing;

-- ===========================================================================
-- STEP 2: run AFTER the code is deployed and has soaked.
-- ===========================================================================
--
-- This is the actual enforcement. A server route alone would be bypassable
-- with a raw supabase-js call from devtools using the user's own token, which
-- is exactly the hole being closed.
--
-- DELETE is deliberately left alone. Removing a licence never creates
-- billable state, and coverage means a delete-then-reinsert inside one cycle
-- is free anyway.
revoke insert on public.vehicle_licences from authenticated, anon;

-- `active` is the only column on this table that costs money, so ordinary
-- edits (expiry date, notes, licence type) must keep working straight from
-- the browser. Precedent for a column-level guard:
-- docs/sql/profiles_privileged_columns_guard.sql.
--
-- This has to be a full revoke followed by per-column grants, NOT a bare
-- `revoke update (active)`. Postgres holds table-level and column-level
-- privileges separately and allows a write when EITHER of them permits it, so
-- a column-level revoke against a role that still holds the table-level UPDATE
-- grant (which is exactly what Supabase's default grants give authenticated)
-- takes nothing away and leaves the exploit wide open.
--
-- anon is not re-granted: it has no RLS policy on this table and never had any
-- business writing licences.
revoke update on public.vehicle_licences from authenticated, anon;

-- Generated rather than typed out, so that this stays correct as the table
-- gains columns and a later re-run does not silently leave a new column
-- unwritable from the browser.
do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'vehicle_licences'
    and column_name <> 'active';

  if cols is not null then
    execute format('grant update (%s) on public.vehicle_licences to authenticated', cols);
  end if;
end $$;

-- VERIFY the guard. The first query must list every column except `active`;
-- the second must return no UPDATE row, because a surviving table-level grant
-- would make the whole guard a no-op.
--
--   select column_name, privilege_type
--   from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'vehicle_licences'
--     and grantee = 'authenticated' and privilege_type = 'UPDATE'
--   order by column_name;
--
--   select privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'vehicle_licences'
--     and grantee = 'authenticated';
