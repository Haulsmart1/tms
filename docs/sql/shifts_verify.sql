-- shifts_verify: read-only checks for shifts_01..05. Changes nothing.

-- 1. RLS on, expect nine rows all true.
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('driver_shifts','shift_breaks','walkaround_checks','shift_vehicle_periods','walkaround_defects',
                  'defect_objections','shift_corrections','defect_catalogue_items','walkaround_settings')
order by 1;

-- 2. Client roles hold SELECT only (authenticated) or nothing (anon). Expect zero rows.
-- has_table_privilege, not role_table_grants: it also counts grants made to
-- PUBLIC and inherited through role membership, which a grantee filter misses.
select t.tbl, r.role, pr.priv
from unnest(array['driver_shifts','shift_breaks','walkaround_checks','shift_vehicle_periods','walkaround_defects',
                  'defect_objections','shift_corrections','defect_catalogue_items','walkaround_settings']) as t(tbl)
cross join unnest(array['anon', 'authenticated']) as r(role)
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as pr(priv)
where has_table_privilege(r.role, 'public.' || t.tbl, pr.priv)
  and not (r.role = 'authenticated' and pr.priv = 'SELECT')
order by 1, 2, 3;

-- 3. Baseline seeded. Expect 38 total, 24 dangerous.
select count(*) as baseline, count(*) filter (where severity = 'dangerous') as dangerous
from public.defect_catalogue_items where company_id is null;

-- 4. Triggers installed. Expect five rows (gate_vehicle_licensed only if prodfix_30 is applied).
select c.relname, t.tgname
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and (t.tgname in ('guard_defect_catalogue', 'guard_vehicle_return_to_service', 'rectify_walkaround_defect',
                    'guard_vehicle_qr_token_hash')
       or (t.tgname = 'gate_vehicle_licensed' and c.relname = 'shift_vehicle_periods'))
order by 1;

-- 5. RPCs executable by service_role only. Expect only service_role rows.
select p.proname, r.rolname
from pg_proc p cross join pg_roles r
where p.proname in ('walkaround_insert_defects','walkaround_assert_result','shift_flags_add',
                    'walkaround_submit_check','shift_record_event','shift_apply_correction','shift_office_start')
  and r.rolname in ('anon', 'authenticated', 'service_role')
  and has_function_privilege(r.oid, p.oid, 'execute')
order by 1, 2;

-- 6. Photo bucket private. Expect one row, public = false.
select id, public from storage.buckets where id = 'walkaround-photos';

-- 7. Photo bucket blocked for every client role. Expect exactly four rows, all
-- RESTRICTIVE, roles {public}: select, insert, update, delete.
select policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'walkaround_photos_block_%'
order by policyname;

-- 8. PERMISSIVE storage policies that are not scoped by bucket. Expect zero
-- rows. Such a policy opens EVERY bucket, including any added later; the
-- restrictive policies in shifts_05 and prodfix_83 still hold for their own
-- buckets, but a new bucket would be born open.
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and permissive = 'PERMISSIVE'
  and coalesce(qual, '') not like '%bucket_id%'
  and coalesce(with_check, '') not like '%bucket_id%'
order by policyname;

-- 9. The QR hash guard is invoker-rights (a SECURITY DEFINER guard would
-- enforce nothing). Expect one row, prosecdef = false.
select proname, prosecdef from pg_proc where proname = 'guard_vehicle_qr_token_hash';
