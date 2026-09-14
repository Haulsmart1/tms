-- prodfix_30: refuse to put a vehicle with no active licence to work.
-- Apply manually in the Supabase SQL editor, like the rls_* and billing_*
-- series. Safe to re-run: every statement is guarded or `or replace`.
--
-- FINDING: BILL1-1 (CRITICAL), 2026-09-14 production-readiness review.
--
-- WHY. Both billing models bill only vehicles that carry an active
-- vehicle_licences row, and until now nothing operational read that table. A
-- company could leave "Active for billing" unticked (or deactivate every
-- licence the day before a v1 charge) and keep dispatching, planning and
-- tracking the whole fleet for GBP 0. Billing was opt-in.
--
-- DECISION (product owner): gate usage. A vehicle with no active licence cannot
-- be NEWLY assigned to work. Enforced here in Postgres, so neither the browser
-- (supabase-js with the user's own token) nor a server route can bypass it.
--
-- WHAT COUNTS AS LICENSED. At least one vehicle_licences row for the vehicle
-- with active = true. That is the single billable definition in
-- lib/billing/vehicleCount.ts ("billable if ANY licence is active"). Rows are
-- never counted: one vehicle legitimately carries an O-licence, a waste carrier
-- licence and an ADR certificate at once. Only `active` is read, so this file
-- does not depend on billing_03 or billing_07 being applied.
--
-- GATED (table.column, and the write path that reaches it):
--   jobs.vehicle_id                        app/jobs/page.tsx insert/update,
--                                          app/planning/page.tsx lane save
--   vehicle_assignments.vehicle_id         rpc assign_driver_to_vehicle
--                                          (app/drivers/page.tsx)
--   load_manifests.vehicle_id              rpc create_load_manifest
--                                          (app/api/load-manifests/route.ts)
--   planning_route_itineraries.vehicle_id  rpc replace_planning_route_itinerary
--                                          (app/planning/page.tsx)
--
-- DELIBERATELY NOT GATED:
--   telematics_positions  GPS ingest for a vehicle that is already assigned
--                         (app/api/driver/location/route.ts requires an active
--                         vehicle_assignments row, which is gated). Dropping
--                         position data is worse than recording it.
--   maintenance_records   servicing or inspecting an unlicensed vehicle is
--                         legitimate and is not operating it.
--   load manifest scan events (rpc record_load_manifest_event): they record
--                         activity against a manifest that was gated at create.
--
-- GRANDFATHERING. The trigger fires only when the vehicle column is set to a
-- non-null value on INSERT, or CHANGED to a different non-null value on UPDATE.
-- An existing assignment to a now-unlicensed vehicle keeps working, and any
-- unrelated update to that row (status, route_order, notes) passes. Clearing
-- the column (unassigning) always passes. Note one consequence: an RPC that
-- replaces rows by delete-then-insert (replace_planning_route_itinerary may)
-- is a NEW assignment and is refused for an unlicensed vehicle. That is the
-- intended reading of "put to use".
--
-- NO ROLE EXEMPTION. The service role is gated too: create_load_manifest runs
-- on the service role, and a server route must not be a way around this. Fix a
-- stuck case by activating a licence, not by bypassing the trigger.
--
-- ERROR CONTRACT (mirrored by lib/billing/unlicensedVehicle.ts; change both):
--   errcode  LIC01 (custom SQLSTATE; PostgREST returns it as `code`, HTTP 400)
--   message  Vehicle <registration or id> has no active licence. Activate it
--            on the Licences page before assigning it.
--   hint     vehicle_unlicensed
--   detail   vehicle_id=<uuid> table=<table>
--
-- WHY SECURITY DEFINER IS SAFE HERE, when billing_03 and billing_07 argue
-- against it for their guards. Those guards compare current_user to an exempt
-- list, which definer rights would break. This one has no role check at all: it
-- only READS whether a licence is active and RAISES. Definer rights are needed
-- so RLS cannot hide the licence or vehicle row from a staff caller (who may
-- assign vehicles but not read licences), which would otherwise refuse a
-- legitimately licensed vehicle. A trigger function cannot be invoked directly
-- (Postgres refuses to call a `returns trigger` function outside a trigger), and
-- EXECUTE is revoked from public, anon and authenticated anyway. search_path is
-- pinned so a caller cannot shadow vehicle_licences.
--
-- LIVE-STATE CAVEAT. The four tables above are inferred from application code;
-- none of them is defined in docs/sql. Each is checked in the catalogue before
-- its trigger is installed, and a missing table or column is SKIPPED with a
-- notice rather than failing the file. This file never grants anything and never
-- alters a policy, so a live schema that differs cannot widen access; at worst a
-- table goes ungated, which the notice and the verify query at the bottom show.
-- Run docs/sql/diag_2026_09_14_live_state.sql section 10 if in doubt.
--
-- ORDER. Deploy the UI message handling (isUnlicensedVehicleError) before or
-- with this file; without it the pages show the raw Postgres message, which is
-- already human readable. Before applying, check how many live assignments are
-- unlicensed so nobody is surprised the next time they edit a plan:
--
--   select 'jobs' as t, count(*) from public.jobs j
--   where j.vehicle_id is not null and not exists (
--     select 1 from public.vehicle_licences vl
--     where vl.vehicle_id = j.vehicle_id and vl.active is true)
--   union all
--   select 'vehicles_without_active_licence', count(*) from public.vehicles v
--   where not exists (select 1 from public.vehicle_licences vl
--                     where vl.vehicle_id = v.id and vl.active is true);
--
-- ROLLBACK (removes the gate entirely; billing becomes opt-in again):
--
--   drop trigger if exists gate_vehicle_licensed on public.jobs;
--   drop trigger if exists gate_vehicle_licensed on public.vehicle_assignments;
--   drop trigger if exists gate_vehicle_licensed on public.load_manifests;
--   drop trigger if exists gate_vehicle_licensed on public.planning_route_itineraries;
--   drop function if exists public.guard_vehicle_assignment_licensed();

begin;

create or replace function public.guard_vehicle_assignment_licensed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_column text := tg_argv[0];
  v_new text;
  v_old text;
  v_vehicle uuid;
  v_registration text;
begin
  if v_column is null then
    raise exception 'guard_vehicle_assignment_licensed needs the vehicle column name as its argument';
  end if;

  v_new := to_jsonb(new) ->> v_column;

  -- Unassigning, or a row with no vehicle, is always allowed.
  if v_new is null or v_new = '' then
    return new;
  end if;

  -- Grandfathered: an update that leaves the vehicle unchanged is not a new
  -- assignment, whatever else it changes.
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) ->> v_column;
    if v_old is not distinct from v_new then
      return new;
    end if;
  end if;

  v_vehicle := v_new::uuid;

  -- ANY active licence makes the vehicle usable (lib/billing/vehicleCount.ts).
  if exists (
    select 1 from public.vehicle_licences vl
    where vl.vehicle_id = v_vehicle and vl.active is true
  ) then
    return new;
  end if;

  select nullif(btrim(v.registration), '') into v_registration
  from public.vehicles v where v.id = v_vehicle;

  raise exception 'Vehicle % has no active licence. Activate it on the Licences page before assigning it.',
      coalesce(v_registration, v_vehicle::text)
    using errcode = 'LIC01',
          hint = 'vehicle_unlicensed',
          detail = format('vehicle_id=%s table=%s', v_vehicle, tg_table_name);
