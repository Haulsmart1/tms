-- prodfix_42_accounts_credit_notes.sql
--
-- Atomic credit note approval and per-tenant credit note numbering.
-- Review finding ACC-8.
--
-- Why: approving a credit note checked "no allocation yet" and the remaining
-- creditable amount, then inserted the allocation with no lock, so a
-- double-submit could credit an invoice twice. Credits were allowed against
-- draft and void invoices, and the default number was CN-<yyyymmddhhmmss>, so
-- two notes in the same second collided. This file adds:
--   * accounts_document_counters, a service-role-only counter table;
--   * accounts_next_document_number(), which allocates CN-YYYY-0001 style
--     numbers per tenant and skips any number already used;
--   * accounts_approve_credit_note(), which locks the credit note and its
--     invoice, re-checks status and the remaining creditable amount, inserts
--     the allocation and marks the note approved in one transaction;
--   * unique indexes on credit_note_allocations(credit_note_id) and
--     credit_notes(tenant_id, credit_note_number), created only when current
--     data already satisfies them (otherwise a NOTICE, nothing deleted).
--
-- Creditable invoice statuses mirror lib/accounts/invoiceStatus.ts
-- (CREDITABLE_INVOICE_STATUSES); keep the two lists in step.
--
-- DEFENSIVE NOTE: the DDL of credit_notes, credit_note_allocations and invoices
-- is NOT in the repo. Only the columns the route already used are touched:
--   credit_notes(id, tenant_id, status, original_invoice_id, total,
--     credit_note_number, approved_by, approved_at)
--   credit_note_allocations(id, tenant_id, credit_note_id, invoice_id, amount, allocated_by)
--   invoices(id, tenant_id, status, total)
-- The new counter table is created with RLS forced and every client grant
-- revoked. No existing grant or policy is changed, so access cannot widen.
-- `create table if not exists` skips silently if a table with this name
-- already exists; the verify query below shows its columns so you can check.
--
-- Access: both functions EXECUTE for service_role only, SECURITY INVOKER.
-- Until this file is applied, creating and approving credit notes refuses with
-- "pending database update" and writes nothing.
--
-- Safe to re-run. Apply in the Supabase SQL editor.

begin;

create table if not exists public.accounts_document_counters (
  tenant_id     uuid    not null,
  document_type text    not null,
  period        text    not null,
  last_value    integer not null default 0,
  primary key (tenant_id, document_type, period)
);

alter table public.accounts_document_counters enable row level security;
alter table public.accounts_document_counters force row level security;
revoke all on table public.accounts_document_counters from public, anon, authenticated;

create or replace function public.accounts_next_document_number(
  p_tenant_id uuid,
  p_document_type text,
  p_prefix text,
  p_date date
)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_period text := to_char(coalesce(p_date, current_date), 'YYYY');
  v_value integer;
  v_candidate text;
  v_attempts integer := 0;
begin
  if p_tenant_id is null or p_document_type is null or p_document_type !~ '^[a-z_]{1,40}$'
     or p_prefix is null or p_prefix !~ '^[A-Z]{1,6}$' then
    raise exception 'document_number_invalid';
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 1000 then
      raise exception 'document_number_exhausted';
    end if;

    insert into public.accounts_document_counters as c (tenant_id, document_type, period, last_value)
    values (p_tenant_id, p_document_type, v_period, 1)
    on conflict (tenant_id, document_type, period)
    do update set last_value = c.last_value + 1
    returning c.last_value into v_value;

    v_candidate := p_prefix || '-' || v_period || '-' || lpad(v_value::text, 4, '0');

    if p_document_type = 'credit_note' then
      exit when not exists (
        select 1 from public.credit_notes cn
        where cn.tenant_id = p_tenant_id
          and cn.credit_note_number = v_candidate
      );
    else
      exit;
    end if;
  end loop;

  return v_candidate;
end;
$$;

