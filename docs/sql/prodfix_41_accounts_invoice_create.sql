-- prodfix_41_accounts_invoice_create.sql
--
-- Atomic invoice creation from completed jobs, plus the uniqueness that backs it.
-- Review findings ACC-9, INV-9.
--
-- Why: POST /api/accounts/invoices read "is this job already invoiced", then
-- inserted the invoice, its lines and invoice_jobs as three separate requests,
-- ignored the totals recalculation error, and accepted a caller-supplied
-- invoice number. Two clerks invoicing the same job at the same moment both
-- passed the check (the customer is billed twice), and a failed lines insert
-- left an empty invoice holding a number (a gap in VAT invoice numbering).
-- This function does all of it in one transaction and takes a per-job advisory
-- lock first, so overlapping requests serialise and the second one sees the
-- first one's invoice_jobs rows.
--
-- DEFENSIVE NOTE: the DDL of invoices, invoice_lines, invoice_jobs, jobs,
-- customers and the functions next_invoice_number / recalculate_invoice_totals
-- is NOT in the repo. This file:
--   * creates one new function using only the columns the route already used;
--   * calls next_invoice_number and recalculate_invoice_totals with the same
--     named arguments the route used, through EXECUTE with untyped literals so
--     it works whether their parameters are uuid/date or text;
--   * adds two UNIQUE indexes only when no existing rows would violate them.
--     If duplicates already exist it skips that index and raises a NOTICE; read
--     the notices, clean the duplicates, and re-run. It never deletes data.
-- It alters no grant or policy and cannot widen access.
-- Check section 05 (function sources) and section 09 (unique indexes) of
-- docs/sql/diag_2026_09_14_live_state.sql before applying.
--
-- Access: EXECUTE for service_role only, SECURITY INVOKER. Until this file is
-- applied, invoice creation refuses with "pending database update" and writes
-- nothing (the old non-atomic path is gone on purpose).
--
-- Safe to re-run. Apply in the Supabase SQL editor.

begin;

