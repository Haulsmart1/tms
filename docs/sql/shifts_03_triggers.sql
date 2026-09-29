-- shifts_03: database backstops for walkaround checks.
--   1. guard_defect_catalogue: nobody edits or deletes the baseline, nobody
--      deletes company items (retire them instead), company rows keep their
--      company and code. errcode WLK03.
--   2. guard_vehicle_return_to_service: vehicles.vor cannot go true -> false
--      while the vehicle has an open dangerous walkaround defect without an
--      approved objection. errcode WLK01. THE CONTRACT with
--      lib/walkaround/vor.ts (RETURN_BLOCKED_MESSAGE, verbatim).
--   3. rectify_walkaround_defect: completing the linked maintenance record
--      sets walkaround_defects.rectified_at.
--   4. gate_vehicle_licensed on shift_vehicle_periods, reusing prodfix_30's
--      function, so an unlicensed or cancelled-company vehicle cannot be taken
--      out on a shift (LIC01 / LIC02).
--
-- Apply after shifts_01 and shifts_02. Safe to re-run.

begin;

create or replace function public.guard_defect_catalogue()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.walkaround_seed', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Walkaround checklist items cannot be deleted. Retire the item instead.'
      using errcode = 'WLK03';
  end if;

  if new.company_id is null or (tg_op = 'UPDATE' and old.company_id is null) then
    raise exception 'The baseline walkaround checklist cannot be changed.'
      using errcode = 'WLK03';
  end if;

  if tg_op = 'UPDATE' and (new.company_id is distinct from old.company_id or new.code is distinct from old.code) then
    raise exception 'A checklist item cannot move company or change its code.'
      using errcode = 'WLK03';
  end if;

  return new;
end $$;

drop trigger if exists guard_defect_catalogue on public.defect_catalogue_items;
create trigger guard_defect_catalogue before insert or update or delete on public.defect_catalogue_items
  for each row execute function public.guard_defect_catalogue();

create or replace function public.guard_vehicle_return_to_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.vor is true and new.vor is not true and exists (
    select 1
    from public.walkaround_defects d
    where d.vehicle_id = new.id
      and d.final_severity = 'dangerous'
      and d.rectified_at is null
      and not exists (
        select 1 from public.defect_objections o
        where o.defect_id = d.id and o.status = 'approved'
      )
  ) then
    raise exception 'This vehicle has an open dangerous walkaround defect. Rectify it, or approve the driver''s objection, before returning the vehicle to service.'
      using errcode = 'WLK01', hint = 'walkaround_defect_open';
  end if;
  return new;
end $$;

revoke all on function public.guard_vehicle_return_to_service() from public, anon, authenticated;

drop trigger if exists guard_vehicle_return_to_service on public.vehicles;
create trigger guard_vehicle_return_to_service before update of vor on public.vehicles
  for each row execute function public.guard_vehicle_return_to_service();

create or replace function public.rectify_walkaround_defect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.walkaround_defects
       set rectified_at = now()
     where maintenance_record_id = new.id
       and rectified_at is null;
  end if;
  return new;
end $$;

revoke all on function public.rectify_walkaround_defect() from public, anon, authenticated;

drop trigger if exists rectify_walkaround_defect on public.maintenance_records;
create trigger rectify_walkaround_defect after update of status on public.maintenance_records
  for each row execute function public.rectify_walkaround_defect();

do $$
begin
  if to_regprocedure('public.guard_vehicle_assignment_licensed()') is null then
    raise notice 'shifts_03: prodfix_30 is not applied, shift_vehicle_periods is NOT licence-gated. Re-run shifts_03 after prodfix_30.';
  else
    execute 'drop trigger if exists gate_vehicle_licensed on public.shift_vehicle_periods';
    execute 'create trigger gate_vehicle_licensed before insert or update of vehicle_id on public.shift_vehicle_periods
               for each row execute function public.guard_vehicle_assignment_licensed(''vehicle_id'')';
    raise notice 'shifts_03: gated public.shift_vehicle_periods.vehicle_id';
  end if;
end $$;

commit;

-- ===========================================================================
-- VERIFY
--   select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   where t.tgname in ('guard_defect_catalogue','guard_vehicle_return_to_service',
--                      'rectify_walkaround_defect','gate_vehicle_licensed')
--     and not t.tgisinternal order by 1, 2;
--   -- expect defect_catalogue_items, vehicles, maintenance_records and
--   -- shift_vehicle_periods (plus prodfix_30's own gated tables).
