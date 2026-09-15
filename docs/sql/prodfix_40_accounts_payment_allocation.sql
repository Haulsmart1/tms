-- prodfix_40_accounts_payment_allocation.sql
--
-- Atomic customer payment recording with allocation checks.
-- Review findings ACC-1 (CRITICAL), INV-3, INV-10.
--
-- Why: POST /api/accounts/payments inserted customer_payments and
-- payment_allocations through the service role with no check that the invoice
-- belongs to the tenant or to the customer, that the allocation is positive,
-- within the payment, or within the invoice's outstanding balance, and it
-- recorded every payment as GBP. A member of tenant A could mark tenant B's
-- invoice paid, and a GBP 1 receipt could settle a GBP 10,000 invoice.
-- The route now calls this function, which runs every check and both inserts
-- in one transaction while holding a row lock on the invoice, so two
-- concurrent allocations cannot both fit into the same balance.
--
-- DEFENSIVE NOTE: the DDL of customers, invoices, customer_payments,
-- payment_allocations and credit_note_allocations is NOT in the repo. This
-- file only creates a function. It alters no table, grant or policy, so it
-- cannot widen access if the live schema differs. It uses only the columns the
-- route already wrote and read:
--   customers(id, tenant_id, currency_code)
--   invoices(id, tenant_id, customer_id, status, total, currency)
--   customer_payments(id, tenant_id, customer_id, payment_date, amount, currency,
--     payment_method, payment_reference, bank_reference, notes, created_by)
--   payment_allocations(tenant_id, payment_id, invoice_id, amount, allocated_by)
--   credit_note_allocations(invoice_id, amount)
-- Confirm them in section 10 of docs/sql/diag_2026_09_14_live_state.sql (or the
-- table editor) first. If one is missing, the function errors at call time,
-- nothing is written, and the route answers with a generic failure.
--
-- The outstanding balance is computed here as total minus every payment and
-- credit allocation for the invoice, not read from invoices.balance_due,
-- because how balance_due is maintained is not visible in the repo. Values are
-- assigned through %TYPE variables so text or enum status/currency columns both
-- work.
--
-- Access: EXECUTE for service_role only. SECURITY INVOKER, so it grants no
-- privilege the caller does not already hold. Until this file is applied the
-- payments POST refuses with "pending database update" and writes nothing.
--
-- Safe to re-run. Apply in the Supabase SQL editor.

begin;

create or replace function public.accounts_record_customer_payment(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_user_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_currency text,
  p_payment_method text,
  p_payment_reference text,
  p_bank_reference text,
  p_notes text,
  p_invoice_id uuid,
  p_allocate_amount numeric
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_customer_currency text;
  v_invoice_status text;
  v_invoice_total numeric;
  v_invoice_currency text;
  v_currency text;
  v_paid numeric;
  v_credited numeric;
  v_outstanding numeric;
  v_payment_id uuid;
  v_currency_value public.customer_payments.currency%type;
  v_method_value public.customer_payments.payment_method%type;
begin
  if p_tenant_id is null or p_customer_id is null or p_user_id is null then
    raise exception 'payment_invalid';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'payment_amount_invalid';
  end if;

  select c.currency_code::text
    into v_customer_currency
  from public.customers c
  where c.id = p_customer_id
    and c.tenant_id = p_tenant_id;

  if not found then
    raise exception 'customer_not_found';
  end if;

  v_currency := upper(coalesce(nullif(trim(p_currency), ''), nullif(trim(v_customer_currency), ''), 'GBP'));

  if p_invoice_id is not null then
    if p_allocate_amount is null or p_allocate_amount <= 0 or p_allocate_amount > p_amount then
      raise exception 'allocation_invalid';
    end if;

    -- Lock the invoice so concurrent allocations against it run one at a time.
    select i.status::text, i.total, upper(coalesce(nullif(trim(i.currency::text), ''), 'GBP'))
      into v_invoice_status, v_invoice_total, v_invoice_currency
    from public.invoices i
    where i.id = p_invoice_id
      and i.tenant_id = p_tenant_id
      and i.customer_id = p_customer_id
    for update;

    if not found then
      raise exception 'invoice_not_found';
    end if;

    if lower(coalesce(v_invoice_status, '')) in ('draft', 'awaiting_pod', 'void', 'cancelled') then
      raise exception 'invoice_not_payable';
    end if;

    if nullif(trim(p_currency), '') is null then
      v_currency := v_invoice_currency;
    elsif v_currency <> v_invoice_currency then
      raise exception 'currency_mismatch';
    end if;

    -- Every allocation for this invoice counts, whatever tenant_id the
    -- allocation row carries, so rows written before this fix still reduce
    -- the balance.
    select coalesce(sum(pa.amount), 0)
      into v_paid
    from public.payment_allocations pa
    where pa.invoice_id = p_invoice_id;

    select coalesce(sum(ca.amount), 0)
      into v_credited
    from public.credit_note_allocations ca
    where ca.invoice_id = p_invoice_id;

    v_outstanding := round(coalesce(v_invoice_total, 0) - v_paid - v_credited, 2);

    if round(p_allocate_amount, 2) > v_outstanding then
      raise exception 'allocation_exceeds_balance';
    end if;
  end if;

  v_currency_value := v_currency;
  v_method_value := nullif(trim(p_payment_method), '');

  insert into public.customer_payments (
    tenant_id, customer_id, payment_date, amount, currency, payment_method,
    payment_reference, bank_reference, notes, created_by
  )
  values (
    p_tenant_id, p_customer_id, p_payment_date, round(p_amount, 2), v_currency_value, v_method_value,
    nullif(trim(p_payment_reference), ''), nullif(trim(p_bank_reference), ''), nullif(trim(p_notes), ''), p_user_id
  )
  returning id into v_payment_id;

  if p_invoice_id is not null then
    insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount, allocated_by)
    values (p_tenant_id, v_payment_id, p_invoice_id, round(p_allocate_amount, 2), p_user_id);
  end if;

  return v_payment_id;
end;
$$;

revoke all on function public.accounts_record_customer_payment(
  uuid, uuid, uuid, date, numeric, text, text, text, text, text, uuid, numeric
) from public, anon, authenticated;

grant execute on function public.accounts_record_customer_payment(
  uuid, uuid, uuid, date, numeric, text, text, text, text, text, uuid, numeric
) to service_role;

commit;

-- Verify: expect one row, security_definer=false, anon_exec=false,
-- auth_exec=false, service_exec=true.
select p.proname,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'accounts_record_customer_payment';
