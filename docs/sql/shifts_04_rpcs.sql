-- shifts_04: write RPCs for shifts and walkaround checks.
-- Callable by service_role ONLY. The calling route has authorized the driver
-- or office user and resolved every defect's severity with
-- lib/walkaround/severity.ts; these functions make the writes atomic and
-- idempotent on the phone-generated client_id.
--
-- Error codes (the routes map them to HTTP 409):
--   SHF01 a shift is already open        SHF02 no open shift
--   SHF03 a break is already running     SHF04 no break is running
--   SHF05 no vehicle to record end-of-shift defects against
--   WLK02 the vehicle is off the road
--
-- Apply after shifts_01..03. Safe to re-run.

begin;

-- Insert defects for one check, one maintenance record each, and VOR the
-- vehicle if any is dangerous. Returns true when the vehicle was VOR'd.
create or replace function public.walkaround_insert_defects(
  p_tenant uuid, p_check uuid, p_vehicle uuid, p_at timestamptz, p_odometer int,
  p_defects jsonb, p_vor_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  d jsonb;
  v_mr uuid;
  v_dangerous boolean := false;
begin
  for d in select * from jsonb_array_elements(coalesce(p_defects, '[]'::jsonb)) loop
    insert into public.maintenance_records (tenant_id, vehicle_id, maintenance_type, due_date, status, mileage, notes)
    values (
      p_tenant, p_vehicle,
      left('Walkaround defect: ' || (d->>'label'), 200),
      (p_at at time zone 'Europe/London')::date,
      case when d->>'final_severity' = 'dangerous' then 'vor' else 'due' end,
      p_odometer,
      nullif(d->>'note', '')
    )
    returning id into v_mr;

    insert into public.walkaround_defects (
      tenant_id, check_id, vehicle_id, catalogue_item_id, client_id, label,
      catalogue_severity, final_severity, escalated_by_driver, severity_source, note, maintenance_record_id
    ) values (
      p_tenant, p_check, p_vehicle, nullif(d->>'catalogue_item_id', '')::uuid, (d->>'client_id')::uuid, d->>'label',
      nullif(d->>'catalogue_severity', ''), d->>'final_severity', coalesce((d->>'escalated')::boolean, false),
      d->>'source', nullif(d->>'note', ''), v_mr
    );

    if d->>'final_severity' = 'dangerous' then v_dangerous := true; end if;
  end loop;

  if v_dangerous then
    update public.vehicles
       set vor = true, active = false, vor_since = p_at, vor_reason = p_vor_reason
     where id = p_vehicle and vor is not true;
  end if;

  return v_dangerous;
end $$;

-- A start or swap walkaround check. p keys: tenant_id, driver_id, user_id,
-- client_id, phase ('start'|'swap'), performed_at, vehicle_id, confirmation,
-- mismatch_reason, odometer, previous_end_odometer, result, snapshot (array),
-- flags (text array), vor_reason, defects (array of {client_id,
-- catalogue_item_id, label, catalogue_severity, final_severity, escalated,
-- source, note}).
create or replace function public.walkaround_submit_check(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant  uuid := (p->>'tenant_id')::uuid;
  v_driver  uuid := (p->>'driver_id')::uuid;
  v_client  uuid := (p->>'client_id')::uuid;
  v_phase   text := p->>'phase';
  v_at      timestamptz := (p->>'performed_at')::timestamptz;
  v_vehicle uuid := (p->>'vehicle_id')::uuid;
  v_result  text := p->>'result';
  v_flags   text[] := coalesce(array(select jsonb_array_elements_text(p->'flags')), '{}');
  v_existing record;
  v_open    record;
  v_check   uuid;
  v_shift   uuid;
begin
  select id, shift_id, result into v_existing
  from public.walkaround_checks where tenant_id = v_tenant and client_id = v_client;
  if found then
    return jsonb_build_object('duplicate', true, 'check_id', v_existing.id, 'shift_id', v_existing.shift_id, 'result', v_existing.result);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('driver_shift:' || v_driver::text, 0));

  select id into v_open from public.driver_shifts
  where tenant_id = v_tenant and driver_id = v_driver and ended_at is null
  for update;

  if v_phase = 'start' and v_open.id is not null then
    raise exception 'A shift is already open. End it before starting another.' using errcode = 'SHF01';
  end if;
  if v_phase = 'swap' and v_open.id is null then
    raise exception 'There is no open shift to swap vehicles on.' using errcode = 'SHF02';
  end if;
  if exists (select 1 from public.vehicles where id = v_vehicle and vor is true) then
    raise exception 'This vehicle is off the road and cannot be taken out.' using errcode = 'WLK02';
  end if;

  insert into public.walkaround_checks (
    tenant_id, driver_id, shift_id, vehicle_id, client_id, phase, performed_at, odometer,
    vehicle_confirmation, vehicle_mismatch_reason, result, checklist_snapshot, declaration_accepted, flags
  ) values (
    v_tenant, v_driver, v_open.id, v_vehicle, v_client, v_phase, v_at, (p->>'odometer')::int,
    p->>'confirmation', nullif(p->>'mismatch_reason', ''), v_result, p->'snapshot', true, v_flags
  ) returning id into v_check;

  perform public.walkaround_insert_defects(v_tenant, v_check, v_vehicle, v_at, (p->>'odometer')::int, p->'defects', p->>'vor_reason');

  if v_phase = 'swap' then
    update public.shift_vehicle_periods
       set ended_at = v_at, end_odometer = (p->>'previous_end_odometer')::int
     where shift_id = v_open.id and ended_at is null;
    v_shift := v_open.id;
  end if;

  if v_result = 'dangerous' then
    return jsonb_build_object('duplicate', false, 'check_id', v_check, 'shift_id', v_shift, 'result', v_result);
  end if;

  if v_phase = 'start' then
    insert into public.driver_shifts (tenant_id, driver_id, client_id, started_at, flags, created_by_user_id)
    values (v_tenant, v_driver, v_client, v_at, v_flags, nullif(p->>'user_id', '')::uuid)
    returning id into v_shift;
    update public.walkaround_checks set shift_id = v_shift where id = v_check;
  end if;

  insert into public.shift_vehicle_periods (tenant_id, shift_id, vehicle_id, walkaround_check_id, started_at, start_odometer)
  values (v_tenant, v_shift, v_vehicle, v_check, v_at, (p->>'odometer')::int);

  return jsonb_build_object('duplicate', false, 'check_id', v_check, 'shift_id', v_shift, 'result', v_result);
end $$;

-- Break start / break end / shift end. p keys: tenant_id, driver_id, type,
-- client_id, occurred_at, flags; for shift_ended also odometer, and
-- end_check (null, or {client_id, result, snapshot, vor_reason, defects}).
create or replace function public.shift_record_event(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  v_driver uuid := (p->>'driver_id')::uuid;
  v_type   text := p->>'type';
  v_client uuid := (p->>'client_id')::uuid;
  v_at     timestamptz := (p->>'occurred_at')::timestamptz;
  v_flags  text[] := coalesce(array(select jsonb_array_elements_text(p->'flags')), '{}');
  v_shift  record;
  v_break  record;
  v_period record;
  v_check  uuid;
  v_end    jsonb := p->'end_check';
  v_has_defects boolean := jsonb_array_length(coalesce(p->'end_check'->'defects', '[]'::jsonb)) > 0;
begin
  if v_type = 'break_started' then
    if exists (select 1 from public.shift_breaks where tenant_id = v_tenant and client_id = v_client) then
      return jsonb_build_object('duplicate', true);
    end if;
  elsif v_type = 'break_ended' then
    if exists (select 1 from public.shift_breaks where tenant_id = v_tenant and end_client_id = v_client) then
      return jsonb_build_object('duplicate', true);
    end if;
  elsif v_type = 'shift_ended' then
    if exists (select 1 from public.driver_shifts where tenant_id = v_tenant and end_client_id = v_client) then
      return jsonb_build_object('duplicate', true);
    end if;
  else
    raise exception 'Unknown shift event type %', v_type;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('driver_shift:' || v_driver::text, 0));

  select * into v_shift from public.driver_shifts
  where tenant_id = v_tenant and driver_id = v_driver and ended_at is null
  for update;

  if v_type = 'break_started' then
    if v_shift.id is null then raise exception 'There is no open shift.' using errcode = 'SHF02'; end if;
    if exists (select 1 from public.shift_breaks where shift_id = v_shift.id and ended_at is null) then
      raise exception 'A break is already running.' using errcode = 'SHF03';
    end if;
    insert into public.shift_breaks (tenant_id, shift_id, client_id, started_at, flags)
    values (v_tenant, v_shift.id, v_client, v_at, v_flags);
    return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id);
  end if;

  if v_type = 'break_ended' then
    if v_shift.id is null then raise exception 'There is no open shift.' using errcode = 'SHF02'; end if;
    update public.shift_breaks
       set ended_at = v_at, end_client_id = v_client, end_received_at = now(), flags = flags || v_flags
     where shift_id = v_shift.id and ended_at is null;
    if not found then raise exception 'No break is running.' using errcode = 'SHF04'; end if;
    return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id);
  end if;

  -- shift_ended. If the office already ended this driver's shift, attach the
  -- driver's end to it (flagged) instead of overriding the office correction.
  if v_shift.id is null then
    select * into v_shift from public.driver_shifts
    where tenant_id = v_tenant and driver_id = v_driver and ended_by = 'office' and end_client_id is null
    order by started_at desc limit 1
    for update;
    if v_shift.id is null then raise exception 'There is no open shift.' using errcode = 'SHF02'; end if;
    v_flags := v_flags || array['driver_end_after_office'];
  end if;

  select * into v_period from public.shift_vehicle_periods
  where shift_id = v_shift.id order by started_at desc limit 1;

  if v_has_defects then
    if v_period.id is null then
      raise exception 'There is no vehicle on this shift to record defects against.' using errcode = 'SHF05';
    end if;
    insert into public.walkaround_checks (
      tenant_id, driver_id, shift_id, vehicle_id, client_id, phase, performed_at, odometer,
      vehicle_confirmation, result, checklist_snapshot, declaration_accepted, flags
    ) values (
      v_tenant, v_driver, v_shift.id, v_period.vehicle_id, (v_end->>'client_id')::uuid, 'end_of_shift', v_at,
      (p->>'odometer')::int, 'none', v_end->>'result', v_end->'snapshot', true, v_flags
    ) returning id into v_check;
    perform public.walkaround_insert_defects(v_tenant, v_check, v_period.vehicle_id, v_at, (p->>'odometer')::int, v_end->'defects', v_end->>'vor_reason');
  end if;

  if 'driver_end_after_office' = any(v_flags) then
    update public.driver_shifts
       set end_client_id = v_client, flags = flags || v_flags,
           end_defect_answer = case when v_has_defects then 'reported' else 'none' end
     where id = v_shift.id;
    return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id, 'attached', true);
  end if;

  update public.shift_breaks set ended_at = v_at, end_received_at = now()
   where shift_id = v_shift.id and ended_at is null;
  update public.shift_vehicle_periods set ended_at = v_at, end_odometer = (p->>'odometer')::int
   where shift_id = v_shift.id and ended_at is null;
  update public.driver_shifts
     set ended_at = v_at, end_client_id = v_client, end_received_at = now(), ended_by = 'driver',
         end_defect_answer = case when v_has_defects then 'reported' else 'none' end,
         flags = flags || v_flags
   where id = v_shift.id;

  return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id, 'attached', false);
