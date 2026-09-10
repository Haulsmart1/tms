-- billing_07: give vehicle_licences a lifecycle (activated_at / deactivated_at),
-- a normalised registration, and a grace window.
-- Apply manually in the Supabase SQL editor, like the rls_* and billing_*
-- series.
--
-- DO NOT PASTE THIS WHOLE FILE INTO THE EDITOR AND RUN IT. STEP 2 must not
-- reach the database until the licences page has been changed to deactivate
-- rather than delete. Run each step by selecting it.
--
-- ORDER MATTERS.
--
--   1. Apply billing_06 first (it is additive and safe at any time).
--   2. Run STEP 1 (everything down to the STEP 2 banner). Safe against the
--      CURRENT code: every column is nullable or defaulted and nothing
--      deployed reads them.
--   3. Deploy the code.
--   4. Soak, then run STEP 2.
--
-- STEP 1 IS NOT A MONEY HAZARD. It adds columns and backfills them, and no
-- deployed code path reads any of them: v2 billing is gated on
-- company_billing.billing_model, which billing_06 defaults to 'v1_immediate'.
-- Compare billing_04, where a missing function threw AFTER Square had taken
-- money. The worst case here is a backfill that has to be re-run.
--
-- STEP 2 REVOKES THE BROWSER'S DELETE. Run it early and the licences page's
-- delete button starts failing with 42501 in front of a user.
--
-- WHY DELETE HAS TO GO. billing_03 deliberately KEPT the delete grant, on the
-- reasoning that removing a licence can only reduce a bill under prepayment.
-- Under arrears that reasoning inverts: the invoice is computed at period
-- close from the licence rows, so deleting one destroys the evidence of what
-- was billable. A deleted licence is a vehicle that silently vanishes from an
-- invoice it should have appeared on. Deactivation replaces it and loses
-- nothing, because rule 4 already bills a deactivated licence to the period
-- end.
--
-- ============================ PRE-FLIGHT ==================================
--
-- 1. billing_01 through billing_05 are APPLIED (confirmed by Ethan,
--    2026-09-10). Two things follow, and both are load-bearing.
--
--    The browser has no INSERT on vehicle_licences at all, and UPDATE only on
--    (licence_type, issue_date, expiry_date, notes). So the columns added
--    below are already unwritable from a browser the moment they exist: a
--    column added after an allowlist grant is not covered by it. The trigger
--    in STEP 1c is therefore the SECOND layer, which is what it was designed
--    to be, not the only one.
--
--    Every licence write already goes through /api/licences/activate on the
--    service role. That is why the sync trigger below can assume `active` is
--    only ever moved by a trusted caller.
--
--    Re-confirm before applying if any time has passed, since the grant state
--    is the thing that makes the paragraph above true:
--
--      select grantee, privilege_type, count(*)
--      from information_schema.column_privileges
--      where table_schema = 'public' and table_name = 'vehicle_licences'
--        and grantee in ('authenticated', 'PUBLIC')
--      group by grantee, privilege_type;
--
--    Expect UPDATE against authenticated on exactly four columns, and nothing
--    at all against PUBLIC.
--
-- 2. DO NOT ADD THE BRIEF'S ONE-ACTIVE-LICENCE-PER-VEHICLE INDEX.
--    The brief specified
--
--      create unique index vehicle_licences_one_active
--        on vehicle_licences (tenant_id, vehicle_id) where deactivated_at is null;
--
--    That assumed this table holds one billing seat per vehicle. It does not.
--    app/settings/licences asks for a free-text licence type, an issue date
--    and an expiry date: these are COMPLIANCE documents, and a vehicle
--    legitimately holds an O-licence, a waste carrier licence and an ADR
--    certificate at once. The index would break that feature outright, and it
--    would do so the first time an operator added a second document rather
--    than at deploy.
--
--    Rule 5 (one invoice line per vehicle per period) does not need it.
--    collectPeriodVehicles groups licence rows by vehicle, and
--    invoice_lines_one_per_vehicle in billing_06 enforces the result.
--
--    Run this to see how many vehicles would have been broken by it:
--
--      select count(*) from (
--        select vehicle_id from public.vehicle_licences
--        where active is true group by vehicle_id having count(*) > 1
--      ) s;
--
-- 3. CONFIRM THE SERVICE ROLE NAME, as billing_03 does, before STEP 1c. The
--    trigger exempts ('postgres', 'supabase_admin', 'service_role'); a wrong
--    name here rejects the server's own writes and licence creation stops
--    working. See the billing_03 header for how to check it without a SQL
--    connection.

