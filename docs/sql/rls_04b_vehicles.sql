-- RLS Tenancy Hardening (Phase 1) -- 04b: vehicles (admin roster, staff status). Safe to re-run.
--
-- Admins manage the roster (insert/update/delete); staff may toggle operational status
-- (active = VOR/roadworthy) only, enforced by the column guard below.
--
-- PRE-APPLY CHECK -- STORED generated columns. In a BEFORE UPDATE trigger a generated
-- column reads NULL in NEW but its value in OLD, so the jsonb diff would look "changed"
-- on a plain status toggle and the guard would wrongly reject. Run this first:
--   select attname, attgenerated from pg_attribute
--   where attrelid='public.vehicles'::regclass and attnum>0 and not attisdropped and attgenerated='s';
-- Expect 0 rows. If any appear, add `- '<colname>'` for each to BOTH sides of the diff
-- below (next to `- 'active' - 'updated_at'`).

do $$ declare pol record; begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='vehicles' loop
    execute format('drop policy %I on public.vehicles', pol.policyname);
  end loop;
end $$;

create policy vehicles_read on public.vehicles for select to authenticated
  using (public.can_access_tenant(tenant_id));
create policy vehicles_admin_all on public.vehicles for all to authenticated
  using (public.can_manage_tenant(tenant_id))
  with check (public.can_manage_tenant(tenant_id));
create policy vehicles_staff_status on public.vehicles for update to authenticated
  using (public.can_access_tenant(tenant_id))
  with check (public.can_access_tenant(tenant_id));

create or replace function public.guard_vehicle_columns()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user in ('service_role','supabase_admin','postgres')
     or public.can_manage_tenant(new.tenant_id)
  then
    return new;  -- admin / super / service: unrestricted
  end if;
  if (to_jsonb(new) - 'active' - 'updated_at')
     is distinct from (to_jsonb(old) - 'active' - 'updated_at')
  then
    raise exception 'Staff may change only vehicle status (active), not the vehicle record'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_vehicle_columns on public.vehicles;
create trigger guard_vehicle_columns before update on public.vehicles
  for each row execute function public.guard_vehicle_columns();
