-- RLS Tenancy Hardening -- 07: get_tenant_context() resolution RPC. Safe to re-run.
-- One trusted call the client uses to resolve role + accessible tenants. tenants is already
-- readable via the scoped tenants_select policy (rls_04); this RPC adds integrity-checking,
-- role normalization, and a single round-trip.
create or replace function public.get_tenant_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_company uuid; v_home uuid; v_tenants jsonb;
begin
  if v_uid is null then return jsonb_build_object('status','signed-out'); end if;
  v_role := public.get_my_role();
  v_company := public.get_my_company_id();
  v_home := public.current_tenant_id();

  -- integrity: a non-super must have a home tenant that belongs to their company
  if coalesce(v_role,'') <> 'super_admin'
     and (v_home is null
          or not exists (select 1 from public.tenants t
                         where t.id = v_home and t.company_id = v_company)) then
    return jsonb_build_object('status','no-tenant');
  end if;

  if v_role = 'super_admin' then
    select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name)
      into v_tenants from public.tenants t;
  elsif v_role = 'admin' then
    select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name)
      into v_tenants from public.tenants t where t.company_id = v_company;
  else
    select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name))
      into v_tenants from public.tenants t where t.id = v_home;
  end if;

  return jsonb_build_object('status','ready',
    'role', case when v_role = 'super_admin' then 'super_admin'
                 when v_role = 'admin' then 'admin' else 'staff' end,
    'company_id', v_company, 'home_tenant_id', v_home, 'tenants', coalesce(v_tenants,'[]'::jsonb));
end $$;

revoke all on function public.get_tenant_context() from public;
grant execute on function public.get_tenant_context() to authenticated;
