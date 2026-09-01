begin;

alter table public.jobs
  add column if not exists planning_date date;

comment on column public.jobs.planning_date is
  'Operational planning-board date. Null preserves legacy behaviour using scheduled_date.';

create index if not exists jobs_tenant_planning_date_idx
  on public.jobs (tenant_id, planning_date)
  where planning_date is not null;

commit;