end $$;

revoke all on function public.guard_vehicle_assignment_licensed() from public, anon, authenticated;

-- Install one trigger per gated table, only where the table and column exist.
-- The trigger name gate_vehicle_licensed is not used anywhere else in docs/sql
-- (existing names: guard_profiles_privileged_columns, guard_vehicle_columns,
-- guard_vehicle_licence_active, guard_vehicle_licence_lifecycle,
-- set_vehicle_licence_vrn, sync_vehicle_licence_lifecycle).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('jobs', 'vehicle_id'),
      ('vehicle_assignments', 'vehicle_id'),
      ('load_manifests', 'vehicle_id'),
      ('planning_route_itineraries', 'vehicle_id')
    ) as t(table_name, column_name)
  loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = r.table_name
        and c.column_name = r.column_name
    ) then
      raise notice 'prodfix_30: public.%.% not found, NOT gated', r.table_name, r.column_name;
      continue;
    end if;

    execute format('drop trigger if exists gate_vehicle_licensed on public.%I', r.table_name);
    execute format(
      'create trigger gate_vehicle_licensed before insert or update of %I on public.%I
         for each row execute function public.guard_vehicle_assignment_licensed(%L)',
      r.column_name, r.table_name, r.column_name
    );
    raise notice 'prodfix_30: gated public.%.%', r.table_name, r.column_name;
  end loop;
end $$;

commit;

-- ===========================================================================
-- VERIFY.
-- ===========================================================================
--
-- 1. The trigger is on every table that exists. Expect one row per gated table
--    (jobs, vehicle_assignments, load_manifests, planning_route_itineraries);
--    a missing row means that table was skipped and is NOT gated.
--
--      select c.relname as table_name, t.tgname, t.tgenabled
--      from pg_trigger t join pg_class c on c.oid = t.tgrelid
--      where t.tgname = 'gate_vehicle_licensed' and not t.tgisinternal
--      order by 1;
--
-- 2. The function is definer, has a pinned search_path, and nobody holds
--    EXECUTE except the owner.
--
--      select proname, prosecdef, proconfig, proacl from pg_proc
--      where oid = 'public.guard_vehicle_assignment_licensed()'::regprocedure;
--
-- 3. It bites, and it grandfathers. Rolled back; leaves nothing behind. Needs
--    one job and one vehicle with no active licence in the same tenant.
--
--      begin;
--      -- must FAIL with LIC01:
--      update public.jobs set vehicle_id = (
--        select v.id from public.vehicles v where not exists (
--          select 1 from public.vehicle_licences vl
--          where vl.vehicle_id = v.id and vl.active is true) limit 1)
--      where id = (select id from public.jobs limit 1);
--      rollback;
--
--      begin;
--      -- must SUCCEED: an unrelated update to a row whose vehicle is unchanged
--      update public.jobs set vehicle_id = vehicle_id
--      where id = (select id from public.jobs where vehicle_id is not null limit 1);
--      rollback;
select c.relname as gated_table, t.tgname as trigger_name, t.tgenabled as enabled
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and t.tgname = 'gate_vehicle_licensed'
  and not t.tgisinternal
order by 1;
