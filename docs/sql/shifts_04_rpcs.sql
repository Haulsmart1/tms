-- shifts_04: write RPCs for shifts and walkaround checks.
-- Callable by service_role ONLY. The calling route has authorized the driver
-- or office user and resolved every defect's severity with
-- lib/walkaround/severity.ts; these functions make the writes atomic and
-- idempotent on the phone-generated client_id, and re-check severity against
-- the stored catalogue so a route bug cannot under-classify a defect.
--
-- Order inside every function: take the per-driver advisory lock FIRST, then
-- look up the client_id (a repeat answers duplicate and writes nothing), and
-- only then run the business checks. A retry of an event that was saved must
-- never be refused because the world moved on since (vehicle now VOR, break
-- now closed).
--
-- Every driver event names its shift by the shift's client_id
-- (p->>'shift_client_id'; a shift's client_id is the client_id of the start
-- check that opened it). A late event only ever attaches to that shift. It
-- never closes or edits a different one, even if the named shift has since
-- been ended by the office.
--
-- Error codes (the routes map them to HTTP 409; lib/walkaround/server.ts
-- KNOWN_RPC_REFUSALS is the list):
--   SHF01 a shift is already open        SHF02 shift not found, or already ended by the driver
--   SHF03 a break is already running     SHF04 no break is running
--   SHF05 no vehicle to record end-of-shift defects against
--   SHF06 the time is before the shift (or the current vehicle) started
--   SHF07 the time is before the break started
--   WLK02 the vehicle cannot be taken out (off the road, or not in this fleet)
--   WLK04 a defect or check result disagrees with the stored catalogue
--
-- Apply after shifts_01..03. Safe to re-run.

begin;

