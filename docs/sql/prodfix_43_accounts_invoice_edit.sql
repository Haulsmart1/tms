-- prodfix_43_accounts_invoice_edit.sql
--
-- Atomic edit of a draft invoice's header fields and line values.
-- Review findings ACC-3, ACC-4, INV-8.
--
-- Why: PATCH /api/accounts/invoices/[id] wrote the header (including status)
-- first, only then checked whether the invoice was locked, and validated the
-- lines after the header was already saved. A body of
-- {status: "draft", lines: [...]} unlocked a sent invoice and repriced it.
-- The route now refuses status changes combined with edits, checks the rules in
-- lib/accounts/invoiceStatus.ts and validates every line before any write, and
-- performs the write through this function, which locks the invoice row,
-- re-checks that it is still an unsynced draft (so an approval or Xero sync
-- that lands in between wins), updates the header and every line, and
-- recalculates totals in one transaction. A failure anywhere writes nothing.
--
-- DEFENSIVE NOTE: the DDL of invoices, invoice_lines and the function
-- recalculate_invoice_totals is NOT in the repo. Values are converted with
-- jsonb_populate_record against the real table types, so text or date columns
-- both work. Columns touched are the ones the route already wrote:
--   invoices(id, tenant_id, status, accounting_invoice_id, issue_date, due_date,
--     po_reference, customer_reference, notes, updated_at)
--   invoice_lines(id, invoice_id, tenant_id, description, quantity, unit_price, vat_rate)
-- Only creates a function; alters no table, grant or policy.
--
-- Access: EXECUTE for service_role only, SECURITY INVOKER. Until this file is
-- applied, editing invoice values refuses with "pending database update" and
-- writes nothing. Status-only changes (approve, back to draft, void) do not
-- need it.
--
-- Safe to re-run. Apply in the Supabase SQL editor.

begin;

create or replace function public.accounts_update_invoice_values(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_header jsonb,
  p_lines jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_synced text;
  v_line jsonb;
  v_row public.invoice_lines%rowtype;
  v_count integer;
begin
  select i.status::text, i.accounting_invoice_id::text
    into v_status, v_synced
  from public.invoices i
  where i.id = p_invoice_id
    and i.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'invoice_not_found';
  end if;

  if v_synced is not null and v_synced <> '' then
    raise exception 'invoice_synced';
  end if;

  if lower(coalesce(v_status, '')) not in ('draft', 'awaiting_pod') then
    raise exception 'invoice_locked';
  end if;

  if p_header is not null and jsonb_typeof(p_header) = 'object' and p_header <> '{}'::jsonb then
    update public.invoices i
    set issue_date = case when p_header ? 'issue_date' then r.issue_date else i.issue_date end,
        due_date = case when p_header ? 'due_date' then r.due_date else i.due_date end,
        po_reference = case when p_header ? 'po_reference' then r.po_reference else i.po_reference end,
        customer_reference = case when p_header ? 'customer_reference' then r.customer_reference else i.customer_reference end,
        notes = case when p_header ? 'notes' then r.notes else i.notes end,
        updated_at = now()
    from jsonb_populate_record(null::public.invoices, p_header) as r
    where i.id = p_invoice_id
      and i.tenant_id = p_tenant_id;
  end if;

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then
    for v_line in select value from jsonb_array_elements(p_lines) loop
      v_row := jsonb_populate_record(null::public.invoice_lines, v_line);

      if v_row.id is null
         or v_row.quantity is null or v_row.quantity <= 0
         or v_row.unit_price is null or v_row.unit_price < 0
         or v_row.vat_rate is null or v_row.vat_rate < 0 or v_row.vat_rate > 100 then
        raise exception 'invoice_line_invalid';
      end if;

      update public.invoice_lines l
      set description = coalesce(nullif(trim(v_row.description::text), ''), 'Transport service'),
          quantity = v_row.quantity,
          unit_price = v_row.unit_price,
          vat_rate = v_row.vat_rate
      where l.id = v_row.id
        and l.invoice_id = p_invoice_id
        and l.tenant_id = p_tenant_id;

      get diagnostics v_count = row_count;
      if v_count <> 1 then
        raise exception 'invoice_line_not_found';
      end if;
    end loop;

    execute format('select public.recalculate_invoice_totals(p_invoice_id => %L)', p_invoice_id);
  end if;
end;
$$;

revoke all on function public.accounts_update_invoice_values(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.accounts_update_invoice_values(uuid, uuid, jsonb, jsonb) to service_role;

commit;

-- Verify: one row, anon_exec=false, auth_exec=false, service_exec=true.
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'accounts_update_invoice_values';
