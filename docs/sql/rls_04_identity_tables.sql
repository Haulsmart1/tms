-- RLS Tenancy Hardening (Phase 1) -- 04: identity / company tables. Safe to re-run.
-- Each stack is enumerated, dropped, and replaced with one clear policy per command.

do $$
declare pol record; tbl text;
  tables text[] := array['profiles','company_profiles','companies','tenants'];
begin
  foreach tbl in array tables loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=tbl loop
      execute format('drop policy %I on public.%I', pol.policyname, tbl);
    end loop;
  end loop;
end $$;

-- profiles: read self / own-company (admin) / all (super). Update self or super only
-- (the guard trigger blocks privileged-column changes). No INSERT/DELETE policy:
-- provisioning is service-role only.
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.get_my_role() = 'super_admin'
  or (public.get_my_role() = 'admin' and company_id = public.get_my_company_id())
);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.get_my_role() = 'super_admin')
  with check (id = auth.uid() or public.get_my_role() = 'super_admin');

-- company_profiles: tenant_id holds the COMPANY id. Read own company / super.
-- Insert+update by that company's admin or super (settings page upserts). No delete.
create policy company_profiles_select on public.company_profiles for select to authenticated using (
  tenant_id = public.get_my_company_id() or public.get_my_role() = 'super_admin'
);
create policy company_profiles_insert on public.company_profiles for insert to authenticated
  with check (public.get_my_role() = 'super_admin'
              or (public.get_my_role() = 'admin' and tenant_id = public.get_my_company_id()));
create policy company_profiles_update on public.company_profiles for update to authenticated
  using (public.get_my_role() = 'super_admin'
         or (public.get_my_role() = 'admin' and tenant_id = public.get_my_company_id()))
  with check (public.get_my_role() = 'super_admin'
              or (public.get_my_role() = 'admin' and tenant_id = public.get_my_company_id()));

-- companies: read own / super. No write policy (service role provisions).
create policy companies_select on public.companies for select to authenticated using (
  id = public.get_my_company_id() or public.get_my_role() = 'super_admin'
);

-- tenants: read own tenant / admin over its company / super. NO write policy; tenants is
-- the root of trust for can_access_tenant, so writes are service-role only.
create policy tenants_select on public.tenants for select to authenticated using (
  id = public.get_my_tenant_id()
  or public.get_my_role() = 'super_admin'
  or (public.get_my_role() = 'admin' and company_id = public.get_my_company_id())
);

-- HARD assertion: no unexpected policy on the identity tables (expect 0 rows).
select tablename, policyname from pg_policies
where schemaname='public'
  and tablename in ('profiles','company_profiles','companies','tenants')
  and policyname not in (
    'profiles_select','profiles_update_self',
    'company_profiles_select','company_profiles_insert','company_profiles_update',
    'companies_select','tenants_select');
