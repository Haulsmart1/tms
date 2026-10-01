-- prodfix_95_ledger_readonly.sql
--
-- Findings H-1 and M-3 of docs/superpowers/reviews/2026-09-22-owasp-adversarial-review.md.
--
-- WHAT WAS WRONG (confirmed live on 2026-09-22, Appendix A queries 1, 8 and 9)
--   Every accounts ledger table grants INSERT, UPDATE and DELETE to `authenticated`, behind a
--   policy that lets any member of the tenant write: invoices and customers carry rls_03's
--   `tenant_access FOR ALL using can_access_tenant(tenant_id)`; credit_notes, customer_payments,
--   invoice_lines and document_delivery_log carry `FOR ALL using tenant_id = auth_tenant_id()`;
--   quotations, quotation_lines and customer_contacts carry per-command policies on the same
--   function. The accounts API (app/api/accounts/**) is careful: drivers refused, status and totals
--   never taken from the client, credit notes capped, numbers allocated server-side. None of that
--   exists in the database, and the browser holds the anon key plus the user's JWT, so a staff or
--   driver profile can PATCH /rest/v1/invoices to `paid`, rewrite an issued total, delete a VAT
--   invoice, force a quotation to `accepted`, or add its own address to customer_contacts (the
--   allow-list the invoice email route consults).
--
--   document_delivery_log additionally held the FULL share URL, live token included, for every
--   emailed POD and quotation (M-3). The code now stores an opaque row reference
--   (lib/documents/shareReference.ts); STEP 3 below nulls the historical values.
--
-- WHAT IT DOES, for each table in `ledger` that exists (missing tables are reported, not an error):
--   STEP 1  revoke insert, update, delete (and truncate, references, trigger) from anon,
--           authenticated and PUBLIC; revoke everything from anon; grant the four DML privileges
--           to service_role explicitly so the accounts routes keep working whatever the table's
--           original default privileges were; enable RLS (already on live, harmless to repeat).
--   STEP 2  on tables that have a tenant_id column: drop every policy and install ONE
--           `tenant_read FOR SELECT to authenticated using (public.can_access_tenant(tenant_id))`.
--           That is the reviewed helper every other tenant table uses, so a company admin on
--           "All tenants" reads the whole company (the accounts routes already do this through
--           the service role; the browser readers are the dashboard and stats pages).
--           Tables WITHOUT a tenant_id column (link tables such as invoice_jobs) keep their
--           existing policies: with the DML grants gone the policy only ever governs SELECT, and
--           their parent-scoped USING clauses are the right read rule. They are listed in the
--           notices so a follow-up can re-key them deliberately.
--   STEP 3  null every document_delivery_log.share_reference that contains a share URL.
--   STEP 4  report: any listed table whose DML grant survived, and every remaining policy.
--
-- DELIBERATELY NOT IN THE LIST
--   customers, customer_integrations   app/api/customers/** writes them through the USER client
--                                       (requireTenant), so revoking the grant would break customer
--                                       create/edit/delete. Move those routes to the service role
--                                       first, then add both here. Their tenant_access policy stays.
--   subcontractors and its children     app/subcontractors/page.tsx writes them from the browser
--                                       (finding M-4). Needs the page reworked before locking.
--   company_billing and the billing_*   already locked by billing_01 / billing_03 / billing_06.
--
-- ORDER: deploy the code on branch ethan/ledger-readonly FIRST. app/super-admin/invoices/page.tsx
-- used to update invoices.status with the browser client; it now calls
-- PATCH /api/super-admin/invoices/[id]. If this file lands before that deploy, the old button
-- answers "permission denied" until the deploy; nothing else is affected.
-- Independent of every other prodfix file. Safe to re-run: every statement is idempotent.
--
-- PRECONDITIONS (asserted): public.can_access_tenant(uuid) exists (rls_08).

do $$
declare
  ledger text[] := array[
    'invoices', 'invoice_lines', 'invoice_jobs', 'invoice_items',
    'credit_notes', 'credit_note_lines', 'credit_note_allocations',
    'customer_payments', 'payment_allocations',
    'customer_chase_letters', 'customer_chase_letter_invoices',
    'customer_statements', 'customer_statement_lines',
    'customer_purchase_orders', 'customer_purchase_order_jobs',
    'supplier_purchase_orders', 'supplier_purchase_order_jobs',
    'quotations', 'quotation_lines', 'quotation_stops', 'quotation_template_settings',
    'customer_contacts', 'customer_addresses', 'customer_rates', 'customer_documents',
    'tenant_payment_settings', 'document_delivery_log', 'financial_documents',
    'accounting_integrations', 'accounting_sync_log', 'accounting_entity_links'
  ];
  t          text;
  pol        record;
  has_tenant boolean;
  missing    text[] := '{}';
  kept       text[] := '{}';
  rekeyed    text[] := '{}';
  nulled     integer := 0;
begin
  if to_regprocedure('public.can_access_tenant(uuid)') is null then
    raise exception 'prodfix_95: public.can_access_tenant(uuid) is missing (apply rls_08 first). Nothing changed.';
  end if;

  foreach t in array ledger loop
    if to_regclass('public.' || t) is null then
      missing := missing || t;
      continue;
    end if;

    -- STEP 1: the hard control. Grants, not policies, are what stop a browser write.
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated, public', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);

    -- STEP 2: one read policy on the reviewed helper where the table is tenant-keyed.
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'tenant_id'
    ) into has_tenant;

    if has_tenant then
      for pol in
        select policyname from pg_policies where schemaname = 'public' and tablename = t
      loop
        execute format('drop policy %I on public.%I', pol.policyname, t);
      end loop;
      execute format(
        'create policy tenant_read on public.%I for select to authenticated using (public.can_access_tenant(tenant_id))', t);
      rekeyed := rekeyed || t;
    else
      kept := kept || t;
    end if;
  end loop;

  -- STEP 3: purge the historical share URLs (M-3).
  if to_regclass('public.document_delivery_log') is not null then
    update public.document_delivery_log
       set share_reference = null
     where share_reference like '%/share/%';
    get diagnostics nulled = row_count;
  end if;

  raise notice 'prodfix_95: read-only with tenant_read: %', array_to_string(rekeyed, ', ');
  raise notice 'prodfix_95: writes revoked, existing policies kept (no tenant_id): %', coalesce(array_to_string(kept, ', '), '(none)');
  raise notice 'prodfix_95: not present, skipped: %', coalesce(array_to_string(missing, ', '), '(none)');
  raise notice 'prodfix_95: share URLs nulled in document_delivery_log: %', nulled;
end $$;

-- STEP 4a: HARD assertion. Expect 0 rows: no listed table still grants a DML privilege to a client role.
select c.relname,
       has_table_privilege('authenticated', c.oid, 'insert') as a_ins,
       has_table_privilege('authenticated', c.oid, 'update') as a_upd,
       has_table_privilege('authenticated', c.oid, 'delete') as a_del,
       has_table_privilege('anon', c.oid, 'select')          as anon_sel
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'invoices', 'invoice_lines', 'invoice_jobs', 'invoice_items',
    'credit_notes', 'credit_note_lines', 'credit_note_allocations',
    'customer_payments', 'payment_allocations',
    'customer_chase_letters', 'customer_chase_letter_invoices',
    'customer_statements', 'customer_statement_lines',
    'customer_purchase_orders', 'customer_purchase_order_jobs',
    'supplier_purchase_orders', 'supplier_purchase_order_jobs',
    'quotations', 'quotation_lines', 'quotation_stops', 'quotation_template_settings',
    'customer_contacts', 'customer_addresses', 'customer_rates', 'customer_documents',
    'tenant_payment_settings', 'document_delivery_log', 'financial_documents',
    'accounting_integrations', 'accounting_sync_log', 'accounting_entity_links')
  and (has_table_privilege('authenticated', c.oid, 'insert')
    or has_table_privilege('authenticated', c.oid, 'update')
    or has_table_privilege('authenticated', c.oid, 'delete')
    or has_table_privilege('anon', c.oid, 'select'));

-- STEP 4b: what is left. Every tenant-keyed table shows exactly one row, `tenant_read` / SELECT.
-- Link tables show their original parent-scoped policies; review those by hand.
select tablename, policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public'
  and tablename in (
    'invoices', 'invoice_lines', 'invoice_jobs', 'invoice_items',
    'credit_notes', 'credit_note_lines', 'credit_note_allocations',
    'customer_payments', 'payment_allocations',
    'customer_chase_letters', 'customer_chase_letter_invoices',
    'customer_statements', 'customer_statement_lines',
    'customer_purchase_orders', 'customer_purchase_order_jobs',
    'supplier_purchase_orders', 'supplier_purchase_order_jobs',
    'quotations', 'quotation_lines', 'quotation_stops', 'quotation_template_settings',
    'customer_contacts', 'customer_addresses', 'customer_rates', 'customer_documents',
    'tenant_payment_settings', 'document_delivery_log', 'financial_documents',
    'accounting_integrations', 'accounting_sync_log', 'accounting_entity_links')
order by tablename, policyname;
