-- Date-aware atomic planning save. Apply after prodfix_70 and the
-- jobs.planning_date schema update.
-- Keep the two-argument RPC for old clients; new clients call this overload,
-- so an old database refuses the save instead of silently ignoring the date.
-- All work shares one transaction, the existing RLS/ownership/licence gates,
-- stable job locks, and optimistic checks on assignments AND both date fields.
begin;

create or replace function public.save_planning_assignments(
    p_tenant_id uuid,
    p_updates jsonb,
    p_planning_date date
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    v_updated integer;
    v_dates_updated integer;
begin
    if p_planning_date is null then
        raise exception 'Choose a planning date before saving.' using errcode = '22004';
    end if;

    -- The existing function authorizes, locks and validates all assignments.
    -- Any later refusal rolls those writes back with this whole RPC call.
    v_updated := public.save_planning_assignments(p_tenant_id, p_updates);

    if exists (
        select 1 from jsonb_array_elements(p_updates) u
        where not (u ? 'planning_date' and u ? 'expected_planning_date' and u ? 'expected_scheduled_date')
    ) then
        raise exception 'Planning updates must include the last-seen dates.' using errcode = '22023';
    end if;

    if exists (
        select 1 from public.jobs j
        join jsonb_to_recordset(p_updates) as u(
            id uuid, planning_date date,
            expected_planning_date date, expected_scheduled_date date
        ) on u.id = j.id
        where j.tenant_id = p_tenant_id
          and (j.planning_date is distinct from u.expected_planning_date
               or j.scheduled_date is distinct from u.expected_scheduled_date)
    ) then
        raise exception 'PLANNING_CONFLICT: the operational date changed after this board loaded.';
    end if;

    if exists (
        select 1 from jsonb_to_recordset(p_updates) as u(
            vehicle_id uuid, driver_id uuid, planning_date date, expected_planning_date date
        )
        where ((u.vehicle_id is not null or u.driver_id is not null)
                 and u.planning_date is distinct from p_planning_date)
           or ((u.vehicle_id is null and u.driver_id is null)
                 and u.planning_date is distinct from u.expected_planning_date)
    ) then
        raise exception 'Assigned work must use the planning day; unassignment must preserve its date.' using errcode = '22023';
    end if;

    update public.jobs j
       set planning_date = u.planning_date
      from jsonb_to_recordset(p_updates) as u(id uuid, planning_date date)
     where j.id = u.id and j.tenant_id = p_tenant_id;
    get diagnostics v_dates_updated = row_count;
    if v_dates_updated <> v_updated then
        raise exception 'Not every job date could be updated, so nothing was saved.' using errcode = '42501';
    end if;
    return v_updated;
end;
$$;

revoke all on function public.save_planning_assignments(uuid, jsonb, date) from public;
revoke all on function public.save_planning_assignments(uuid, jsonb, date) from anon;
grant execute on function public.save_planning_assignments(uuid, jsonb, date) to authenticated;
notify pgrst, 'reload schema';
commit;
