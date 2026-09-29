-- shifts_verify: read-only checks for shifts_01..05. Changes nothing.

-- 1. RLS on, expect nine rows all true.
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('driver_shifts','shift_breaks','walkaround_checks','shift_vehicle_periods','walkaround_defects',
                  'defect_objections','shift_corrections','defect_catalogue_items','walkaround_settings')
order by 1;

-- 2. Client roles hold SELECT only. Expect zero rows.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in ('driver_shifts','shift_breaks','walkaround_checks','shift_vehicle_periods','walkaround_defects',
                     'defect_objections','shift_corrections','defect_catalogue_items','walkaround_settings')
  and not (grantee = 'authenticated' and privilege_type = 'SELECT');

-- 3. Baseline seeded. Expect 38 total, 24 dangerous.
select count(*) as baseline, count(*) filter (where severity = 'dangerous') as dangerous
from public.defect_catalogue_items where company_id is null;

-- 4. Triggers installed. Expect four rows (gate_vehicle_licensed only if prodfix_30 is applied).
select c.relname, t.tgname
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and (t.tgname in ('guard_defect_catalogue', 'guard_vehicle_return_to_service', 'rectify_walkaround_defect')
       or (t.tgname = 'gate_vehicle_licensed' and c.relname = 'shift_vehicle_periods'))
order by 1;

-- 5. RPCs executable by service_role only. Expect only service_role rows.
select p.proname, r.rolname
from pg_proc p cross join pg_roles r
where p.proname in ('walkaround_insert_defects','walkaround_submit_check','shift_record_event',
                    'shift_apply_correction','shift_office_start')
  and r.rolname in ('anon', 'authenticated', 'service_role')
  and has_function_privilege(r.oid, p.oid, 'execute')
order by 1, 2;

-- 6. Photo bucket private. Expect one row, public = false.
select id, public from storage.buckets where id = 'walkaround-photos';
