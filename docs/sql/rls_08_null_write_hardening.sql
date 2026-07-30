-- RLS Tenancy Hardening -- 08: close the null / super_admin write footgun. Safe to re-run.
-- (a) Helpers reject a null target for EVERY role incl super, so a null tenant_id can never
--     pass WITH CHECK nor be read back.
create or replace function public.can_access_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select target_tenant is not null and (
    public.get_my_role() = 'super_admin'
    or target_tenant = public.current_tenant_id()
    or (public.get_my_role() = 'admin'
        and target_tenant in (select t.id from public.tenants t
                              where t.company_id = public.get_my_company_id())));
$$;

create or replace function public.can_manage_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select target_tenant is not null and (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and target_tenant in (select t.id from public.tenants t
                              where t.company_id = public.get_my_company_id())));
$$;

-- (b) Belt: make drivers match every other converted table.
--     Backfill check FIRST; if it returns > 0, fix those rows before the ALTER.
--   select count(*) from public.drivers where tenant_id is null;
alter table public.drivers alter column tenant_id set not null;
