-- RLS Tenancy Hardening (Phase 1) -- 03: re-key every tenant_id table.
--
-- APPLIED ONCE on 2026-07-28. DO NOT RE-RUN. (The original header said "Safe to re-run"; that
-- stopped being true as soon as later migrations added tables. Review finding SQL-11, 2026-09-14.)
--
-- WHY: the loop below is not a frozen list. It visits EVERY public table that has a tenant_id
-- column TODAY and is not in `excluded`, drops EVERY policy on it, and installs a generic one.
-- Tables created after 2026-07-28 carry deliberately different policies that a re-run would
-- silently replace with `tenant_access FOR ALL using can_access_tenant(tenant_id)`, including:
--   period_invoice_lines, billing tables       admin-only reads      -> staff would read them
--   accounting_oauth_credentials               deliberately no policy -> an ALL policy, protected
--                                                                        only by a grant revoke
--   planning_route_*, driver_transport_*,      select-only for clients -> write policies appear,
--   tachograph_sync_runs, load_*, job_items,                               one GRANT away from use
--   job_item_scans, driver_users, vehicle_licences
--   and anything prodfix_85 / prodfix_91 installed.
-- To re-key a single table, copy the one relevant `create policy` for that table by hand.
--
-- Original description:
-- For each table with a tenant_id column (minus the excluded set): drop EVERY existing
-- policy (not just by name), then create one policy. writes_closed = read-only (system
-- owns the writes); admin_write = staff-read / admin-write; everything else = read+write.

do $$
declare
  t   record;
  pol record;
  excluded text[] := array[
    'profiles','company_profiles','companies','tenants','roles',
    'user_permissions','memberships','registration_requests','asset_types','users',
    'ai_signals','paper_trade_logs','portfolio_history',
    'vehicles',  -- handled in 04b: admin roster + staff status-only carve-out
    'integration_connections'  -- service-role only (OAuth tokens); locked in rls_06
  ];
  writes_closed text[] := array[
    'audit_logs','accounting_exports','billing',
    'rate_cards','vehicle_subscription_usage',
    'telematics_events','telematics_fuel','telematics_positions',
    'telematics_trips','gps_events','vehicle_locations',
    'tachograph_downloads','tachograph_infringements','driver_activity_logs',
    'driver_daily_summary','driver_wtd_weeks'
  ];
  admin_write text[] := array['drivers','driver_work_rules'];
  -- Admin read only (system-owned identifiers, e.g. Stripe ids, IMEI/SIM): staff cannot read.
  admin_read text[] := array['subscriptions','telematics_devices'];
begin
  for t in
    select c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname <> all(excluded)
      and exists (
        select 1 from information_schema.columns col
        where col.table_schema = 'public' and col.table_name = c.relname
          and col.column_name = 'tenant_id'
      )
  loop
    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t.table_name
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t.table_name);
    end loop;

    if t.table_name = any(writes_closed) then
      execute format(
        'create policy tenant_read on public.%I for select to authenticated '
        'using (public.can_access_tenant(tenant_id))', t.table_name);
    elsif t.table_name = any(admin_write) then
      execute format(
        'create policy tenant_read on public.%I for select to authenticated '
        'using (public.can_access_tenant(tenant_id))', t.table_name);
      execute format(
        'create policy admin_all on public.%I for all to authenticated '
        'using (public.can_manage_tenant(tenant_id)) '
        'with check (public.can_manage_tenant(tenant_id))', t.table_name);
    elsif t.table_name = any(admin_read) then
      execute format(
        'create policy admin_read on public.%I for select to authenticated '
        'using (public.can_manage_tenant(tenant_id))', t.table_name);
    else
      execute format(
        'create policy tenant_access on public.%I for all to authenticated '
        'using (public.can_access_tenant(tenant_id)) '
        'with check (public.can_access_tenant(tenant_id))', t.table_name);
    end if;
    raise notice 're-keyed % (%).', t.table_name,
      case
        when t.table_name = any(writes_closed) then 'read-only'
        when t.table_name = any(admin_write) then 'staff-read / admin-write'
        when t.table_name = any(admin_read) then 'admin-read'
        else 'read+write'
      end;
  end loop;
end $$;

-- HARD assertion: no unexpected policy survived on any re-keyed table (expect 0 rows).
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in (
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id')
  and tablename not in (
    'profiles','company_profiles','companies','tenants','roles',
    'user_permissions','memberships','registration_requests','asset_types','users',
    'ai_signals','paper_trade_logs','portfolio_history','vehicles','integration_connections')
  and policyname not in ('tenant_access','tenant_read','admin_all','admin_read');
