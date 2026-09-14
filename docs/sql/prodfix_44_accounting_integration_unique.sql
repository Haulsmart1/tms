-- prodfix_44_accounting_integration_unique.sql
--
-- One active TMS tenant per external accounting organisation.
-- Review finding ACC-17 (third bullet).
--
-- Why: nothing prevented the same Xero organisation being connected to two
-- TMS tenants, which would push both tenants' invoices into one ledger. The
-- OAuth callback now refuses that case in code; this index makes it
-- impossible at the database level too.
--
-- DEFENSIVE NOTE: the DDL of accounting_integrations is NOT in the repo (only
-- its use in app/api/accounts/accounting/**). This file only adds a partial
-- UNIQUE index on (provider, external_tenant_id) for active rows, and only when
-- no current rows would violate it. If duplicates exist it raises a NOTICE and
-- skips; it never deletes or deactivates anything. It alters no grant or
-- policy, so it cannot widen access.
--
-- Safe to re-run. Apply in the Supabase SQL editor.

do $$
begin
  if exists (
    select 1
    from public.accounting_integrations
    where active = true
      and external_tenant_id is not null
    group by provider, external_tenant_id
    having count(*) > 1
  ) then
    raise notice 'SKIPPED accounting_integrations_active_external_uidx: one external organisation is active on several tenants. Disconnect the wrong ones, then re-run.';
  else
    execute 'create unique index if not exists accounting_integrations_active_external_uidx on public.accounting_integrations (provider, external_tenant_id) where active = true and external_tenant_id is not null';
  end if;
end;
$$;

-- Verify: expect the index row (unless the NOTICE above said it was skipped),
-- and zero rows from the duplicate check.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'accounting_integrations'
  and indexname = 'accounting_integrations_active_external_uidx';

select provider, external_tenant_id, count(*) as active_tenants
from public.accounting_integrations
where active = true
  and external_tenant_id is not null
group by provider, external_tenant_id
having count(*) > 1;
