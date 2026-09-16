-- prodfix_70_planning_save.sql
--
-- Atomic planning save with optimistic concurrency. Review findings PLAN-8 and
-- PLAN-11.
--
-- Why: app/planning sent one unconditional UPDATE per job. A failure part-way
-- left a half-saved plan; a second planner (or a restored stale browser draft)
-- silently overwrote newer assignments; and lanes could point a job at another
-- tenant's vehicle or driver, because RLS on jobs only checks the job's own
-- tenant.
--
-- What: public.save_planning_assignments(p_tenant_id, p_updates) applies every
-- job's vehicle_id, driver_id and route_order in ONE transaction, or nothing:
--   * every job must belong to p_tenant_id (rows are locked FOR UPDATE);
--   * each row carries the values the caller last saw (expected_*); if any job
--     differs now, the whole save raises PLANNING_CONFLICT and nothing changes;
--   * a planned vehicle or driver must belong to the same tenant (or carry the
--     tenant's company id in tenant_id, which some legacy vehicle rows do);
--   * if RLS hides or blocks any row, the row count check aborts the save.
--
-- SECURITY INVOKER on purpose: the caller's RLS still applies to every read
-- and write, so this cannot widen access. can_access_tenant is checked first
-- for a clear error.
--
-- Degrades safely: until this is applied the app refuses to save and says so
-- (PostgREST PGRST202), keeping changes in the browser.
--
-- Depends on live state not in the repo: jobs.vehicle_id, jobs.driver_id,
-- jobs.route_order (20260819_planning.sql), public.can_access_tenant
-- (rls_02_helpers.sql), tenants.company_id (rls_01).
--
-- Safe to re-run. Apply in the Supabase SQL editor.

begin;

create or replace function public.save_planning_assignments(
    p_tenant_id uuid,
    p_updates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    v_expected integer;
    v_distinct integer;
    v_locked integer;
    v_updated integer;
    v_company uuid;
begin
    if p_tenant_id is null then
        raise exception 'Choose a tenant before saving the plan.'
            using errcode = '22004';
    end if;

    if not public.can_access_tenant(p_tenant_id) then
        raise exception 'Not permitted to modify this tenant.'
            using errcode = '42501';
    end if;

    if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
        raise exception 'Planning updates must be an array.'
            using errcode = '22023';
    end if;

    v_expected := jsonb_array_length(p_updates);

    if v_expected = 0 then
        return 0;
    end if;

    if v_expected > 2000 then
        raise exception 'Too many planning updates in one save.'
            using errcode = '22023';
    end if;

    select count(distinct u.id)
      into v_distinct
      from jsonb_to_recordset(p_updates) as u(id uuid)
     where u.id is not null;

    if v_distinct <> v_expected then
        raise exception 'Planning updates must name each job exactly once.'
            using errcode = '22023';
    end if;

    select t.company_id
      into v_company
      from public.tenants t
     where t.id = p_tenant_id;

    -- Lock the jobs being planned, in a stable order, so two concurrent saves
    -- serialise instead of interleaving.
    select count(*)
      into v_locked
      from (
          select j.id
            from public.jobs j
           where j.tenant_id = p_tenant_id
             and j.id in (
                 select u.id from jsonb_to_recordset(p_updates) as u(id uuid)
             )
           order by j.id
             for update
      ) locked;

    if v_locked <> v_expected then
        raise exception 'One or more jobs are not in this tenant or no longer exist.'
            using errcode = '42501';
    end if;

    if exists (
        select 1
          from public.jobs j
          join jsonb_to_recordset(p_updates) as u(
                   id uuid,
                   expected_vehicle_id uuid,
                   expected_driver_id uuid,
                   expected_route_order integer
               )
            on u.id = j.id
         where j.vehicle_id is distinct from u.expected_vehicle_id
            or j.driver_id is distinct from u.expected_driver_id
            or j.route_order is distinct from u.expected_route_order
    ) then
        raise exception 'PLANNING_CONFLICT: another change was saved to these jobs after this board loaded.';
    end if;

    if exists (
        select 1
          from jsonb_to_recordset(p_updates) as u(vehicle_id uuid)
         where u.vehicle_id is not null
           and not exists (
               select 1
                 from public.vehicles v
                where v.id = u.vehicle_id
                  and (v.tenant_id = p_tenant_id
                       or (v_company is not null and v.tenant_id = v_company))
           )
    ) then
        raise exception 'A planned vehicle does not belong to this tenant.'
            using errcode = '42501';
    end if;

    if exists (
        select 1
          from jsonb_to_recordset(p_updates) as u(driver_id uuid)
         where u.driver_id is not null
           and not exists (
               select 1
                 from public.drivers d
                where d.id = u.driver_id
                  and (d.tenant_id = p_tenant_id
                       or (v_company is not null and d.tenant_id = v_company))
           )
    ) then
        raise exception 'A planned driver does not belong to this tenant.'
            using errcode = '42501';
    end if;

    update public.jobs j
       set vehicle_id = u.vehicle_id,
           driver_id = u.driver_id,
           route_order = u.route_order
      from jsonb_to_recordset(p_updates) as u(
               id uuid,
               vehicle_id uuid,
               driver_id uuid,
               route_order integer
           )
     where j.id = u.id
       and j.tenant_id = p_tenant_id;

    get diagnostics v_updated = row_count;

    if v_updated <> v_expected then
        raise exception 'Not every job could be updated, so nothing was saved.'
            using errcode = '42501';
    end if;

    return v_updated;
end;
$$;

revoke all on function public.save_planning_assignments(uuid, jsonb) from public;
revoke all on function public.save_planning_assignments(uuid, jsonb) from anon;
grant execute on function public.save_planning_assignments(uuid, jsonb) to authenticated;

comment on function public.save_planning_assignments(uuid, jsonb) is
    'Atomic planning save: all-or-nothing, refuses when any job changed since the caller loaded it (review PLAN-8, PLAN-11).';

commit;

-- Verify (expect: security_invoker = true, anon cannot execute, authenticated can):
-- select p.prosecdef as security_definer
--   from pg_proc p where p.proname = 'save_planning_assignments';
-- select has_function_privilege('anon', 'public.save_planning_assignments(uuid,jsonb)', 'execute') as anon_exec,
--        has_function_privilege('authenticated', 'public.save_planning_assignments(uuid,jsonb)', 'execute') as auth_exec;
