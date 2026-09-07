-- billing_03: mid-cycle vehicle charges and paid-cycle coverage.
-- Apply manually in the Supabase SQL editor, like the rls_* and billing_*
-- series.
--
-- DO NOT PASTE THIS WHOLE FILE INTO THE EDITOR AND RUN IT. The three steps are
-- separated by comment banners only, so a single paste applies all of them at
-- once, which is exactly the order this header forbids: STEP 2 and STEP 3 must
-- not reach the database until the new code is deployed. Run each step by
-- selecting it.
--
-- ORDER MATTERS. This touches live payment code.
--
--   1. Run STEP 1 (everything down to the STEP 2 banner) BEFORE deploying.
--   2. Deploy the code.
--   3. Re-run the STEP 1 backfill immediately after the deploy (see below).
--   4. Soak, then run STEP 2 and STEP 3 together.
--
-- Never run STEP 2 or STEP 3 first. Between them they remove the browser's
-- ability to write vehicle_licences, and until the new code is live the
-- licences page writes that table directly: running either early breaks
-- licence creation outright. The trigger in STEP 3 does that even for a role
-- that still holds every grant, so it is not covered by re-granting.
--
-- RE-RUN SAFETY, precisely. The DDL, policies, grants and trigger are all
-- idempotent. The backfill is NOT idempotent in general: `on conflict do
-- nothing` only makes it a no-op while next_charge_on has not moved. Re-run it
-- after a cron cycle has advanced that date and it mints fresh coverage at the
-- new cycle date from whatever licences are active at that moment, which is
-- coverage nobody paid for. So: STEP 1 is safe to re-run only inside the
-- window between the first run and the deploy.
--
-- THE STEP-1-TO-DEPLOY GAP. STEP 1 runs while the OLD cron is still live, and
-- the old cron writes no coverage. If a company's charge date falls inside
-- that window, its next_charge_on advances, the backfilled row is left against
-- a now-stale cycle date, and the new cycle has no coverage at all: exactly
-- the double charge the backfill exists to prevent. Keep the window short, and
-- re-run the backfill immediately after the deploy (which is inside the
-- re-run-safe window, since the new cron has not run yet).
--
-- PRE-FLIGHT. The new tables take foreign keys on vehicles(id) and
-- companies(id). Confirm both are uuid before applying, or the create fails on
-- a type mismatch:
--
--   select table_name, column_name, data_type
--   from information_schema.columns
--   where table_schema = 'public' and column_name = 'id'
--     and table_name in ('vehicles', 'companies');
--
-- Nothing may write vehicle_licences with the owner's rights. A SECURITY
-- DEFINER function owned by postgres would bypass the grants AND satisfy the
-- trigger's exemption list, hollowing out both layers at once. It is the exact
-- inverse of the mistake this file avoids in STEP 3, arriving from outside the
-- file. Nothing in docs/sql/ defines one today, but that directory is not a
-- complete picture of the live database (see the rls_11 header). Expect no
-- rows:
--
--   select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosrc ilike '%vehicle_licences%';
--
-- An auto-updatable view without security_invoker checks base-table privileges
-- as the VIEW OWNER, so it bypasses the column allowlist. PostgREST exposes
-- views. Expect no rows:
--
--   select viewname from pg_views where definition ilike '%vehicle_licences%';
--
-- RLS must actually be ON for vehicle_licences. The "DELETE is deliberately
-- left alone" reasoning in STEP 2 assumes the tenant policy bites, and that is
-- not a given here: rls_03 creates a policy for every tenant_id table but
-- never runs `enable row level security`, and rls_11_enable_rls_explicit.sql,
-- which does, is still marked NOT YET APPLIED in its own header. A policy on a
-- table with RLS disabled is inert. This must return true before STEP 2; if it
-- returns false, apply rls_11 first, because otherwise the DELETE grant this
-- file deliberately leaves in place reaches every company's licence rows:
--
--   select relrowsecurity from pg_class
--   where oid = 'public.vehicle_licences'::regclass;
--
-- !!! PRE-FLIGHT FOR STEP 3, READ THIS OR YOU WILL TAKE THE FEATURE DOWN !!!
-- The trigger in STEP 3 exempts the database roles ('postgres',
-- 'supabase_admin', 'service_role'). Those names are an ASSUMPTION about this
-- Supabase project, not a verified fact. If our server routes connect under a
-- name that is not in that list, the trigger rejects the route's OWN writes
-- and adding a vehicle stops working entirely. CONFIRM FIRST by running
--
--   select current_user;
--
-- as the server does. Note you cannot literally run that over the service-role
-- path: that path is PostgREST, which does not execute arbitrary SQL. Either
-- expose a throwaway `create function whoami() returns text language sql as
-- $f$ select current_user $f$;` and call it as the service role, then drop it,
-- or accept the derivation: PostgREST connects as `authenticator` and issues
-- SET ROLE from the JWT `role` claim, so a service-role key yields
-- current_user = 'service_role'. Edit the list in STEP 3 to match before
-- applying it.
--
-- AFTER STEP 2 AND STEP 3, NO BROWSER SESSION CAN TOGGLE `active`, INCLUDING A
-- SUPER ADMIN. Grants and the trigger both key off the database role, and
-- platform staff sit on `authenticated` like everyone else; get_my_role() is
-- an application-level notion this layer never consults. Nothing breaks today,
-- since the super-admin billing page only reads. But the manual escape hatch
-- for fixing a stuck licence by hand is gone, and the remaining routes are the
-- SQL editor or the API. Worth knowing before you need it.
--
-- ROLLBACK. Between the deploy and STEP 2 the code reverts cleanly, because
-- everything in STEP 1 is additive and the old code never reads it. After
-- STEP 2 and STEP 3, reverting the code breaks licence creation (the browser
-- has no insert grant and can no longer write `active`), so a revert must
-- restore the old table-level grants AND drop the trigger:
--
--   grant insert on public.vehicle_licences to authenticated;
--   grant update on public.vehicle_licences to authenticated;
--   drop trigger if exists guard_vehicle_licence_active on public.vehicle_licences;
--
-- A table-level update grant satisfies a write on any column on its own, so
-- that one grant undoes the column guard; the leftover per-column grants are
-- harmless. The trigger is NOT undone by any grant, hence the third line.
--
-- Restoring the INSERT grant on its own does not reopen the free-vehicle hole,
-- because the trigger still refuses an insert with active = true from a
-- non-service role. But it does not restore the old page either, and the
-- earlier wording overstated it: that page's form defaults active to true
-- (useState(true) in app/settings/licences/page.tsx), so the ordinary create
-- path raises 42501 and surfaces a raw Postgres error to the user. With INSERT
-- re-granted and the trigger still in place, a user can create only an
-- INACTIVE licence, and only by unticking the box first. A revert that needs
-- the old page working properly must drop the trigger as well.