-- ===========================================================================
-- STEP 1: run BEFORE deploying the code. Safe against the current code.
-- ===========================================================================
--
-- One transaction: a mid-batch abort would otherwise leave some rows
-- backfilled and some not, with a trigger installed that assumes both.
begin;

-- ------------------------------------------------------------------ 1a: DDL

-- The lifecycle. `active` is NOT dropped: v1 companies still bill from it
-- (lib/billing/vehicleCount.ts), the licences page still reads it, and the
-- two models run side by side until the last company is migrated. The trigger
-- in 1c keeps them consistent so a company can cross over at any time.
alter table public.vehicle_licences
  add column if not exists activated_at timestamptz;

alter table public.vehicle_licences
  add column if not exists deactivated_at timestamptz;

-- upper(replace(registration, ' ', '')) at activation time, snapshotted so a
-- re-registered vehicle cannot recycle a grace window by changing plate.
alter table public.vehicle_licences
  add column if not exists vrn_normalised text;

-- End of the free window. Set only on the first ever licence for a
-- registration within a company, which is what stops grace being recycled by
-- deleting and re-adding a vehicle. Null on every other row, including every
-- row that exists today.
alter table public.vehicle_licences
  add column if not exists grace_until timestamptz;

alter table public.vehicle_licences
  add column if not exists created_by uuid;

comment on column public.vehicle_licences.activated_at is
  'When this licence became billable. Server-only; see guard_vehicle_licence_lifecycle.';
comment on column public.vehicle_licences.deactivated_at is
  'When it stopped. Null means active. Rule 4: deactivation stops renewal, it does not refund.';
comment on column public.vehicle_licences.grace_until is
  'Free until this instant. Set only on the first ever licence for this VRN in this company.';

-- -------------------------------------------------------------- 1b: backfill

-- activated_at from created_at is TRUTHFUL but not what a migrating company
-- should be billed from. The per-company switch-over script
-- (scripts/migrate-company-to-period-billing.mjs) resets activated_at to the
-- company's first v2 period start, so nobody is charged proration for days
-- they already paid for under v1. This backfill only ensures the column is
-- never null.
update public.vehicle_licences
set activated_at = created_at
where activated_at is null;

-- An inactive licence gets deactivated_at = activated_at: a zero-length
-- licence. We genuinely do not know when it was switched off, `active` being
-- a boolean with no history, and this is the direction that fails toward NOT
-- billing. A zero-length licence in the past overlaps no future period
-- (overlapsPeriod requires deactivated_at > period_start), so it can never
-- appear on an invoice. Inventing a plausible deactivation date instead could
-- put it inside a period and bill for it.
update public.vehicle_licences
set deactivated_at = activated_at
where deactivated_at is null
  and active is not true;

-- Registration is nullable on vehicles, so fall back to the vehicle id. That
-- keys grace to the vehicle rather than to the plate for those rows, which
-- means grace cannot be shared between two unregistered vehicles and cannot
-- be recycled either. Both directions are safe; only the plate-based
-- anti-recycling guarantee is weaker, and it is weaker only for vehicles that
-- have no plate recorded.
update public.vehicle_licences vl
set vrn_normalised = coalesce(
  nullif(upper(replace(v.registration, ' ', '')), ''),
  vl.vehicle_id::text
)
from public.vehicles v
where v.id = vl.vehicle_id
  and vl.vrn_normalised is null;

-- Any licence whose vehicle row has gone. Keeps the NOT NULL below honest.
update public.vehicle_licences
set vrn_normalised = vehicle_id::text
where vrn_normalised is null;

alter table public.vehicle_licences
  alter column activated_at set not null;
alter table public.vehicle_licences
  alter column activated_at set default now();
alter table public.vehicle_licences
  alter column vrn_normalised set not null;

