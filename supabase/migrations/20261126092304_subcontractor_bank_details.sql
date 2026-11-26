create table public.subcontractor_bank_details (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  subcontractor_id uuid not null references public.subcontractors(id),
  encrypted_details text not null,
  account_last_four text not null check (account_last_four ~ '^[0-9]{4}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by uuid not null,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  ),
  check (reviewed_by is null or reviewed_by <> submitted_by)
);

create unique index subcontractor_bank_details_one_pending
  on public.subcontractor_bank_details (tenant_id, subcontractor_id) where status = 'pending';
create index subcontractor_bank_details_recent
  on public.subcontractor_bank_details (tenant_id, subcontractor_id, status, submitted_at desc, id);

alter table public.subcontractor_bank_details enable row level security;
revoke all on public.subcontractor_bank_details from public, anon, authenticated, service_role;
grant select, insert on public.subcontractor_bank_details to service_role;
grant update (status, reviewed_by, reviewed_at) on public.subcontractor_bank_details to service_role;