-- ===========================================================================
-- STEP 1: run BEFORE deploying the code.
-- ===========================================================================
--
-- One transaction, like STEP 2. A mid-batch abort would otherwise leave the
-- new tables created and carrying Supabase's default DML grants to
-- authenticated, or, aborting earlier still, created with RLS not yet enabled:
-- either state is an open billing table sitting in production until someone
-- notices.
begin;

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
-- cycle length ever changes, this constraint has to change with it. The floor
-- is 1, not 0: selectAddonAction returns `free` for anything <= 0, so a
-- zero-day charge row could only ever be a bill-for-nothing bug, and the
-- constraint should surface it rather than store it.
create table if not exists public.vehicle_addon_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  cycle_date date not null,
  attempt int not null check (attempt >= 1),
  covers_days int not null check (covers_days between 1 and 28),
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

-- Granted explicitly rather than left to Supabase's default privileges, which
-- depend on which role runs this file. A policy without a grant reads as an
-- empty table, not as an error, so the billing page would silently show
-- nothing.
grant select on public.vehicle_cycle_coverage, public.vehicle_addon_charges
  to authenticated;

-- No INSERT/UPDATE/DELETE policies on purpose. All writes come from server
-- routes on the service role, which bypasses RLS. Belt and braces: revoke the
-- table grants too, matching billing_01 and rls_05_revoke_grants.sql.
--
-- `public` is in the list, unlike in those two files. A privilege granted to
-- PUBLIC is held by every role, and `revoke ... from authenticated` does not
-- touch it: the two are separate ACL entries and the effective privilege is
-- their sum, so authenticated keeps whatever PUBLIC has. Revoking it here is
-- the enforcement of what the STEP 2 verify note otherwise only warns about.
revoke insert, update, delete on public.vehicle_cycle_coverage from authenticated, anon, public;
revoke insert, update, delete on public.vehicle_addon_charges from authenticated, anon, public;

