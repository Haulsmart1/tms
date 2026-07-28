-- RLS Tenancy Hardening (Phase 1) -- 09: verification harness. Each block rolls back.
-- Run after 01..05 (and the reseed). Any deviation from the expected result blocks sign-off.

-- 1. Anon sees nothing.
begin; set local role anon;
  select 'anon_jobs' as probe, count(*) from public.jobs;                          -- expect 0
rollback;

-- 2. Tenant user: own tenant only.
begin; set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  select 'own_jobs' as probe, count(*) from public.jobs;                           -- expect > 0
  select 'foreign_jobs' as probe, count(*) from public.jobs
    where tenant_id <> '2f7cc0dc-b7fd-4556-92be-445e4b42ddcd';                      -- expect 0
rollback;

-- 3. Super admin: everything.
begin; set local role authenticated;
  set local request.jwt.claims to '{"sub":"362aa5fd-0ae8-47e3-8a01-f005d246f476","role":"authenticated"}';
  select 'superadmin_jobs' as probe, count(*) from public.jobs;                    -- expect all
rollback;

-- 4. Escalation blocked on UPDATE.
begin; set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  update public.profiles set role_id = (select id from public.roles where name='super_admin')
    where id = '005e1811-8165-4213-b92b-4fbaed5591d2';                             -- expect ERROR
rollback;

-- 5. Escalation blocked on INSERT.
begin; set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  insert into public.profiles (id, role_id)
    values ('11111111-1111-1111-1111-111111111111', (select id from public.roles where name='super_admin')); -- expect ERROR
rollback;

-- 6. System table is read-only for staff.
begin; set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  insert into public.audit_logs (tenant_id) values ('2f7cc0dc-b7fd-4556-92be-445e4b42ddcd'); -- expect ERROR/denied
rollback;

-- 6b. Roster is admin-only: a null-role staff DELETE of a vehicle is denied.
begin; set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  with x as (delete from public.vehicles where tenant_id='2f7cc0dc-b7fd-4556-92be-445e4b42ddcd' returning 1)
  select 'staff_vehicle_deletes' as probe, count(*) from x;                        -- expect 0
rollback;

-- 7. No profiles INSERT/DELETE policy for authenticated.
select 'profiles_write_policies' as probe, count(*)
from pg_policies where schemaname='public' and tablename='profiles' and cmd in ('INSERT','DELETE'); -- expect 0

-- 8. Fleet is admin-write: null-role staff cannot DELETE drivers.
begin; set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  with d as (delete from public.drivers where tenant_id='2f7cc0dc-b7fd-4556-92be-445e4b42ddcd' returning 1)
  select 'staff_driver_deletes' as probe, count(*) from d;                         -- expect 0
rollback;

-- 9. Company settings are admin-only: a null-role staff update is denied.
begin; set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  with u as (update public.company_profiles set company_name = company_name
             where tenant_id = (select company_id from public.profiles where id = auth.uid()) returning 1)
  select 'staff_company_update' as probe, count(*) from u;                         -- expect 0
rollback;

-- 10. Vehicles: confirm a vehicle exists so a 0 below cannot be misread as "no row".
select 'vehicles_present' as probe, count(*) from public.vehicles
  where tenant_id = '2f7cc0dc-b7fd-4556-92be-445e4b42ddcd';                        -- expect > 0 (seed if needed)

-- 10a. Allowed: a null-role staff user flips active (a REAL change).
begin; set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  with s as (update public.vehicles set active = not active
             where tenant_id='2f7cc0dc-b7fd-4556-92be-445e4b42ddcd' returning 1)
  select 'staff_toggle_active' as probe, count(*) from s;                          -- expect > 0
rollback;

-- 10b. Blocked: staff changes a structural column (replace `registration` with any
--      real non-status column). Exercises the guard's reject path.
begin; set local role authenticated;
  set local request.jwt.claims to '{"sub":"005e1811-8165-4213-b92b-4fbaed5591d2","role":"authenticated"}';
  update public.vehicles set registration = registration || '-X'
    where tenant_id='2f7cc0dc-b7fd-4556-92be-445e4b42ddcd';                        -- expect ERROR
rollback;
