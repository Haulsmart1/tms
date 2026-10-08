-- shifts_06: rectification and POD guards.
--
-- Findings from docs/superpowers/reviews/2026-10-08-security-scan.md (patch order step 3). The
-- shifts and walkaround SQL (shifts_01..04) has been live since 2026-10-08 without these guards.
--
--   1. S-1 (HIGH). Any tenant member could PATCH maintenance_records.status = 'completed' on the
--      record a dangerous walkaround defect points at. rectify_walkaround_defect then set
--      rectified_at, WLK01 let the vehicle return to service, and the manage-only objection route
--      and its liability acceptance were bypassed with no audit row. Now a BEFORE UPDATE / BEFORE
--      DELETE trigger with INVOKER rights (current_user must be the real caller; under SECURITY
--      DEFINER it would always be the owner and enforce nothing, see billing_03 STEP 3) refuses,
--      errcode WLK06, any change to status, vehicle_id or tenant_id, and any delete, of a record
--      linked from walkaround_defects.maintenance_record_id, unless the caller is service_role /
--      postgres / supabase_admin or can_manage_tenant(old.tenant_id). The link lookup goes through
--      a small SECURITY DEFINER helper so the caller's RLS cannot hide the defect row.
--   2. walkaround_defects.rectified_by records who completed the repair (auth.uid(); null when
--      the server did it). Reopening a completed record (status moves away from completed) now
--      puts the vehicle back off the road when a reopened defect is dangerous and has no approved
--      objection. Before, it only cleared rectified_at and left the vehicle in service.
--   3. WLK02 backstop. walkaround_submit_check now refuses a start or swap check on a vehicle that
--      has an open dangerous defect (rectified_at null, no approved objection), even if vor was
--      somehow cleared. Done as a create or replace of the full shifts_04 body with two additions,
--      NOT as a BEFORE INSERT trigger on walkaround_checks: a trigger would also fire on
--      end-of-shift checks inserted by shift_record_event, and refusing those would stop a driver
--      reporting a dangerous defect on the vehicle they are driving. In the function the check sits
--      after the client_id duplicate lookup, so a retry of a check that was saved is still answered
--      as a duplicate and never refused (the shifts_04 ordering rule).
--   4. N-3 (HIGH). jobs and job_stops carry only `tenant_access FOR ALL`, so a driver-role or
--      role-less profile could mark a stop delivered with any time and no photo. A BEFORE UPDATE
--      trigger with invoker rights now refuses, errcode POD01, changes to job_stops.status,
--      pod_status, delivered_at, collected_at, pod_flags and jobs.status, pod_status by a caller who
--      is not an office caller. "Office" mirrors lib/jobs/officeRoles.ts isOfficeCaller, with one
--      deliberate tightening: admin and super_admin always pass; a role named driver or
--      subcontractor_driver is refused; any other role is refused only if the user has an active
--      driver_users link or an active subcontractor_users link with role driver; and a NULL or empty
--      role is REFUSED (the app treats it as office, which is the C-4 hole). service_role, postgres
--      and supabase_admin are exempt, so every /api/driver/** route and every SECURITY DEFINER RPC is
--      unaffected. Columns are compared through to_jsonb, so a column that does not exist live
--      (collected_at, pod_flags before tracking_02) is simply never "changed".
--   5. N-12 (LOW). job_stops.job_id is bound to the row's tenant, the prodfix_90 pattern (SECURITY
--      DEFINER lookup, identical error whether the job is missing or another tenant's). Installed
--      only when no existing row already disagrees; otherwise it is skipped with a WARNING and the
--      count, so the rest of this file still applies.
--   6. S-16. walkaround_submit_check and shift_office_start now assert the driver belongs to the
--      tenant (drivers.tenant_id is the tenant, or its company id on legacy rows, the same rule the
--      vehicle lookup uses), errcode SHF08. The routes already resolve the driver from the tenant,
--      so this should never fire; it stops a route bug writing another tenant's driver.
--
-- Every function created here pins search_path = public, pg_temp.
-- Apply AFTER prodfix_96 (which, among other things, re-runs the shifts_03 licence gate).
-- Needs shifts_01..04 and rls_02 helpers. Safe to re-run.
--
-- APP FOLLOW-UPS (not required for correctness):
--   * lib/walkaround/server.ts KNOWN_RPC_REFUSALS: add SHF08 if a 409 is preferred to a 500.
--   * app/maintenance/page.tsx: show a friendly message for WLK06 (staff completing a
--     defect-linked repair now need an admin).
--   * app/jobs/page.tsx, lib/pod/savePod.ts: show a friendly message for POD01.

begin;

do $$
begin
  if to_regclass('public.walkaround_defects') is null
     or to_regclass('public.maintenance_records') is null
     or to_regprocedure('public.walkaround_submit_check(jsonb)') is null
     or to_regprocedure('public.shift_office_start(jsonb)') is null then
    raise exception 'shifts_06: shifts_01..04 are not applied. Nothing changed.';
  end if;
  if to_regprocedure('public.can_manage_tenant(uuid)') is null
     or to_regprocedure('public.get_my_role()') is null then
    raise exception 'shifts_06: rls_02 helpers are missing. Nothing changed.';
  end if;
  if to_regclass('public.driver_users') is null or to_regclass('public.subcontractor_users') is null then
    raise exception 'shifts_06: driver_users or subcontractor_users is missing (pod_caller_is_office reads both). Nothing changed.';
  end if;
end $$;

-- ===========================================================================
-- 1. S-1: WLK06 guard on defect-linked maintenance records
-- ===========================================================================
create or replace function public.walkaround_defect_linked(p_maintenance_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.walkaround_defects d
                 where d.maintenance_record_id = p_maintenance_record_id);
$$;

revoke all on function public.walkaround_defect_linked(uuid) from public, anon;
grant execute on function public.walkaround_defect_linked(uuid) to authenticated, service_role;

-- NOT security definer, deliberately: current_user must be the real caller.
create or replace function public.guard_walkaround_maintenance_record()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.vehicle_id is not distinct from old.vehicle_id
     and new.tenant_id is not distinct from old.tenant_id then
    return new;
  end if;

  if public.walkaround_defect_linked(old.id) and not public.can_manage_tenant(old.tenant_id) then
    raise exception 'This repair is linked to a walkaround defect. Only an administrator can change its status or delete it.'
      using errcode = 'WLK06', hint = 'walkaround_defect_linked';
  end if;

  return coalesce(new, old);
end $$;

revoke all on function public.guard_walkaround_maintenance_record() from public, anon, authenticated;

drop trigger if exists guard_walkaround_maintenance_record on public.maintenance_records;
create trigger guard_walkaround_maintenance_record
  before update of status, vehicle_id, tenant_id or delete on public.maintenance_records
  for each row execute function public.guard_walkaround_maintenance_record();

-- ===========================================================================
-- 2. rectified_by, and re-VOR on reopen
-- ===========================================================================
alter table public.walkaround_defects add column if not exists rectified_by uuid;

create or replace function public.rectify_walkaround_defect()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.walkaround_defects
       set rectified_at = now(),
           rectified_by = auth.uid()
     where maintenance_record_id = new.id
       and rectified_at is null;
  elsif old.status = 'completed' and new.status is distinct from 'completed' then
    update public.walkaround_defects
       set rectified_at = null,
           rectified_by = null
     where maintenance_record_id = new.id
       and rectified_at is not null;

    -- A reopened dangerous defect takes its vehicle off the road again (the same columns
    -- walkaround_insert_defects sets). A minor one, or one with an approved objection, does not.
    update public.vehicles v
       set vor = true, active = false, vor_since = now(),
           vor_reason = 'Walkaround defect reopened: repair no longer marked complete'
     where v.vor is not true
       and v.id in (
         select d.vehicle_id
         from public.walkaround_defects d
         where d.maintenance_record_id = new.id
           and d.final_severity = 'dangerous'
           and d.rectified_at is null
           and not exists (select 1 from public.defect_objections o
                           where o.defect_id = d.id and o.status = 'approved')
       );
  end if;
  return new;
end $$;

revoke all on function public.rectify_walkaround_defect() from public, anon, authenticated;

drop trigger if exists rectify_walkaround_defect on public.maintenance_records;
create trigger rectify_walkaround_defect after update of status on public.maintenance_records
  for each row execute function public.rectify_walkaround_defect();

-- ===========================================================================
-- 3 and 6. walkaround_submit_check: shifts_04 body plus SHF08 (driver in tenant) and the WLK02
-- open-dangerous-defect backstop. Every other line is unchanged from shifts_04.
-- ===========================================================================
create or replace function public.walkaround_submit_check(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant       uuid := (p->>'tenant_id')::uuid;
  v_driver       uuid := (p->>'driver_id')::uuid;
  v_client       uuid := (p->>'client_id')::uuid;
  v_shift_client uuid := nullif(p->>'shift_client_id', '')::uuid;
  v_phase        text := p->>'phase';
  v_at           timestamptz := (p->>'performed_at')::timestamptz;
  v_vehicle      uuid := (p->>'vehicle_id')::uuid;
  v_result       text := p->>'result';
  v_odometer     int := (p->>'odometer')::int;
  v_flags        text[] := coalesce(array(select jsonb_array_elements_text(p->'flags')), '{}');
  v_existing     record;
  -- Scalars, not a record: a start check never loads a shift, and reading a
  -- field of an unassigned record raises.
  v_shift_id     uuid;
  v_shift_start  timestamptz;
  v_shift_ended  timestamptz;
  v_period       record;
  v_vehicle_row  record;
  v_company      uuid;
  v_check        uuid;
  v_dangerous    boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('driver_shift:' || v_driver::text, 0));

  select id, shift_id, result into v_existing
  from public.walkaround_checks where tenant_id = v_tenant and client_id = v_client;
  if found then
    return jsonb_build_object('duplicate', true, 'check_id', v_existing.id, 'shift_id', v_existing.shift_id, 'result', v_existing.result);
  end if;

  if v_phase is null or v_phase not in ('start', 'swap') then
    raise exception 'Unknown check phase %', v_phase;
  end if;

  select coalesce(t.company_id, t.id) into v_company from public.tenants t where t.id = v_tenant;
  v_company := coalesce(v_company, v_tenant);

  -- shifts_06 (S-16): the driver must belong to this tenant (or its company, on legacy rows).
  if not exists (select 1 from public.drivers dr where dr.id = v_driver and dr.tenant_id in (v_tenant, v_company)) then
    raise exception 'That driver is not in this fleet.' using errcode = 'SHF08';
  end if;

  if v_phase = 'start' then
    if exists (select 1 from public.driver_shifts where tenant_id = v_tenant and driver_id = v_driver and ended_at is null) then
      raise exception 'A shift is already open. End it before starting another.' using errcode = 'SHF01';
    end if;
  else
    if v_shift_client is null then
      raise exception 'A vehicle swap must name its shift.' using errcode = 'SHF02';
    end if;
    select id, started_at, ended_at into v_shift_id, v_shift_start, v_shift_ended from public.driver_shifts
    where tenant_id = v_tenant and driver_id = v_driver and client_id = v_shift_client
    for update;
    if not found then
      raise exception 'That shift was not found. Ask the office.' using errcode = 'SHF02';
    end if;
    if v_at < v_shift_start then
      raise exception 'The time is before the shift started.' using errcode = 'SHF06';
    end if;
  end if;

  -- The vehicle: in this fleet (vehicles.tenant_id is the tenant, or the
  -- company id on legacy rows), locked so its VOR state cannot change under us.
  select id, vor into v_vehicle_row from public.vehicles
  where id = v_vehicle and tenant_id in (v_tenant, v_company)
  for update;
  if not found then
    raise exception 'That vehicle is not in your fleet.' using errcode = 'WLK02';
  end if;
  if v_vehicle_row.vor is true then
    raise exception 'This vehicle is off the road and cannot be taken out.' using errcode = 'WLK02';
  end if;

  -- shifts_06 (WLK02 backstop): an open dangerous defect keeps the vehicle off the road even if
  -- vor was cleared by some other path.
  if exists (
    select 1 from public.walkaround_defects d
    where d.vehicle_id = v_vehicle
      and d.final_severity = 'dangerous'
      and d.rectified_at is null
      and not exists (select 1 from public.defect_objections o
                      where o.defect_id = d.id and o.status = 'approved')
  ) then
    raise exception 'This vehicle has an open dangerous defect and cannot be taken out.' using errcode = 'WLK02';
  end if;

  -- A swap on a shift the office has already ended: record the check and its
  -- defects (a dangerous one must still take the vehicle off the road),
  -- flagged, and touch no period and no shift.
  if v_phase = 'swap' and v_shift_ended is not null then
    insert into public.walkaround_checks (
      tenant_id, driver_id, shift_id, vehicle_id, client_id, phase, performed_at, odometer,
      vehicle_confirmation, vehicle_mismatch_reason, result, checklist_snapshot, declaration_accepted, flags
    ) values (
      v_tenant, v_driver, v_shift_id, v_vehicle, v_client, 'swap', v_at, v_odometer,
      p->>'confirmation', nullif(p->>'mismatch_reason', ''), v_result, p->'snapshot', true,
      public.shift_flags_add(v_flags, array['after_office_end'])
    ) returning id into v_check;
    v_dangerous := public.walkaround_insert_defects(v_tenant, v_check, v_vehicle, v_at, v_odometer, p->'defects', p->>'vor_reason');
    perform public.walkaround_assert_result(v_result, v_dangerous, p->'defects');
    return jsonb_build_object('duplicate', false, 'check_id', v_check, 'shift_id', v_shift_id, 'result', v_result, 'after_office_end', true);
  end if;

  if v_phase = 'swap' then
    select * into v_period from public.shift_vehicle_periods
    where shift_id = v_shift_id and ended_at is null
    for update;
    if found and v_at < v_period.started_at then
      raise exception 'The time is before the current vehicle was taken out.' using errcode = 'SHF06';
    end if;
  end if;

  insert into public.walkaround_checks (
    tenant_id, driver_id, shift_id, vehicle_id, client_id, phase, performed_at, odometer,
    vehicle_confirmation, vehicle_mismatch_reason, result, checklist_snapshot, declaration_accepted, flags
  ) values (
    v_tenant, v_driver, v_shift_id, v_vehicle, v_client, v_phase, v_at, v_odometer,
    p->>'confirmation', nullif(p->>'mismatch_reason', ''), v_result, p->'snapshot', true, v_flags
  ) returning id into v_check;

  v_dangerous := public.walkaround_insert_defects(v_tenant, v_check, v_vehicle, v_at, v_odometer, p->'defects', p->>'vor_reason');
  perform public.walkaround_assert_result(v_result, v_dangerous, p->'defects');

  if v_phase = 'swap' then
    update public.shift_vehicle_periods
       set ended_at = v_at, end_odometer = (p->>'previous_end_odometer')::int
     where shift_id = v_shift_id and ended_at is null;
  end if;

  if v_result = 'dangerous' then
    return jsonb_build_object('duplicate', false, 'check_id', v_check, 'shift_id', v_shift_id, 'result', v_result);
  end if;

  if v_phase = 'start' then
    -- The shift's client_id is the start check's: later events name it.
    insert into public.driver_shifts (tenant_id, driver_id, client_id, started_at, flags, created_by_user_id)
    values (v_tenant, v_driver, v_client, v_at, v_flags, nullif(p->>'user_id', '')::uuid)
    returning id into v_shift_id;
    update public.walkaround_checks set shift_id = v_shift_id where id = v_check;
  end if;

  insert into public.shift_vehicle_periods (tenant_id, shift_id, vehicle_id, walkaround_check_id, started_at, start_odometer)
  values (v_tenant, v_shift_id, v_vehicle, v_check, v_at, v_odometer);

  return jsonb_build_object('duplicate', false, 'check_id', v_check, 'shift_id', v_shift_id, 'result', v_result);
end $$;

-- 6. shift_office_start: shifts_04 body plus the SHF08 driver-in-tenant assertion.
create or replace function public.shift_office_start(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant  uuid := (p->>'tenant_id')::uuid;
  v_driver  uuid := (p->>'driver_id')::uuid;
  v_company uuid;
  v_shift   uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('driver_shift:' || v_driver::text, 0));

  select coalesce(t.company_id, t.id) into v_company from public.tenants t where t.id = v_tenant;
  v_company := coalesce(v_company, v_tenant);
  if not exists (select 1 from public.drivers dr where dr.id = v_driver and dr.tenant_id in (v_tenant, v_company)) then
    raise exception 'That driver is not in this fleet.' using errcode = 'SHF08';
  end if;

  if exists (select 1 from public.driver_shifts where driver_id = v_driver and ended_at is null) then
    raise exception 'This driver already has an open shift.' using errcode = 'SHF01';
  end if;
  insert into public.driver_shifts (tenant_id, driver_id, client_id, started_at, flags, created_by_user_id)
  values (v_tenant, v_driver, gen_random_uuid(), (p->>'started_at')::timestamptz, array['office_started'], (p->>'user_id')::uuid)
  returning id into v_shift;
  insert into public.shift_corrections (tenant_id, shift_id, corrected_by_user_id, field, old_value, new_value, reason)
  values (v_tenant, v_shift, (p->>'user_id')::uuid, 'office_started', null, p->>'started_at', p->>'reason');
  return jsonb_build_object('shift_id', v_shift);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.walkaround_submit_check(jsonb)',
    'public.shift_office_start(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ===========================================================================
-- 4. N-3: POD01 guard on job and stop completion columns
-- ===========================================================================
-- Mirrors lib/jobs/officeRoles.ts isOfficeCaller, except a NULL or empty role is refused.
-- SECURITY DEFINER so the driver-link lookup is not hidden by the caller's RLS; it answers only
-- about auth.uid() itself.
create or replace function public.pod_caller_is_office()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    return false;
  end if;

  select lower(btrim(r.name)) into v_role
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = v_uid;

  if v_role in ('admin', 'super_admin') then
    return true;
  end if;
  if coalesce(v_role, '') = '' or v_role in ('driver', 'subcontractor_driver') then
    return false;
  end if;

  -- Same inputs as lib/jobs/officeAccess.ts hasActiveDriverLink.
  if exists (select 1 from public.driver_users du where du.user_id = v_uid and du.active is true) then
    return false;
  end if;
  if exists (select 1 from public.subcontractor_users su
                 where su.user_id = v_uid and su.active is true and su.role = 'driver') then
    return false;
  end if;

  return true;
end $$;

revoke all on function public.pod_caller_is_office() from public, anon;
grant execute on function public.pod_caller_is_office() to authenticated, service_role;

-- NOT security definer, deliberately: current_user must be the real caller.
-- TG_ARGV holds the guarded column names for the table the trigger is on.
create or replace function public.guard_pod_completion_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_col text;
  v_changed boolean := false;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  v_new := to_jsonb(new);
  v_old := to_jsonb(old);
  foreach v_col in array tg_argv loop
    if (v_new -> v_col) is distinct from (v_old -> v_col) then
      v_changed := true;
      exit;
    end if;
  end loop;

  if v_changed and not public.pod_caller_is_office() then
    raise exception 'Only office staff can change delivery status. Drivers complete stops from the driver app.'
      using errcode = 'POD01', hint = tg_table_name;
  end if;
  return new;
end $$;

revoke all on function public.guard_pod_completion_columns() from public, anon, authenticated;

drop trigger if exists guard_pod_completion_columns on public.job_stops;
create trigger guard_pod_completion_columns
  before update on public.job_stops
  for each row execute function public.guard_pod_completion_columns(
    'status', 'pod_status', 'delivered_at', 'collected_at', 'pod_flags');

drop trigger if exists guard_pod_completion_columns on public.jobs;
create trigger guard_pod_completion_columns
  before update on public.jobs
  for each row execute function public.guard_pod_completion_columns('status', 'pod_status');

-- ===========================================================================
-- 5. N-12: job_stops.job_id bound to the row's tenant (prodfix_90 pattern)
-- ===========================================================================
create or replace function public.enforce_job_stops_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.jobs j
                 where j.id = new.job_id and j.tenant_id = new.tenant_id) then
    raise exception 'job_stops.tenant_id must equal the tenant of its job'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.enforce_job_stops_tenant() from public, anon, authenticated;

do $$
declare
  v_n bigint;
begin
  select count(*) into v_n
  from public.job_stops s
  left join public.jobs j on j.id = s.job_id
  where j.id is null or j.tenant_id is distinct from s.tenant_id;

  if v_n > 0 then
    raise warning 'shifts_06: % job_stops rows already disagree with their job''s tenant, so enforce_job_stops_tenant was NOT installed. List them with: select s.id, s.tenant_id, j.tenant_id as job_tenant from public.job_stops s left join public.jobs j on j.id = s.job_id where j.id is null or j.tenant_id is distinct from s.tenant_id; fix them, then re-run this file.', v_n;
    return;
  end if;

  execute 'drop trigger if exists enforce_job_stops_tenant on public.job_stops';
  execute 'create trigger enforce_job_stops_tenant
             before insert or update of tenant_id, job_id on public.job_stops
             for each row execute function public.enforce_job_stops_tenant()';
  raise notice 'shifts_06: job_stops.job_id is bound to the row''s tenant';
end $$;

commit;

-- ===========================================================================
-- VERIFY (read-only)
-- ===========================================================================

-- V1: expect guard_walkaround_maintenance_record and rectify_walkaround_defect on
-- maintenance_records, guard_pod_completion_columns on jobs and job_stops, and
-- enforce_job_stops_tenant on job_stops (unless the WARNING above fired).
select c.relname, t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and t.tgname in ('guard_walkaround_maintenance_record', 'rectify_walkaround_defect',
                   'guard_pod_completion_columns', 'enforce_job_stops_tenant')
order by 1, 2;

-- V2: expect the two guard functions NOT security definer, every other function here definer,
-- and config search_path=public, pg_temp on all of them.
select p.oid::regprocedure as function, p.prosecdef as definer,
       array_to_string(p.proconfig, ';') as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('walkaround_defect_linked', 'guard_walkaround_maintenance_record',
                    'rectify_walkaround_defect', 'walkaround_submit_check', 'shift_office_start',
                    'pod_caller_is_office', 'guard_pod_completion_columns', 'enforce_job_stops_tenant')
order by 1;
-- expect auth_exec = true only for walkaround_defect_linked and pod_caller_is_office.

-- V3: expect one row, rectified_by uuid.
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'walkaround_defects' and column_name = 'rectified_by';

-- V4: expect the backstop and the assertion in the live bodies (both true).
select p.proname,
       p.prosrc like '%open dangerous defect%' as wlk02_backstop,
       p.prosrc like '%SHF08%' as shf08_assert
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname in ('walkaround_submit_check', 'shift_office_start');

-- V5 (rolled back), as a staff (non-admin) member of the tenant: expect ERROR WLK06.
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<STAFF_USER_ID>","role":"authenticated"}';
--     update public.maintenance_records set status = 'completed'
--      where id = (select maintenance_record_id from public.walkaround_defects
--                  where maintenance_record_id is not null limit 1);
--   rollback;
--
-- V6 (rolled back), as a driver-role or role-less profile: expect ERROR POD01.
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<DRIVER_PROFILE_USER_ID>","role":"authenticated"}';
--     update public.job_stops set pod_status = 'delivered' where id = '<STOP_ID_IN_THEIR_TENANT>';
--   rollback;