-- Insert defects for one check, one maintenance record each, and VOR the
-- vehicle if any is dangerous. Returns true when any defect is dangerous
-- (whether or not the vehicle was already VOR).
--
-- Severity backstop: for a catalogue defect the STORED row decides. It must
-- exist, not be retired, and be the baseline or this tenant's company's own
-- item. catalogue_severity is the stored severity; final_severity must equal
-- it unless the driver escalated minor to dangerous. An "Other" defect (no
-- catalogue item) is minor unless the driver marked it dangerous. The label,
-- escalation flag and severity source are derived here, not taken from p.
create or replace function public.walkaround_insert_defects(
  p_tenant uuid, p_check uuid, p_vehicle uuid, p_at timestamptz, p_odometer int,
  p_defects jsonb, p_vor_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  d           jsonb;
  v_mr        uuid;
  v_dangerous boolean := false;
  v_company   uuid;
  v_item_id   uuid;
  v_item      record;
  v_final     text;
  v_catalogue text;
  v_escalated boolean;
  v_source    text;
  v_label     text;
begin
  select coalesce(t.company_id, t.id) into v_company from public.tenants t where t.id = p_tenant;
  v_company := coalesce(v_company, p_tenant);

  for d in select * from jsonb_array_elements(coalesce(p_defects, '[]'::jsonb)) loop
    v_item_id := nullif(d->>'catalogue_item_id', '')::uuid;
    v_final := d->>'final_severity';
    if v_final is null or v_final not in ('minor', 'dangerous') then
      raise exception 'A defect has no valid severity.' using errcode = 'WLK04';
    end if;

    if v_item_id is null then
      v_catalogue := null;
      v_escalated := v_final = 'dangerous';
      v_source := 'driver';
      v_label := d->>'label';
    else
      select id, company_id, severity, retired_at, item_label, defect_label into v_item
      from public.defect_catalogue_items where id = v_item_id;
      if not found then
        raise exception 'A reported defect is not on the checklist. Reload the check and try again.' using errcode = 'WLK04';
      end if;
      if v_item.retired_at is not null then
        raise exception 'A reported defect has been retired from the checklist. Reload the check and try again.' using errcode = 'WLK04';
      end if;
      if v_item.company_id is not null and v_item.company_id <> v_company then
        raise exception 'A reported defect belongs to another company''s checklist.' using errcode = 'WLK04';
      end if;
      v_catalogue := v_item.severity;
      if v_final <> v_catalogue and not (v_catalogue = 'minor' and v_final = 'dangerous') then
        raise exception 'A defect''s severity does not match the checklist.' using errcode = 'WLK04';
      end if;
      v_escalated := v_final <> v_catalogue;
      v_source := case when v_escalated then 'driver' when v_item.company_id is null then 'baseline' else 'company' end;
      v_label := v_item.item_label || ': ' || v_item.defect_label;
    end if;

    insert into public.maintenance_records (tenant_id, vehicle_id, maintenance_type, due_date, status, mileage, notes)
    values (
      p_tenant, p_vehicle,
      left('Walkaround defect: ' || v_label, 200),
      (p_at at time zone 'Europe/London')::date,
      case when v_final = 'dangerous' then 'vor' else 'due' end,
      p_odometer,
      nullif(d->>'note', '')
    )
    returning id into v_mr;

    insert into public.walkaround_defects (
      tenant_id, check_id, vehicle_id, catalogue_item_id, client_id, label,
      catalogue_severity, final_severity, escalated_by_driver, severity_source, note, maintenance_record_id
    ) values (
      p_tenant, p_check, p_vehicle, v_item_id, (d->>'client_id')::uuid, v_label,
      v_catalogue, v_final, v_escalated, v_source, nullif(d->>'note', ''), v_mr
    );

    if v_final = 'dangerous' then v_dangerous := true; end if;
  end loop;

  if v_dangerous then
    update public.vehicles
       set vor = true, active = false, vor_since = p_at, vor_reason = p_vor_reason
     where id = p_vehicle and vor is not true;
  end if;

  return v_dangerous;
end $$;

-- The check's result must agree with its defects: dangerous iff any defect is
-- dangerous, pass iff there are none.
create or replace function public.walkaround_assert_result(p_result text, p_any_dangerous boolean, p_defects jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_any_dangerous is distinct from (p_result = 'dangerous')
     or (p_result = 'pass') is distinct from (jsonb_array_length(coalesce(p_defects, '[]'::jsonb)) = 0) then
    raise exception 'The check result does not match its defects.' using errcode = 'WLK04';
  end if;
end $$;

-- Append flags without repeating any already present (a retried late event
-- that is flagged and skipped must not grow the array each time).
create or replace function public.shift_flags_add(p_flags text[], p_new text[])
returns text[]
language sql
immutable
as $$
  select coalesce(p_flags, '{}') || coalesce(array(select unnest(p_new) except select unnest(p_flags)), '{}')
$$;

-- A start or swap walkaround check. p keys: tenant_id, driver_id, user_id,
-- client_id, shift_client_id (swap only), phase ('start'|'swap'),
-- performed_at, vehicle_id, confirmation, mismatch_reason, odometer,
-- previous_end_odometer, result, snapshot (array), flags (text array),
-- vor_reason, defects (array of {client_id, catalogue_item_id, label,
-- final_severity, note}).
create or replace function public.walkaround_submit_check(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
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
  select coalesce(t.company_id, t.id) into v_company from public.tenants t where t.id = v_tenant;
  v_company := coalesce(v_company, v_tenant);
  select id, vor into v_vehicle_row from public.vehicles
  where id = v_vehicle and tenant_id in (v_tenant, v_company)
  for update;
  if not found then
    raise exception 'That vehicle is not in your fleet.' using errcode = 'WLK02';
  end if;
  if v_vehicle_row.vor is true then
    raise exception 'This vehicle is off the road and cannot be taken out.' using errcode = 'WLK02';
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

-- Break start / break end / shift end. p keys: tenant_id, driver_id, type,
-- client_id, shift_client_id, occurred_at, flags; for shift_ended also
-- odometer, and end_check (null, or {client_id, result, snapshot, vor_reason,
-- defects}).
--
-- On a shift the office has already ended (office wins):
--   break_started  inserted, flagged after_office_end, only if it falls inside
--                  [started_at, ended_at], no break is open and it overlaps no
--                  closed break; otherwise the shift is flagged
--                  late_break_skipped and nothing else is written.
--   break_ended    closes the open break, flagged, only if it falls inside the
--                  shift and after that break's start; otherwise flagged and
--                  skipped the same way.
--   shift_ended    attaches: records the driver's end client id, answer and
--                  flag, puts the driver's end odometer on the period the
--                  office end closed (end_odometer still null), and records
--                  any end-of-shift defects against that period's vehicle.
--                  started_at, ended_at and ended_by are never changed.
create or replace function public.shift_record_event(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant       uuid := (p->>'tenant_id')::uuid;
  v_driver       uuid := (p->>'driver_id')::uuid;
  v_type         text := p->>'type';
  v_client       uuid := (p->>'client_id')::uuid;
  v_shift_client uuid := nullif(p->>'shift_client_id', '')::uuid;
  v_at           timestamptz := (p->>'occurred_at')::timestamptz;
  v_odometer     int := nullif(p->>'odometer', '')::int;
  v_flags        text[] := coalesce(array(select jsonb_array_elements_text(p->'flags')), '{}');
  v_end          jsonb := p->'end_check';
  v_has_defects  boolean := jsonb_array_length(coalesce(p->'end_check'->'defects', '[]'::jsonb)) > 0;
  v_shift        record;
  v_break        record;
  v_period       record;
  v_check        uuid;
  v_dangerous    boolean;
  v_office_ended boolean;
begin
  if v_type is null or v_type not in ('break_started', 'break_ended', 'shift_ended') then
    raise exception 'Unknown shift event type %', v_type;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('driver_shift:' || v_driver::text, 0));

  if v_type = 'break_started' then
    if exists (select 1 from public.shift_breaks where tenant_id = v_tenant and client_id = v_client) then
      return jsonb_build_object('duplicate', true);
    end if;
  elsif v_type = 'break_ended' then
    if exists (select 1 from public.shift_breaks where tenant_id = v_tenant and end_client_id = v_client) then
      return jsonb_build_object('duplicate', true);
    end if;
  else
    if exists (select 1 from public.driver_shifts where tenant_id = v_tenant and end_client_id = v_client) then
      return jsonb_build_object('duplicate', true);
    end if;
  end if;

  if v_shift_client is null then
    raise exception 'The event does not name its shift.' using errcode = 'SHF02';
  end if;
  select * into v_shift from public.driver_shifts
  where tenant_id = v_tenant and driver_id = v_driver and client_id = v_shift_client
  for update;
  if not found then
    raise exception 'That shift was not found. Ask the office.' using errcode = 'SHF02';
  end if;
  v_office_ended := v_shift.ended_at is not null;

  if not v_office_ended and v_at < v_shift.started_at then
    raise exception 'The time is before the shift started.' using errcode = 'SHF06';
  end if;

  -- break_started ----------------------------------------------------------
  if v_type = 'break_started' then
    if v_office_ended then
      if v_at between v_shift.started_at and v_shift.ended_at
         and not exists (select 1 from public.shift_breaks where shift_id = v_shift.id and ended_at is null)
         and not exists (select 1 from public.shift_breaks where shift_id = v_shift.id and ended_at > v_at) then
        insert into public.shift_breaks (tenant_id, shift_id, client_id, started_at, flags)
        values (v_tenant, v_shift.id, v_client, v_at, public.shift_flags_add(v_flags, array['after_office_end']));
        return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id, 'after_office_end', true);
      end if;
      update public.driver_shifts set flags = public.shift_flags_add(flags, array['late_break_skipped']) where id = v_shift.id;
      return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id, 'skipped', true);
    end if;

    if exists (select 1 from public.shift_breaks where shift_id = v_shift.id and ended_at is null) then
      raise exception 'A break is already running.' using errcode = 'SHF03';
    end if;
    insert into public.shift_breaks (tenant_id, shift_id, client_id, started_at, flags)
    values (v_tenant, v_shift.id, v_client, v_at, v_flags);
    return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id);
  end if;

  -- break_ended ------------------------------------------------------------
  if v_type = 'break_ended' then
    select * into v_break from public.shift_breaks
    where shift_id = v_shift.id and ended_at is null
    for update;

    if v_office_ended then
      if v_break.id is not null
         and v_at >= v_break.started_at and v_at <= v_shift.ended_at
         and not exists (select 1 from public.shift_breaks
                         where shift_id = v_shift.id and ended_at is not null
                           and started_at < v_at and ended_at > v_break.started_at) then
        update public.shift_breaks
           set ended_at = v_at, end_client_id = v_client, end_received_at = now(),
               flags = public.shift_flags_add(flags, v_flags || array['after_office_end'])
         where id = v_break.id;
        return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id, 'after_office_end', true);
      end if;
      update public.driver_shifts set flags = public.shift_flags_add(flags, array['late_break_skipped']) where id = v_shift.id;
      return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id, 'skipped', true);
    end if;

    if v_break.id is null then
      raise exception 'No break is running.' using errcode = 'SHF04';
    end if;
    if v_at < v_break.started_at then
      raise exception 'The time is before the break started.' using errcode = 'SHF07';
    end if;
    update public.shift_breaks
       set ended_at = v_at, end_client_id = v_client, end_received_at = now(), flags = public.shift_flags_add(flags, v_flags)
     where id = v_break.id;
    return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id);
  end if;

  -- shift_ended ------------------------------------------------------------
  if v_office_ended then
    -- A different end for a shift the driver already ended (or already
    -- attached to) is not a retry; refuse rather than overwrite it.
    if v_shift.end_client_id is not null then
      raise exception 'This shift has already been ended.' using errcode = 'SHF02';
    end if;
    -- The period the office end closed: a swap always records the end
    -- odometer, so the only closed period without one is the office's.
    select * into v_period from public.shift_vehicle_periods
    where shift_id = v_shift.id and end_odometer is null
    order by started_at desc limit 1
    for update;
    v_flags := public.shift_flags_add(v_flags, array['driver_end_after_office']);
  else
    if exists (select 1 from public.shift_breaks where shift_id = v_shift.id and ended_at is null and started_at > v_at) then
      raise exception 'The time is before the break started.' using errcode = 'SHF07';
    end if;
    select * into v_period from public.shift_vehicle_periods
    where shift_id = v_shift.id and ended_at is null
    for update;
    if v_period.id is not null and v_at < v_period.started_at then
      raise exception 'The time is before the current vehicle was taken out.' using errcode = 'SHF06';
    end if;
  end if;

  if v_has_defects then
    -- Only the vehicle the driver is on now. None (for example after a
    -- dangerous swap, or the office ended the shift between vehicles) is a
    -- refusal, never a guess.
    if v_period.id is null then
      raise exception 'There is no vehicle on this shift to record defects against.' using errcode = 'SHF05';
    end if;
    insert into public.walkaround_checks (
      tenant_id, driver_id, shift_id, vehicle_id, client_id, phase, performed_at, odometer,
      vehicle_confirmation, result, checklist_snapshot, declaration_accepted, flags
    ) values (
      v_tenant, v_driver, v_shift.id, v_period.vehicle_id, (v_end->>'client_id')::uuid, 'end_of_shift', v_at,
      v_odometer, 'none', v_end->>'result', v_end->'snapshot', true, v_flags
    ) returning id into v_check;
    v_dangerous := public.walkaround_insert_defects(v_tenant, v_check, v_period.vehicle_id, v_at, v_odometer, v_end->'defects', v_end->>'vor_reason');
    perform public.walkaround_assert_result(v_end->>'result', v_dangerous, v_end->'defects');
  end if;

  if v_office_ended then
    if v_period.id is not null then
      update public.shift_vehicle_periods set end_odometer = v_odometer where id = v_period.id;
    end if;
    update public.driver_shifts
       set end_client_id = v_client, end_received_at = now(), flags = public.shift_flags_add(flags, v_flags),
           end_defect_answer = case when v_has_defects then 'reported' else 'none' end
     where id = v_shift.id;
    return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id, 'attached', true);
  end if;

  update public.shift_breaks set ended_at = v_at, end_received_at = now()
   where shift_id = v_shift.id and ended_at is null;
  update public.shift_vehicle_periods set ended_at = v_at, end_odometer = v_odometer
   where shift_id = v_shift.id and ended_at is null;
  update public.driver_shifts
     set ended_at = v_at, end_client_id = v_client, end_received_at = now(), ended_by = 'driver',
         end_defect_answer = case when v_has_defects then 'reported' else 'none' end,
         flags = public.shift_flags_add(flags, v_flags)
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
  v_shift  record;
  v_driver uuid;
  v_field  text := p->>'field';
  v_value  timestamptz := nullif(p->>'value', '')::timestamptz;
  v_old    timestamptz;