-- Backfill coverage for every subscribed company's CURRENT cycle from the
-- live billable set.
--
-- Without this, every existing company's vehicles look uncovered on the day
-- the code deploys, and the first licence toggle after deploy charges the
-- customer again for a vehicle they have already paid for in this cycle.
--
-- Only status = 'active' companies. A past_due company's next_charge_on is
-- frozen, so coverage written for it never ages out, and it would cover the
-- vehicles active today rather than the set a payment actually covered. That
-- would falsify the invariant selectAddonAction leans on ("coverage is only
-- ever written by a payment that actually succeeded"), which is the whole
-- reason it honours alreadyCovered ahead of the status gate.
--
-- The join mirrors countBillableVehicles exactly: a vehicle is the company's
-- when its tenant belongs to the company, OR when its tenant_id IS the
-- company id (rows written before tenants existed). There is no
-- vehicles.company_id column; do not add one to this query.
--
-- The 28 here is CYCLE_DAYS again, same caveat as the covers_days check:
-- next_charge_on is the NEXT charge, so the cycle already paid for started
-- CYCLE_DAYS earlier. This must stay in step with currentCycleDate.
--
-- It grants coverage for that cycle without checking a payment actually landed
-- for it. True today, because the card-setup route charges immediately, so an
-- active company has paid for the cycle in progress. Tightening this with an
-- `exists` against platform_charges is deliberately NOT done: any row it
-- wrongly excluded would leave a paid vehicle uncovered, and an uncovered
-- vehicle gets charged again. The loose form fails toward free, the tight form
-- fails toward double-billing.
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
where cb.status = 'active'
  and exists (
    select 1
    from public.vehicle_licences vl
    where vl.vehicle_id = v.id
      and vl.active is true
  )
on conflict do nothing;

commit;

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
--
-- One transaction on purpose: if the revoke landed and the grant did not,
-- authenticated would lose UPDATE on the whole table and the licences page
-- would break with no half-applied state to reason about.
begin;

-- `public` is revoked alongside the two API roles throughout STEP 2. A grant
-- to PUBLIC is a separate ACL entry that every role inherits, and revoking
-- from authenticated leaves it completely untouched, so a stray
-- `grant update on ... to public` would keep the hole open while both queries
-- an operator is likely to run against `grantee = 'authenticated'` show
-- nothing wrong.
revoke insert on public.vehicle_licences from authenticated, anon, public;

-- `active` is the column that costs money, so it must not be writable from the
-- browser, while ordinary edits (expiry date, notes, licence type) keep
-- working. Precedent for a column-level guard:
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
revoke update on public.vehicle_licences from authenticated, anon, public;

-- An explicit allowlist, NOT "every column except active". Generating the
-- list from the catalogue would grant vehicle_id, which is a bypass of this
-- very guard: repointing an active licence's vehicle_id makes a different
-- vehicle billable mid-cycle with no charge and no coverage row, without ever
-- touching `active`. It would also auto-grant any future column, which for a
-- table that decides billing is the wrong default. A column added later is
-- unwritable from the browser until it is added here on purpose.
grant update (licence_type, issue_date, expiry_date, notes)
  on public.vehicle_licences to authenticated;

commit;

-- Note the asymmetry with STEP 3: the allowlist leaves FIVE columns unwritable
-- (id, tenant_id, vehicle_id, active, created_at) while the trigger guards
-- TWO (active, vehicle_id). That is correct today rather than an oversight.
-- Only `active` and `vehicle_id` are billing inputs, and the trigger exists to
-- survive the grants being wiped, so it need only cover what costs money. The
-- licence's own tenant_id is not consulted by billing: countBillableVehicles
-- reads vehicles.tenant_id, never vehicle_licences.tenant_id. If that ever
-- changes, the trigger needs a third clause, because the grant layer alone is
-- one careless `grant all` away from gone.

-- VERIFY the guard. The first query must list exactly the four allowlisted
-- columns against authenticated, and nothing at all against PUBLIC. The second
-- must contain no UPDATE grant reachable by authenticated: neither an
-- `authenticated=...U...` entry nor a bare `=...U...` entry, which is PUBLIC
-- and sums into every role's effective privileges. Neither query filters to
-- grantee = 'authenticated' alone, because that is precisely the filter that
-- cannot see a PUBLIC grant.
--
--   select grantee, column_name, privilege_type
--   from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'vehicle_licences'
--     and grantee in ('authenticated', 'PUBLIC') and privilege_type = 'UPDATE'
--   order by grantee, column_name;
--
--   select relacl from pg_class where oid = 'public.vehicle_licences'::regclass;

-- ===========================================================================
-- STEP 3: defence in depth. Run with STEP 2.
-- ===========================================================================
--
-- The grants above are the primary control, but they are one careless
-- `grant all on all tables in schema public to authenticated` away from being
-- silently gone, with no error and no failing test. This trigger does not
-- depend on the grant state at all. Precedent: profiles_privileged_columns_guard.sql.
--
-- It covers INSERT as well as UPDATE, for the same reason that guard does: an
-- update-only trigger is bypassable by inserting an already-active licence, or
-- by delete-then-insert, neither of which fires an update trigger. Today the
-- INSERT revoke in STEP 2 also blocks that, but relying on the grant alone
-- would leave this control single-layered, which is the fragility STEP 3
-- exists to remove.
--
-- Confirm the role names below against `select current_user;` on a
-- service-role connection BEFORE running this. See the pre-flight warning in
-- the header: a wrong name here rejects the route's own writes and vehicle
-- addition stops working.
-- NOT security definer, deliberately, and this is load-bearing rather than
-- stylistic. Under SECURITY DEFINER current_user evaluates to the function
-- OWNER, not the caller, and this file is applied in the SQL editor as
-- postgres: every check below would then compare postgres against the exempt
-- list, pass, and the trigger would enforce nothing while looking installed.
-- It needs no elevated privileges anyway, since all it does is raise. The
-- precedent, guard_profiles_privileged_columns, is invoker-rights for the same
-- reason. current_user (not session_user) is also the right test: PostgREST
-- connects as `authenticator` and reaches the caller's role by SET ROLE, so
-- session_user cannot tell a browser request from a service-role one.
create or replace function public.guard_vehicle_licence_active()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- INSERT first, because OLD does not exist on that path and referencing it
  -- below would error. An inactive licence costs nothing, so creating one from
  -- the browser stays allowed; only activation moves money.
  if tg_op = 'INSERT' then
    if new.active is true
       and current_user not in ('postgres', 'supabase_admin', 'service_role') then
      raise exception 'vehicle_licences.active is server-only; use /api/licences/activate'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Tested explicitly rather than left as the fallthrough. Inert today, since
  -- the trigger is insert-or-update only, but if `delete` is ever added to the
  -- trigger definition the fallthrough would dereference an unassigned NEW and
  -- every delete would error.
  if tg_op = 'UPDATE' then
    if new.active is distinct from old.active
       and current_user not in ('postgres', 'supabase_admin', 'service_role') then
      raise exception 'vehicle_licences.active is server-only; use /api/licences/activate'
        using errcode = '42501';
    end if;
    if new.vehicle_id is distinct from old.vehicle_id
       and current_user not in ('postgres', 'supabase_admin', 'service_role') then
      raise exception 'vehicle_licences.vehicle_id is server-only; it decides billing'
        using errcode = '42501';
    end if;
    return new;
  end if;

  return new;
end $$;

drop trigger if exists guard_vehicle_licence_active on public.vehicle_licences;
create trigger guard_vehicle_licence_active
  before insert or update on public.vehicle_licences
  for each row execute function public.guard_vehicle_licence_active();
