-- RLS Tenancy Hardening (Phase 1) -- 09: verification harness (self-reporting).
-- Run the WHOLE file. Each probe is a DO block that prints a NOTICE with PASS/FAIL and
-- never aborts the run (expected errors are caught; mutations are rolled back).
-- Read the results in the editor's "Messages"/notices output.
--
-- SET THREE TEST USER IDS BELOW, then run:
--   t.super = a super_admin profile id
--   t.admin = a company admin profile id (post-reseed, any company user)
--   t.staff = a NULL-ROLE staff profile id. After the reseed every real user is an admin,
--             so create one test staff profile first (run as postgres, the guard exempts it):
--
--     insert into public.profiles (id, tenant_id, company_id)
--     select gen_random_uuid(), t.id, t.company_id
--     from public.tenants t where t.company_id is not null order by t.created_at limit 1
--     returning id, tenant_id, company_id;   -- copy the id into t.staff below
--
-- The staff probes use current_tenant_id()/get_my_company_id() to target that user's own
-- tenant/company, so no tenant id needs pasting. Ensure a vehicle exists in that tenant for P10.

select set_config('t.super', '362aa5fd-0ae8-47e3-8a01-f005d246f476', false);
select set_config('t.admin', '005e1811-8165-4213-b92b-4fbaed5591d2', false);
select set_config('t.staff', '00000000-0000-0000-0000-000000000000', false);  -- <-- replace

-- P1: anon sees nothing.
do $$ declare n int; begin
  perform set_config('role','anon',true);
  select count(*) into n from public.jobs;
  raise notice 'P1 anon jobs = %  (PASS if 0)', n;
end $$;

-- P2: super_admin sees everything.
do $$ declare n int; begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.super',true), 'role','authenticated')::text, true);
  select count(*) into n from public.jobs;
  raise notice 'P2 super_admin jobs = %  (expect all jobs)', n;
end $$;

-- P3: escalation via UPDATE is blocked (run as an admin; only super_admin is exempt).
do $$ begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.admin',true), 'role','authenticated')::text, true);
  begin
    update public.profiles set role_id = (select id from public.roles where name='super_admin')
      where id = current_setting('t.admin',true)::uuid;
    raise notice 'P3 escalation UPDATE = FAIL (allowed!)';
    raise exception using errcode = 'ROLLB';
  exception
    when insufficient_privilege then raise notice 'P3 escalation UPDATE = PASS (blocked)';
    when sqlstate 'ROLLB' then null;
  end;
end $$;

-- P4: escalation via INSERT is blocked.
do $$ begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.admin',true), 'role','authenticated')::text, true);
  begin
    insert into public.profiles (id, tenant_id, role_id)
      values (gen_random_uuid(), public.current_tenant_id(), (select id from public.roles where name='super_admin'));
    raise notice 'P4 escalation INSERT = FAIL (allowed!)';
    raise exception using errcode = 'ROLLB';
  exception
    when insufficient_privilege then raise notice 'P4 escalation INSERT = PASS (blocked)';
    when sqlstate 'ROLLB' then null;
  end;
end $$;

-- P5: profiles has no INSERT/DELETE policy for authenticated (metadata).
do $$ declare n int; begin
  select count(*) into n from pg_policies
    where schemaname='public' and tablename='profiles' and cmd in ('INSERT','DELETE');
  raise notice 'P5 profiles INSERT/DELETE policies = %  (PASS if 0)', n;
end $$;

-- P6: a system-owned table (audit_logs) is read-only for staff.
do $$ begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.staff',true), 'role','authenticated')::text, true);
  begin
    insert into public.audit_logs (tenant_id) values (public.current_tenant_id());
    raise notice 'P6 staff audit_logs INSERT = FAIL (allowed!)';
    raise exception using errcode = 'ROLLB';
  exception
    when insufficient_privilege then raise notice 'P6 staff audit_logs INSERT = PASS (denied)';
    when sqlstate 'ROLLB' then null;
  end;
end $$;

-- P7: staff cannot DELETE a vehicle (roster is admin-only).
do $$ declare n int; begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.staff',true), 'role','authenticated')::text, true);
  begin
    delete from public.vehicles where tenant_id = public.current_tenant_id();
    get diagnostics n = row_count;
    raise notice 'P7 staff vehicle DELETE = % row(s)  (PASS if 0)', n;
    raise exception using errcode = 'ROLLB';
  exception when sqlstate 'ROLLB' then null;
  end;
end $$;

-- P8: staff cannot DELETE a driver (admin-only).
do $$ declare n int; begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.staff',true), 'role','authenticated')::text, true);
  begin
    delete from public.drivers where tenant_id = public.current_tenant_id();
    get diagnostics n = row_count;
    raise notice 'P8 staff driver DELETE = % row(s)  (PASS if 0)', n;
    raise exception using errcode = 'ROLLB';
  exception when sqlstate 'ROLLB' then null;
  end;
end $$;

-- P9: staff cannot UPDATE company settings (admin-only).
do $$ declare n int; begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.staff',true), 'role','authenticated')::text, true);
  begin
    update public.company_profiles set company_name = company_name
      where tenant_id = public.get_my_company_id();
    get diagnostics n = row_count;
    raise notice 'P9 staff company UPDATE = % row(s)  (PASS if 0)', n;
    raise exception using errcode = 'ROLLB';
  exception when sqlstate 'ROLLB' then null;
  end;
end $$;

-- P10: staff CAN toggle a vehicle's status (active). Needs a vehicle in their tenant.
do $$ declare n int; begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.staff',true), 'role','authenticated')::text, true);
  begin
    update public.vehicles set active = not active where tenant_id = public.current_tenant_id();
    get diagnostics n = row_count;
    raise notice 'P10 staff toggle active = % row(s)  (PASS if > 0, else seed a vehicle)', n;
    raise exception using errcode = 'ROLLB';
  exception when sqlstate 'ROLLB' then null;
  end;
end $$;

-- P11: staff CANNOT change a structural vehicle column (registration).
do $$ begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.staff',true), 'role','authenticated')::text, true);
  begin
    update public.vehicles set registration = registration || '-X' where tenant_id = public.current_tenant_id();
    raise notice 'P11 staff structural edit = FAIL (allowed!)';
    raise exception using errcode = 'ROLLB';
  exception
    when insufficient_privilege then raise notice 'P11 staff structural edit = PASS (blocked)';
    when sqlstate 'ROLLB' then null;
  end;
end $$;

-- P12: system secrets (integration_connections) not readable via the API, even by an admin.
do $$ declare n int; begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('t.admin',true), 'role','authenticated')::text, true);
  select count(*) into n from public.integration_connections;
  raise notice 'P12 admin integration_connections read = %  (PASS if 0)', n;
end $$;