-- `>=`, not the brief's `>`. The backfill above deliberately writes
-- zero-length licences for rows that are inactive with no known end date, and
-- a strict `>` would reject every one of them.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_licences'::regclass
      and conname = 'vehicle_licences_deactivated_after_activated'
  ) then
    alter table public.vehicle_licences
      add constraint vehicle_licences_deactivated_after_activated
      check (deactivated_at is null or deactivated_at >= activated_at);
  end if;
end $$;

-- The close job's query: every licence overlapping a period for a company.
create index if not exists vehicle_licences_lifecycle_idx
  on public.vehicle_licences (vehicle_id, activated_at, deactivated_at);

-- Rule 7's lookup: has this registration ever been licensed here before?
create index if not exists vehicle_licences_vrn_idx
  on public.vehicle_licences (tenant_id, vrn_normalised);

-- -------------------------------------------------------------- 1c: triggers

-- Keeps vrn_normalised populated no matter which route wrote the row. The v1
-- licences page inserts without it, and a null here would break the grace
-- lookup silently (a null never matches, so every licence would look like the
-- first for its registration and grace would become infinitely recyclable the
-- day grace_days is switched on).
create or replace function public.set_vehicle_licence_vrn()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_registration text;
begin
  if new.vrn_normalised is null or new.vrn_normalised = '' then
    select registration into v_registration
    from public.vehicles where id = new.vehicle_id;

    new.vrn_normalised := coalesce(
      nullif(upper(replace(v_registration, ' ', '')), ''),
      new.vehicle_id::text
    );
  end if;
  return new;
end $$;

drop trigger if exists set_vehicle_licence_vrn on public.vehicle_licences;
create trigger set_vehicle_licence_vrn
  before insert or update of vehicle_id, vrn_normalised
  on public.vehicle_licences
  for each row execute function public.set_vehicle_licence_vrn();

-- Keeps the lifecycle columns consistent with `active` while both models are
-- live. v1 routes write only `active`; v2 routes write the timestamps. A
-- company is on exactly one model, so the two never interleave for one
-- company, but a company that MIGRATES must arrive with coherent history.
--
-- This does not attempt to reconstruct one-row-per-activation history for v1
-- rows, and it does not need to: the switch-over script resets activated_at
-- to the company's first v2 period start anyway.
create or replace function public.sync_vehicle_licence_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.activated_at is null then
      new.activated_at := now();
    end if;
    -- Created already inactive: a compliance record for a licence that is not
    -- billable. Zero-length, for the same reason as the backfill.
    if new.active is not true and new.deactivated_at is null then
      new.deactivated_at := new.activated_at;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Only react when `active` itself moved. A v2 route writing the
    -- timestamps directly leaves `active` alone on that statement, so this
    -- must not clobber what it just wrote.
    if new.active is distinct from old.active then
      if new.active is true then
        new.activated_at := now();
        new.deactivated_at := null;
      elsif new.deactivated_at is null then
        new.deactivated_at := now();
      end if;
    end if;
    return new;
  end if;

  return new;
end $$;

drop trigger if exists sync_vehicle_licence_lifecycle on public.vehicle_licences;
create trigger sync_vehicle_licence_lifecycle
  before insert or update on public.vehicle_licences
  for each row execute function public.sync_vehicle_licence_lifecycle();

