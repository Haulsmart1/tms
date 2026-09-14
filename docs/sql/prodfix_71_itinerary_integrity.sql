-- prodfix_71_itinerary_integrity.sql
--
-- Canonical planning itinerary integrity. Review finding PLAN-23.
--
-- Why:
--   1. replace_planning_route_itinerary checks tenant, vehicle and stop
--      ownership but not that the job is planned for the itinerary's date, so
--      a crafted call could put another day's job into today's route.
--   2. app/jobs deletes and reinserts a job's stops on every edit. The
--      on delete cascade then removed the service rows, leaving visits with no
--      services, which the client parser skips: the saved route quietly lost
--      drops until Smart Optimize was re-run.
--   3. Moving a job to another planning day left it inside the old day's
--      saved route.
--
-- What:
--   * BEFORE INSERT/UPDATE guard on planning_route_visit_stops: the job's
--     coalesce(planning_date, scheduled_date) must equal the itinerary's
--     planning_date. Rows are only written by the SECURITY DEFINER RPC, so
--     this runs inside it and aborts the whole replace.
--   * BEFORE DELETE on job_stops: any saved itinerary that uses the stop is
--     deleted (invalidated). Planning then shows "needs Smart Optimize"
--     instead of a silently shortened route. SECURITY DEFINER because
--     authenticated has no delete grant on itineraries; it only removes the
--     derived route for a stop the caller was already allowed (by RLS) to
--     delete, so it does not widen access.
--   * AFTER UPDATE OF planning_date, scheduled_date on jobs: itineraries on a
--     date the job is no longer planned for are deleted.
--
-- Depends on live state not in the repo: jobs.planning_date
-- (20260901041500_jobs_planning_date.sql) and the itinerary tables
-- (20260908050000_planning_route_itineraries.sql).
--
-- Safe to re-run. Apply in the Supabase SQL editor.

begin;

create or replace function public.planning_visit_stop_date_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
    v_itinerary_date date;
    v_job_date date;
begin
    select i.planning_date
      into v_itinerary_date
      from public.planning_route_itineraries i
     where i.id = new.itinerary_id
       and i.tenant_id = new.tenant_id;

    select coalesce(j.planning_date, j.scheduled_date)
      into v_job_date
      from public.jobs j
     where j.id = new.job_id
       and j.tenant_id = new.tenant_id;

    if v_itinerary_date is null or v_job_date is distinct from v_itinerary_date then
        raise exception 'A planned job is not scheduled for this planning date.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

drop trigger if exists planning_visit_stop_date_guard
    on public.planning_route_visit_stops;

create trigger planning_visit_stop_date_guard
    before insert or update of job_id, itinerary_id
    on public.planning_route_visit_stops
    for each row
    execute function public.planning_visit_stop_date_guard();


create or replace function public.planning_invalidate_on_stop_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
    delete from public.planning_route_itineraries i
     where exists (
         select 1
           from public.planning_route_visit_stops s
          where s.itinerary_id = i.id
            and s.stop_id = old.id
     );

    return old;
end;
$$;

revoke all on function public.planning_invalidate_on_stop_delete() from public;

drop trigger if exists planning_invalidate_on_stop_delete
    on public.job_stops;

create trigger planning_invalidate_on_stop_delete
    before delete
    on public.job_stops
    for each row
    execute function public.planning_invalidate_on_stop_delete();


create or replace function public.planning_invalidate_on_job_date_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
    if coalesce(new.planning_date, new.scheduled_date)
       is distinct from coalesce(old.planning_date, old.scheduled_date) then
        delete from public.planning_route_itineraries i
         where i.planning_date is distinct from coalesce(new.planning_date, new.scheduled_date)
           and exists (
               select 1
                 from public.planning_route_visit_stops s
                where s.itinerary_id = i.id
                  and s.job_id = new.id
           );
    end if;

    return new;
end;
$$;

revoke all on function public.planning_invalidate_on_job_date_change() from public;

drop trigger if exists planning_invalidate_on_job_date_change
    on public.jobs;

create trigger planning_invalidate_on_job_date_change
    after update of planning_date, scheduled_date
    on public.jobs
    for each row
    execute function public.planning_invalidate_on_job_date_change();

commit;

-- Verify (expect three rows, all enabled = 'O'):
-- select tgname, tgrelid::regclass, tgenabled
--   from pg_trigger
--  where tgname in (
--      'planning_visit_stop_date_guard',
--      'planning_invalidate_on_stop_delete',
--      'planning_invalidate_on_job_date_change'
--  );
