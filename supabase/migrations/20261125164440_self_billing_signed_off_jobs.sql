alter table public.subcontractor_portal_invoices
  add column source_job_id uuid references public.jobs(id) on delete restrict,
  add column source_job_cost numeric,
  add column source_signed_off_at timestamptz,
  add constraint subcontractor_invoice_source_fields check (
    (source_job_id is null and source_job_cost is null and source_signed_off_at is null)
    or (source_job_id is not null and source_job_cost is not null and source_job_cost > 0 and source_signed_off_at is not null)
  );

create unique index subcontractor_invoice_source_job
  on public.subcontractor_portal_invoices (source_job_id)
  where source_job_id is not null;

create view public.subcontractor_self_billing_drafts
with (security_invoker = true) as
select j.id, j.tenant_id, j.subcontractor_id, j.reference, j.completed_at, j.subcontractor_cost
from public.jobs j
where j.subcontractor_id is not null
  and j.archived_at is null
  and j.status = 'completed'
  and j.pod_status = 'delivered'
  and j.completed_at is not null
  and not exists (
    select 1 from public.subcontractor_portal_invoices i where i.source_job_id = j.id
  );

revoke all on public.subcontractor_self_billing_drafts from public, anon, authenticated;
grant select on public.subcontractor_self_billing_drafts to service_role;

create function public.check_subcontractor_invoice_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.jobs j
  where j.id = new.source_job_id
    and j.tenant_id = new.tenant_id
    and j.subcontractor_id = new.subcontractor_id
    and j.archived_at is null
    and j.status = 'completed'
    and j.pod_status = 'delivered'
    and j.completed_at = new.source_signed_off_at
    and j.subcontractor_cost = new.source_job_cost
  for share;

  if not found then
    raise exception 'The linked job changed before the invoice was issued.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger check_subcontractor_invoice_source
  before insert on public.subcontractor_portal_invoices
  for each row when (new.source_job_id is not null)
  execute function public.check_subcontractor_invoice_source();