begin
  -- The driver's advisory lock first, like every other writer of this shift.
  select driver_id into v_driver from public.driver_shifts
  where id = (p->>'shift_id')::uuid and tenant_id = (p->>'tenant_id')::uuid;
  if v_driver is null then raise exception 'Shift not found.' using errcode = 'SHF02'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver_shift:' || v_driver::text, 0));

  select * into v_shift from public.driver_shifts
  where id = (p->>'shift_id')::uuid and tenant_id = (p->>'tenant_id')::uuid
  for update;
  if not found then raise exception 'Shift not found.' using errcode = 'SHF02'; end if;

  if v_value is null then
    raise exception 'Enter the corrected time.' using errcode = '22004';
  end if;

  if v_field = 'started_at' then
    if v_shift.ended_at is not null and v_value > v_shift.ended_at then
      raise exception 'The start cannot be after the end of the shift.' using errcode = 'SHF06';
    end if;
    if exists (select 1 from public.shift_breaks where shift_id = v_shift.id and started_at < v_value) then
      raise exception 'A break starts before that time. The start cannot be after the first break.' using errcode = 'SHF06';
    end if;
    if exists (select 1 from public.shift_vehicle_periods where shift_id = v_shift.id and started_at < v_value) then
      raise exception 'A vehicle was taken out before that time. The start cannot be after the first vehicle check.' using errcode = 'SHF06';
    end if;
    v_old := v_shift.started_at;
    update public.driver_shifts set started_at = v_value where id = v_shift.id;
  elsif v_field = 'ended_at' then
    if v_value < v_shift.started_at then
      raise exception 'The end cannot be before the start of the shift.' using errcode = 'SHF06';
    end if;
    if exists (select 1 from public.shift_breaks where shift_id = v_shift.id and ended_at is null and started_at > v_value) then
      raise exception 'A break that is still running started after that time.' using errcode = 'SHF06';
    end if;
    if exists (select 1 from public.shift_vehicle_periods where shift_id = v_shift.id and ended_at is null and started_at > v_value) then
      raise exception 'The current vehicle was taken out after that time.' using errcode = 'SHF06';
    end if;
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
-- no vehicle period, so the job gate still blocks stop completion. The shift
-- gets a random client_id; the phone learns it from GET /api/driver/shift
-- (openShift.clientId) before it queues a break or end against it.
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
    'public.walkaround_assert_result(text, boolean, jsonb)',
    'public.shift_flags_add(text[], text[])',
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
--   where p.proname in ('walkaround_insert_defects','walkaround_assert_result','shift_flags_add',
--                       'walkaround_submit_check','shift_record_event',
--                       'shift_apply_correction','shift_office_start')
--     and r.rolname in ('anon','authenticated','service_role')
--     and has_function_privilege(r.oid, p.oid, 'execute');
--   -- expect only service_role rows.