end $$;

-- Office correction to a shift's start or end, with an audit row.
-- p keys: tenant_id, shift_id, user_id, field ('started_at'|'ended_at'), value, reason.
create or replace function public.shift_apply_correction(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift record;
  v_field text := p->>'field';
  v_value timestamptz := (p->>'value')::timestamptz;
  v_old   timestamptz;
begin
  select * into v_shift from public.driver_shifts
  where id = (p->>'shift_id')::uuid and tenant_id = (p->>'tenant_id')::uuid
  for update;
  if v_shift.id is null then raise exception 'Shift not found.' using errcode = 'SHF02'; end if;

  if v_field = 'started_at' then
    v_old := v_shift.started_at;
    update public.driver_shifts set started_at = v_value where id = v_shift.id;
  elsif v_field = 'ended_at' then
    v_old := v_shift.ended_at;
    update public.driver_shifts
       set ended_at = v_value,
           ended_by = case when v_shift.ended_at is null then 'office' else ended_by end
     where id = v_shift.id;
    update public.shift_breaks set ended_at = v_value where shift_id = v_shift.id and ended_at is null;
    update public.shift_vehicle_periods set ended_at = v_value where shift_id = v_shift.id and ended_at is null;
  else
    raise exception 'Only the start or end of a shift can be corrected.';
  end if;

  insert into public.shift_corrections (tenant_id, shift_id, corrected_by_user_id, field, old_value, new_value, reason)
  values (v_shift.tenant_id, v_shift.id, (p->>'user_id')::uuid, v_field, v_old::text, v_value::text, p->>'reason');

  return jsonb_build_object('shift_id', v_shift.id);
end $$;

-- Office starts a shift for a driver whose phone is unavailable. Hours only:
-- no vehicle period, so the job gate still blocks stop completion.
-- p keys: tenant_id, driver_id, user_id, started_at, reason.
create or replace function public.shift_office_start(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  v_driver uuid := (p->>'driver_id')::uuid;
  v_shift  uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('driver_shift:' || v_driver::text, 0));
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
    'public.walkaround_insert_defects(uuid, uuid, uuid, timestamptz, int, jsonb, text)',
    'public.walkaround_submit_check(jsonb)',
    'public.shift_record_event(jsonb)',
    'public.shift_apply_correction(jsonb)',
    'public.shift_office_start(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;

-- VERIFY: nobody but service_role (and the owner) may execute.
--   select p.proname, r.rolname
--   from pg_proc p cross join pg_roles r
--   where p.proname in ('walkaround_insert_defects','walkaround_submit_check','shift_record_event',
--                       'shift_apply_correction','shift_office_start')
--     and r.rolname in ('anon','authenticated','service_role')
--     and has_function_privilege(r.oid, p.oid, 'execute');
--   -- expect only service_role rows.
