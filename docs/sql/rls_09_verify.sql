-- RLS Tenancy Hardening (Phase 1) -- 09: verification harness (returns a RESULT TABLE).
-- Supabase's SQL editor does not reliably surface RAISE NOTICE, so this version RETURNS the
-- results as rows you read in the results grid. Every probe is isolated; expected errors are
-- caught and mutations are rolled back, so nothing persists.
--
-- STEP 1 -- create a NULL-ROLE staff test profile (run as postgres; the guard exempts it):
--   insert into public.profiles (id, tenant_id, company_id)
--   select gen_random_uuid(), t.id, t.company_id
--   from public.tenants t where t.company_id is not null order by t.created_at limit 1
--   returning id, tenant_id;             -- copy the id; note the tenant
--   (Optional: seed a vehicle in that tenant so P10/P11 have something to act on.)
--
-- STEP 2 -- run the whole file, then read the table from the final SELECT.

create or replace function public.rls_verify(p_super uuid, p_admin uuid, p_staff uuid)
returns table(probe text, outcome text)
language plpgsql
as $fn$
declare n int;
begin
  -- P1: anon sees nothing.
  perform set_config('role','anon',true);
  perform set_config('request.jwt.claims','{}',true);
  select count(*) into n from public.jobs;
  probe := 'P1 anon jobs'; outcome := n || '  (PASS if 0)'; return next;

  -- P2: super_admin sees everything.
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p_super,'role','authenticated')::text, true);
  select count(*) into n from public.jobs;
  probe := 'P2 super_admin jobs'; outcome := n || '  (expect all jobs)'; return next;

  -- P3: escalation via UPDATE blocked (as admin; only super_admin is exempt).
  perform set_config('request.jwt.claims', json_build_object('sub',p_admin,'role','authenticated')::text, true);
  begin
    update public.profiles set role_id = (select id from public.roles where name='super_admin') where id = p_admin;
    outcome := 'FAIL (allowed!)'; raise exception using errcode='ROLLB';
  exception
    when insufficient_privilege then outcome := 'PASS (blocked)';
    when sqlstate 'ROLLB' then null;
    when others then outcome := 'ERROR '||sqlstate||': '||sqlerrm;
  end;
  probe := 'P3 escalation UPDATE'; return next;

  -- P4: escalation via INSERT blocked.
  begin
    insert into public.profiles (id, tenant_id, role_id)
      values (gen_random_uuid(), public.current_tenant_id(), (select id from public.roles where name='super_admin'));
    outcome := 'FAIL (allowed!)'; raise exception using errcode='ROLLB';
  exception
    when insufficient_privilege then outcome := 'PASS (blocked)';
    when sqlstate 'ROLLB' then null;
    when others then outcome := 'ERROR '||sqlstate||': '||sqlerrm;
  end;
  probe := 'P4 escalation INSERT'; return next;

  -- P5: profiles has no INSERT/DELETE policy for authenticated (metadata).
  select count(*) into n from pg_policies
    where schemaname='public' and tablename='profiles' and cmd in ('INSERT','DELETE');
  probe := 'P5 profiles write policies'; outcome := n || '  (PASS if 0)'; return next;

  -- P6: staff cannot INSERT a system-owned table (audit_logs).
  perform set_config('request.jwt.claims', json_build_object('sub',p_staff,'role','authenticated')::text, true);
  begin
    insert into public.audit_logs (tenant_id) values (public.current_tenant_id());
    outcome := 'FAIL (allowed!)'; raise exception using errcode='ROLLB';
  exception
    when insufficient_privilege then outcome := 'PASS (denied)';
    when sqlstate 'ROLLB' then null;
    when others then outcome := 'ERROR '||sqlstate||': '||sqlerrm;
  end;
  probe := 'P6 staff audit_logs INSERT'; return next;

  -- P7: staff cannot DELETE a vehicle (roster is admin-only).
  begin
    delete from public.vehicles where tenant_id = public.current_tenant_id();
    get diagnostics n = row_count; outcome := n || ' row(s)  (PASS if 0)';
    raise exception using errcode='ROLLB';
  exception when sqlstate 'ROLLB' then null; when others then outcome := 'ERROR '||sqlstate||': '||sqlerrm; end;
  probe := 'P7 staff vehicle DELETE'; return next;

  -- P8: staff cannot DELETE a driver (admin-only).
  begin
    delete from public.drivers where tenant_id = public.current_tenant_id();
    get diagnostics n = row_count; outcome := n || ' row(s)  (PASS if 0)';
    raise exception using errcode='ROLLB';
  exception when sqlstate 'ROLLB' then null; when others then outcome := 'ERROR '||sqlstate||': '||sqlerrm; end;
  probe := 'P8 staff driver DELETE'; return next;

  -- P9: staff cannot UPDATE company settings (admin-only).
  begin
    update public.company_profiles set company_name = company_name where tenant_id = public.get_my_company_id();
    get diagnostics n = row_count; outcome := n || ' row(s)  (PASS if 0)';
    raise exception using errcode='ROLLB';
  exception when sqlstate 'ROLLB' then null; when others then outcome := 'ERROR '||sqlstate||': '||sqlerrm; end;
  probe := 'P9 staff company UPDATE'; return next;

  -- P10: staff CAN toggle a vehicle's status (active).
  begin
    update public.vehicles set active = not active where tenant_id = public.current_tenant_id();
    get diagnostics n = row_count;
    outcome := n || ' row(s)  (PASS if > 0; else seed a vehicle in the staff tenant)';
    raise exception using errcode='ROLLB';
  exception when sqlstate 'ROLLB' then null; when others then outcome := 'ERROR '||sqlstate||': '||sqlerrm; end;
  probe := 'P10 staff toggle active'; return next;

  -- P11: staff CANNOT change a structural vehicle column (registration).
  begin
    update public.vehicles set registration = registration || '-X' where tenant_id = public.current_tenant_id();
    get diagnostics n = row_count;
    if n = 0 then outcome := 'INCONCLUSIVE (no vehicle in the staff tenant to test)';
    else outcome := 'FAIL (allowed!)'; end if;
    raise exception using errcode='ROLLB';
  exception
    when insufficient_privilege then outcome := 'PASS (blocked)';
    when sqlstate 'ROLLB' then null;
    when others then outcome := 'ERROR '||sqlstate||': '||sqlerrm;
  end;
  probe := 'P11 staff structural edit'; return next;

  -- P12: system secrets (integration_connections) unreadable via the API.
  perform set_config('request.jwt.claims', json_build_object('sub',p_admin,'role','authenticated')::text, true);
  begin
    select count(*) into n from public.integration_connections;
    outcome := n || ' row(s)  (PASS if 0)';
  exception
    when insufficient_privilege then outcome := 'PASS (denied: no SELECT grant)';
    when others then outcome := 'ERROR '||sqlstate||': '||sqlerrm;
  end;
  probe := 'P12 integration_connections read'; return next;

  return;
end;
$fn$;

-- RUN THIS (replace the staff id with the null-role profile you created in step 1):
select * from public.rls_verify(
  '362aa5fd-0ae8-47e3-8a01-f005d246f476'::uuid,   -- super_admin
  '005e1811-8165-4213-b92b-4fbaed5591d2'::uuid,   -- a company admin
  '362aa5fd-0ae8-47e3-8a01-f005d246f476'::uuid    -- staff  <-- REPLACE with your test staff id
);
