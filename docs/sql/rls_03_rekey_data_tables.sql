-- RLS Tenancy Hardening (Phase 1) -- 03: re-key every tenant_id table. Safe to re-run.
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
    'vehicles'  -- handled in 04b: admin roster + staff status-only carve-out
  ];
  writes_closed text[] := array[
    'audit_logs','integration_connections','accounting_exports','billing',
    'subscriptions','rate_cards','vehicle_subscription_usage',
    'telematics_devices','telematics_events','telematics_fuel','telematics_positions',
    'telematics_trips','gps_events','vehicle_locations',
    'tachograph_downloads','tachograph_infringements','driver_activity_logs',
    'driver_daily_summary','driver_wtd_weeks'
  ];
  admin_write text[] := array['drivers'];
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
    'ai_signals','paper_trade_logs','portfolio_history','vehicles')
  and policyname not in ('tenant_access','tenant_read','admin_all');
