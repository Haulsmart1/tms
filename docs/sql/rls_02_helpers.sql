-- RLS Tenancy Hardening (Phase 1) -- 02: helper functions. Safe to re-run.
-- All SECURITY DEFINER so they read profiles/tenants without tripping RLS.
--
-- NOTE: we deliberately do NOT create get_my_tenant_id(). The database already has
-- public.current_tenant_id() = (select tenant_id from profiles where id = auth.uid()),
-- which is identical, so we reuse it. get_my_company_id(), get_my_role() and
-- is_super_admin() also already exist.

-- Read/isolation across all three levels: super_admin, own tenant, or admin over
-- a tenant in their company.
create or replace function public.can_access_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    public.get_my_role() = 'super_admin'
    or target_tenant = public.current_tenant_id()
    or (public.get_my_role() = 'admin'
        and target_tenant in (
          select t.id from public.tenants t where t.company_id = public.get_my_company_id()
        ));
$$;

-- Admin-or-super write only (NO own-tenant branch). Drives admin-only writes.
create or replace function public.can_manage_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and target_tenant in (
          select t.id from public.tenants t where t.company_id = public.get_my_company_id()
        ));
$$;