-- The new columns decide money, so the browser must not write them. This is a
-- SEPARATE trigger from billing_03's guard_vehicle_licence_active rather than
-- an edit to it, so that this file is correct whether or not billing_03 has
-- been applied. Both may be installed; both simply raise.
--
-- NOT security definer, for the reason billing_03 sets out at length: under
-- definer rights current_user evaluates to the function OWNER, so every check
-- below would compare postgres against the exempt list, pass, and the trigger
-- would enforce nothing while looking installed.
--
-- TRIGGER ORDER IS LOAD-BEARING HERE. Postgres fires BEFORE triggers in
-- alphabetical order by trigger NAME, and the three names in this file sort:
--
--   guard_vehicle_licence_active     (billing_03, if applied)
--   guard_vehicle_licence_lifecycle  (this one)
--   set_vehicle_licence_vrn
--   sync_vehicle_licence_lifecycle
--
-- so both guards run BEFORE the two triggers that fill columns in. That is
-- what makes this work: the guard sees NEW exactly as the client wrote it and
-- judges the client's intent, then set_ and sync_ populate vrn_normalised and
-- the lifecycle columns without tripping it.
--
-- Reverse that order and every browser write breaks: sync_ would stamp
-- deactivated_at, the guard would then see deactivated_at change against OLD,
-- and it would reject a write the user was entitled to make. If either of
-- these triggers is ever renamed, check the new name still sorts before
-- set_/sync_.
create or replace function public.guard_vehicle_licence_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A browser may create a licence, but never one that is already inside a
    -- grace window it granted itself.
    if new.grace_until is not null then
      raise exception 'vehicle_licences.grace_until is server-only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.activated_at is distinct from old.activated_at
       or new.deactivated_at is distinct from old.deactivated_at
       or new.grace_until is distinct from old.grace_until
       or new.vrn_normalised is distinct from old.vrn_normalised then
      raise exception 'vehicle_licences billing columns are server-only; use /api/licences/activate'
        using errcode = '42501';
    end if;
    return new;
  end if;

  return new;
end $$;

drop trigger if exists guard_vehicle_licence_lifecycle on public.vehicle_licences;
create trigger guard_vehicle_licence_lifecycle
  before insert or update on public.vehicle_licences
  for each row execute function public.guard_vehicle_licence_lifecycle();

commit;

-- ===========================================================================
-- STEP 2: run AFTER the code is deployed and has soaked.
-- ===========================================================================
--
-- Removes the browser's ability to delete a licence. Do not run this until
-- app/settings/licences deactivates instead of deleting, or the delete button
-- fails with 42501 in front of a user.
--
-- `public` is revoked alongside the API roles for the reason billing_03 sets
-- out: a grant to PUBLIC is a separate ACL entry that every role inherits, and
-- revoking from authenticated leaves it untouched.
begin;

revoke delete on public.vehicle_licences from authenticated, anon, public;

commit;

-- ===========================================================================
-- VERIFY.
-- ===========================================================================
--
-- 1. Every licence has a lifecycle, and the active ones are open.
--
--      select
--        count(*) filter (where activated_at is null) as missing_activated,
--        count(*) filter (where vrn_normalised is null) as missing_vrn,
--        count(*) filter (where active is true and deactivated_at is not null)
--          as active_but_closed,
--        count(*) filter (where active is not true and deactivated_at is null)
--          as inactive_but_open
--      from public.vehicle_licences;
--
--    All four must be 0.
--
-- 2. Nobody has been granted grace by the backfill.
--
--      select count(*) from public.vehicle_licences where grace_until is not null;
--
--    Must be 0. Grace is only ever granted by /api/licences/activate.
--
-- 3. The sync trigger tracks `active` in both directions. Run as postgres in
--    the SQL editor, which is exempt from the guard, and roll back:
--
--      begin;
--      update public.vehicle_licences set active = false
--      where id = (select id from public.vehicle_licences where active is true limit 1);
--      select active, activated_at, deactivated_at from public.vehicle_licences
--      where id = (select id from public.vehicle_licences order by created_at limit 1);
--      rollback;
--
-- 4. The guard actually bites from a browser session. It cannot be tested in
--    the SQL editor, which connects as postgres and is exempt. From the app,
--    signed in as an admin, in devtools:
--
--      await supabase.from('vehicle_licences')
--        .update({ grace_until: '2030-01-01' }).eq('id', '<some id>');
--
--    Must return an error with code 42501. If it succeeds, the trigger is not
--    installed or the role name list in it is wrong: see PRE-FLIGHT 3.
--
-- ROLLBACK. Reverting the code is safe on its own while only STEP 1 has been
-- applied: the new columns are additive and nothing in the old code reads
-- them. The triggers are harmless to the old code too, since it writes
-- `active` and they only fill in columns it never selects.
--
-- After STEP 2, reverting the code breaks the licences page's delete button,
-- so a revert must restore the grant:
--
--   grant delete on public.vehicle_licences to authenticated;
--
-- Dropping the columns is NOT part of any rollback. Once a company has been
-- switched to v2_period, its invoice history is computed from them.
