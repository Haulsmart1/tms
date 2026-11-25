create or replace view public.jobs_ready_to_invoice
with (security_invoker = true) as
select j.id as job_id,
       j.tenant_id,
       j.customer_id,
       j.reference as job_reference,
       j.scheduled_date,
       j.completed_at,
       j.customer_price,
       j.pod_status,
       c.name as customer_name,
       c.account_code,
       c.accounts_email,
       c.payment_terms_days,
       c.currency_code,
       c.vat_rate,
       c.requires_po,
       c.pod_required,
       c.invoice_pod_attachment_required,
       exists (
         select 1 from public.invoice_jobs ij where ij.job_id = j.id and ij.active = true
       ) as already_invoiced
from public.jobs j
left join public.customers c on c.id = j.customer_id
where j.customer_id is not null
  and j.completed_at is not null
  and j.archived_at is null
  and not exists (
    select 1 from public.invoice_jobs ij where ij.job_id = j.id and ij.active = true
  );

-- Check within the invoice transaction and lock against a concurrent job archive.
create function public.prevent_archived_job_invoicing()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  job_archived_at timestamptz;
begin
  select j.archived_at into job_archived_at
  from public.jobs j
  where j.id = new.job_id
  for share;

  if job_archived_at is not null then
    raise exception 'job_archived';
  end if;

  return new;
end;
$$;

create trigger prevent_archived_job_invoicing
  before insert on public.invoice_jobs
  for each row when (new.active is true)
  execute function public.prevent_archived_job_invoicing();
