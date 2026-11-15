create table public.subcontractor_portal_invoices (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  subcontractor_id uuid not null references public.subcontractors(id),
  invoice_number text not null check (char_length(btrim(invoice_number)) between 1 and 100),
  issue_date date not null,
  published_at timestamptz not null default now()
);

create unique index subcontractor_portal_invoices_reference
  on public.subcontractor_portal_invoices (tenant_id, subcontractor_id, lower(invoice_number));
create index subcontractor_portal_invoices_recent
  on public.subcontractor_portal_invoices (tenant_id, subcontractor_id, issue_date desc, id);

alter table public.subcontractor_portal_invoices enable row level security;
revoke all on public.subcontractor_portal_invoices from public, anon, authenticated;
grant select, insert on public.subcontractor_portal_invoices to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('subcontractor-invoices', 'subcontractor-invoices', false, 4000000, array['application/pdf']);

create policy subcontractor_invoice_storage_service_only on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'subcontractor-invoices')
  with check (bucket_id <> 'subcontractor-invoices');
