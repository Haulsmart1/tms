alter table public.drivers
  add column if not exists planning_profile text not null default 'day',
  add column if not exists normal_start_time time;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.drivers'::regclass
      and conname = 'drivers_planning_profile_valid'
  ) then
    alter table public.drivers
      add constraint drivers_planning_profile_valid
      check (planning_profile in ('day', 'tramper'));
  end if;
end
$$;

comment on column public.drivers.planning_profile is
  'Operational planning profile. Day drivers normally return to base each day; trampers may take daily rest en route. This field does not determine the applicable drivers-hours legal regime.';

comment on column public.drivers.normal_start_time is
  'Operator-configured normal planning start time. This is a planning preference and is not evidence of actual driver activity.';