create or replace function public.accounts_approve_credit_note(
  p_tenant_id uuid,
  p_credit_note_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_note_status text;
  v_invoice_id uuid;
  v_note_total numeric;
  v_invoice_status text;
  v_invoice_total numeric;
  v_allocated numeric;
  v_allocation_id uuid;
begin
  if p_tenant_id is null or p_credit_note_id is null or p_user_id is null then
    raise exception 'credit_note_not_found';
  end if;

  select cn.status::text, cn.original_invoice_id, cn.total
    into v_note_status, v_invoice_id, v_note_total
  from public.credit_notes cn
  where cn.id = p_credit_note_id
    and cn.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'credit_note_not_found';
  end if;

  if lower(coalesce(v_note_status, '')) <> 'draft' then
    raise exception 'credit_note_not_draft';
  end if;

  if v_invoice_id is null then
    raise exception 'credit_note_no_invoice';
  end if;

  -- Lock the invoice: every approval against it runs one at a time.
  select i.status::text, i.total
    into v_invoice_status, v_invoice_total
  from public.invoices i
  where i.id = v_invoice_id
    and i.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'invoice_not_found';
  end if;

  if lower(coalesce(v_invoice_status, '')) not in ('approved', 'sent', 'part_paid', 'partially_paid', 'paid', 'overdue') then
    raise exception 'invoice_not_creditable';
  end if;

  if exists (
    select 1 from public.credit_note_allocations a
    where a.credit_note_id = p_credit_note_id
  ) then
    raise exception 'credit_note_already_allocated';
  end if;

  if v_note_total is null or round(v_note_total, 2) <= 0 then
    raise exception 'credit_note_total_invalid';
  end if;

  select coalesce(sum(a.amount), 0)
    into v_allocated
  from public.credit_note_allocations a
  where a.invoice_id = v_invoice_id;

  if round(v_note_total, 2) > round(coalesce(v_invoice_total, 0) - v_allocated, 2) then
    raise exception 'credit_exceeds_remaining';
  end if;

  insert into public.credit_note_allocations (tenant_id, credit_note_id, invoice_id, amount, allocated_by)
  values (p_tenant_id, p_credit_note_id, v_invoice_id, round(v_note_total, 2), p_user_id)
  returning id into v_allocation_id;

  update public.credit_notes
  set status = 'approved',
      approved_by = p_user_id,
      approved_at = now()
  where id = p_credit_note_id
    and tenant_id = p_tenant_id;

  return v_allocation_id;
end;
$$;

revoke all on function public.accounts_next_document_number(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.accounts_next_document_number(uuid, text, text, date) to service_role;

revoke all on function public.accounts_approve_credit_note(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.accounts_approve_credit_note(uuid, uuid, uuid) to service_role;

commit;

do $$
begin
  if exists (
    select 1 from public.credit_note_allocations
    group by credit_note_id
    having count(*) > 1
  ) then
    raise notice 'SKIPPED credit_note_allocations_one_per_note_uidx: some credit notes already have several allocations. Resolve them, then re-run this file.';
  else
    execute 'create unique index if not exists credit_note_allocations_one_per_note_uidx on public.credit_note_allocations (credit_note_id)';
  end if;

  if exists (
    select 1 from public.credit_notes
    where credit_note_number is not null
    group by tenant_id, credit_note_number
    having count(*) > 1
  ) then
    raise notice 'SKIPPED credit_notes_tenant_number_uidx: duplicate credit note numbers exist within a tenant. Resolve them, then re-run this file.';
  else
    execute 'create unique index if not exists credit_notes_tenant_number_uidx on public.credit_notes (tenant_id, credit_note_number) where credit_note_number is not null';
  end if;
end;
$$;

-- Verify: two function rows with anon_exec=false auth_exec=false
-- service_exec=true; the counter table with rls=true force=true and no client
-- grants; and the unique indexes.
select 'function' as kind,
       p.proname as name,
       format('anon_exec=%s auth_exec=%s service_exec=%s',
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')) as detail
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('accounts_next_document_number', 'accounts_approve_credit_note')
union all
select 'table', c.relname,
       format('rls=%s force=%s anon_select=%s auth_select=%s columns=%s',
         c.relrowsecurity, c.relforcerowsecurity,
         has_table_privilege('anon', c.oid, 'select'),
         has_table_privilege('authenticated', c.oid, 'select'),
         (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'accounts_document_counters'
union all
select 'unique_index', indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('credit_note_allocations', 'credit_notes')
  and indexdef ilike '%unique%';
