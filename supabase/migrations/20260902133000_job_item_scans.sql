
create table public.job_item_scans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null
    references public.jobs(id) on delete restrict,
  stop_id uuid not null
    references public.job_stops(id) on delete restrict,
  job_item_id uuid not null
    references public.job_items(id) on delete restrict,
  serial_number text not null,
  scan_format text,
  scanned_by uuid not null
    references auth.users(id) on delete restrict,
  scanned_at timestamptz not null default now(),

  constraint job_item_scans_serial_number_check
    check (
      length(btrim(serial_number)) between 1 and 250
    ),

  constraint job_item_scans_scan_format_check
    check (
      scan_format is null
      or length(scan_format) between 1 and 80
    )
);

create unique index job_item_scans_unique_verification
  on public.job_item_scans (
    tenant_id,
    job_id,
    job_item_id,
    serial_number
  );

create index job_item_scans_job_idx
  on public.job_item_scans (
    tenant_id,
    job_id,
    scanned_at
  );

create index job_item_scans_stop_idx
  on public.job_item_scans (
    tenant_id,
    job_id,
    stop_id,
    scanned_at
  );

create index job_item_scans_item_idx
  on public.job_item_scans (
    tenant_id,
    job_item_id,
    scanned_at
  );

alter table public.job_item_scans
  enable row level security;

create policy job_item_scans_select_tenant
  on public.job_item_scans
  for select
  to authenticated
  using (
    tenant_id = auth_tenant_id()
  );

grant select
  on public.job_item_scans
  to authenticated;