create or replace function public.accounts_create_invoice_from_jobs(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_user_id uuid,
  p_job_ids uuid[],
  p_issue_date date,
  p_due_date date,
  p_po_reference text,
  p_notes text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job_ids uuid[];
  v_job_id uuid;
  v_found integer;
  v_foreign integer;
  v_terms integer;
  v_currency text;
  v_vat_rate numeric;
  v_requires_po boolean;
  v_requires_pod boolean;
  v_requires_attachment boolean;
  v_accounts_email text;
  v_pod_blocked boolean;
  v_number text;
  v_due date;
  v_invoice_id uuid;
  v_status public.invoices.status%type;
begin
  if p_tenant_id is null or p_customer_id is null or p_user_id is null or p_issue_date is null then
    raise exception 'invoice_invalid';
  end if;

  select array_agg(distinct j order by j)
    into v_job_ids
  from unnest(p_job_ids) as j
  where j is not null;

  if v_job_ids is null or cardinality(v_job_ids) = 0 then
    raise exception 'no_jobs';
  end if;

  select c.payment_terms_days, c.currency_code::text, c.vat_rate, c.requires_po, c.pod_required,
         c.invoice_pod_attachment_required, c.accounts_email
    into v_terms, v_currency, v_vat_rate, v_requires_po, v_requires_pod,
         v_requires_attachment, v_accounts_email
  from public.customers c
  where c.id = p_customer_id
    and c.tenant_id = p_tenant_id;

  if not found then
    raise exception 'customer_not_found';
  end if;

  -- Serialise on each job in a stable order. Advisory locks do not block the
  -- driver app or planners writing to the jobs rows themselves.
  foreach v_job_id in array v_job_ids loop
    perform pg_advisory_xact_lock(hashtextextended('accounts_invoice_job:' || v_job_id::text, 0));
  end loop;

  select count(*), count(*) filter (where jb.customer_id is distinct from p_customer_id)
    into v_found, v_foreign
  from public.jobs jb
  where jb.tenant_id = p_tenant_id
    and jb.id = any (v_job_ids);

  if v_found <> cardinality(v_job_ids) then
    raise exception 'jobs_not_found';
  end if;

  if v_foreign > 0 then
    raise exception 'jobs_mixed_customer';
  end if;

  if exists (
    select 1 from public.invoice_jobs ij
    where ij.job_id = any (v_job_ids)
      and ij.active = true
  ) then
    raise exception 'jobs_already_invoiced';
  end if;

  v_requires_pod := coalesce(v_requires_pod, false);
  v_requires_attachment := coalesce(v_requires_attachment, false);

  v_pod_blocked := v_requires_pod and exists (
    select 1 from public.jobs jb
    where jb.tenant_id = p_tenant_id
      and jb.id = any (v_job_ids)
      and lower(coalesce(jb.pod_status::text, '')) not in ('complete', 'completed', 'approved', 'received', 'delivered')
  );

  v_due := coalesce(p_due_date, p_issue_date + coalesce(v_terms, 30));

  execute format(
    'select (public.next_invoice_number(p_tenant_id => %L, p_issue_date => %L))::text',
    p_tenant_id, p_issue_date
  ) into v_number;

  v_number := nullif(trim(v_number), '');

  if v_number is null then
    raise exception 'invoice_number_empty';
  end if;

  if exists (
    select 1 from public.invoices i
    where i.tenant_id = p_tenant_id
      and i.invoice_number = v_number
  ) then
    raise exception 'invoice_number_taken';
  end if;

  if v_pod_blocked then
    v_status := 'awaiting_pod';
  else
    v_status := 'draft';
  end if;

  insert into public.invoices (
    tenant_id, customer_id, invoice_number, status, issue_date, due_date, currency,
    po_reference, notes, invoice_email, created_by
  )
  values (
    p_tenant_id, p_customer_id, v_number, v_status, p_issue_date, v_due,
    coalesce(nullif(trim(v_currency), ''), 'GBP'),
    nullif(trim(p_po_reference), ''), nullif(trim(p_notes), ''), nullif(trim(v_accounts_email), ''), p_user_id
  )
  returning id into v_invoice_id;

  insert into public.invoice_lines (
    tenant_id, invoice_id, job_id, line_number, description, quantity, unit_price, vat_rate
  )
  select p_tenant_id,
         v_invoice_id,
         jb.id,
         row_number() over (order by array_position(p_job_ids, jb.id), jb.id),
         'Transport job ' || coalesce(nullif(trim(jb.reference::text), ''), jb.id::text),
         1,
         coalesce(jb.customer_price, 0),
         coalesce(v_vat_rate, 20)
  from public.jobs jb
  where jb.tenant_id = p_tenant_id
    and jb.id = any (v_job_ids);

  insert into public.invoice_jobs (
    tenant_id, invoice_id, job_id, pod_required, pod_status, pod_attached, po_required, po_reference, active
  )
  select p_tenant_id,
         v_invoice_id,
         jb.id,
         v_requires_pod,
         jb.pod_status,
         case when v_requires_attachment then false else not v_requires_pod end,
         coalesce(v_requires_po, false),
         nullif(trim(p_po_reference), ''),
         true
  from public.jobs jb
  where jb.tenant_id = p_tenant_id
    and jb.id = any (v_job_ids);

  execute format('select public.recalculate_invoice_totals(p_invoice_id => %L)', v_invoice_id);

  return v_invoice_id;
end;
$$;

revoke all on function public.accounts_create_invoice_from_jobs(uuid, uuid, uuid, uuid[], date, date, text, text)
  from public, anon, authenticated;
grant execute on function public.accounts_create_invoice_from_jobs(uuid, uuid, uuid, uuid[], date, date, text, text)
  to service_role;

commit;

-- Uniqueness that makes double invoicing and number collisions impossible even
-- outside this function. Created only when current data already satisfies it.
-- (Not inside a transaction block with the function above, so a skipped index
-- never rolls the function back.)
do $$
begin
  if exists (
    select 1 from public.invoice_jobs
    where active = true
    group by job_id
    having count(*) > 1
  ) then
    raise notice 'SKIPPED invoice_jobs_one_active_per_job_uidx: some jobs already have more than one active invoice_jobs row. Resolve them, then re-run this file.';
  else
    execute 'create unique index if not exists invoice_jobs_one_active_per_job_uidx on public.invoice_jobs (job_id) where active = true';
  end if;

  if exists (
    select 1 from public.invoices
    where invoice_number is not null
    group by tenant_id, invoice_number
    having count(*) > 1
  ) then
    raise notice 'SKIPPED invoices_tenant_number_uidx: duplicate invoice numbers exist within a tenant. Resolve them, then re-run this file.';
  else
    execute 'create unique index if not exists invoices_tenant_number_uidx on public.invoices (tenant_id, invoice_number) where invoice_number is not null';
  end if;
end;
$$;

-- Verify: one function row with anon_exec=false, auth_exec=false,
-- service_exec=true; and the index rows (an index may be equivalent to one
-- that already existed under another name, which is also fine).
select 'function' as kind,
       p.proname as name,
       format('anon_exec=%s auth_exec=%s service_exec=%s',
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')) as detail
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'accounts_create_invoice_from_jobs'
union all
select 'unique_index', indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('invoice_jobs', 'invoices')
  and indexdef ilike '%unique%';
