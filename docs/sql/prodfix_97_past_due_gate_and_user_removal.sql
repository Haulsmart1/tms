-- prodfix_97: past-due work gate (review H-3) and a working remove_company_user (2026-10-08).
--
-- STEP 1  H-3. LIC02 refused new work only for a CANCELLED company, so a company whose card kept
--         failing (company_billing.status = 'past_due') kept assigning vehicles indefinitely.
--         The recorded suspension direction (2026-09-14) is a 7-day grace after past_due. This step
--         adds company_billing.past_due_since, kept by a trigger, and a LIC03 branch in the prodfix_30
--         gate: once a company has been past_due for more than 7 days, no vehicle can be newly put
--         to work. Existing assignments are grandfathered exactly like LIC01 and LIC02. This is the
--         narrow first step of the suspension design, not the full read-only mode.
--         The app maps LIC03 in lib/billing/unlicensedVehicle.ts; the message text is a contract.
-- STEP 2  remove_company_user set profiles.tenant_id to null, which the NOT NULL refuses (23502), so
--         removing a user always failed. Keeping a profile pinned to the tenant is not an option: it
--         would leave the removed user a tenant member under can_access_tenant. The profile row is
--         deleted instead. If other rows still reference it (tachograph, daily summaries, assets),
--         the removal is refused with errcode PRF01 and the token profile_still_referenced, which
--         lib/tenant/userAdmin.ts turns into a sentence.
--
-- STEP 3  M-4. subcontractors, subcontractor_employees and subcontractor_vehicles were written
--         from the browser (app/subcontractors/page.tsx), so each kept a FOR ALL policy and full
--         client DML, open to every tenant member including drivers. The page now writes through
--         app/api/subcontractors/** (service role, office or admin only, column allowlists), and
--         lib/subcontractors/browserWrites.test.ts fails if a browser write comes back. Client
--         DML is revoked and each FOR ALL policy becomes SELECT-only with the same predicate.
--         Apply this together with, or after, the code that adds those routes: before it, the
--         page's direct writes fail.
--
-- Idempotent. Apply after prodfix_96. Read-only VERIFY at the end.

begin;

-- STEP 0: preconditions
do $$
begin
  if to_regclass('public.company_billing') is null then
    raise exception 'prodfix_97: company_billing not found. Nothing changed.';
  end if;
  if to_regprocedure('public.guard_vehicle_assignment_licensed()') is null then
    raise exception 'prodfix_97: prodfix_30 is not applied. Nothing changed.';
  end if;
  if to_regprocedure('public.remove_company_user(uuid, uuid, boolean)') is null then
    raise exception 'prodfix_97: prodfix_20 remove_company_user not found. Nothing changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- STEP 1a: past_due_since
-- ---------------------------------------------------------------------------------------------
alter table public.company_billing add column if not exists past_due_since timestamptz;

update public.company_billing
   set past_due_since = coalesce(updated_at, now())
 where status = 'past_due' and past_due_since is null;

create or replace function public.stamp_company_billing_past_due_since()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'past_due' then
    if tg_op = 'INSERT' or old.status is distinct from 'past_due' then
      new.past_due_since := now();
    else
      new.past_due_since := coalesce(old.past_due_since, now());
    end if;
  else
    new.past_due_since := null;
  end if;
  return new;
end $$;

revoke all on function public.stamp_company_billing_past_due_since() from public, anon, authenticated;

drop trigger if exists stamp_past_due_since on public.company_billing;
create trigger stamp_past_due_since before insert or update on public.company_billing
  for each row execute function public.stamp_company_billing_past_due_since();

-- ---------------------------------------------------------------------------------------------
-- STEP 1b: the prodfix_30 gate with a LIC03 branch. Body copied from the live function
-- (2026-10-08); the only changes are the LIC03 block and search_path gaining pg_temp.
-- ---------------------------------------------------------------------------------------------
create or replace function public.guard_vehicle_assignment_licensed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_column text := tg_argv[0];
  v_new text;
  v_old text;
  v_vehicle uuid;
  v_registration text;
  v_grace_days constant integer := 7;
begin
  if v_column is null then
    raise exception 'guard_vehicle_assignment_licensed needs the vehicle column name as its argument';
  end if;

  v_new := to_jsonb(new) ->> v_column;

  -- Unassigning, or a row with no vehicle, is always allowed.
  if v_new is null or v_new = '' then
    return new;
  end if;

  -- Grandfathered: an update that leaves the vehicle unchanged is not a new
  -- assignment, whatever else it changes.
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) ->> v_column;
    if v_old is not distinct from v_new then
      return new;
    end if;
  end if;

  v_vehicle := v_new::uuid;

  select nullif(btrim(v.registration), '') into v_registration
  from public.vehicles v where v.id = v_vehicle;

  -- A CANCELLED company cannot put vehicles to new work, licensed or not.
  -- Cancelling sets company_billing.status = 'canceled' and stops the charges,
  -- but leaves every licence active, so without this a cancelled company kept
  -- running its whole fleet for GBP 0 (2026-09-15 follow-up). The vehicle
  -- reaches its company through its tenant; some legacy rows carry a company
  -- id in vehicles.tenant_id directly, so both are checked. A company with no
  -- company_billing row has never subscribed and is governed by LIC01 alone.
  if exists (
    select 1
    from public.vehicles v
    left join public.tenants t on t.id = v.tenant_id
    join public.company_billing cb on cb.company_id = coalesce(t.company_id, v.tenant_id)
    where v.id = v_vehicle and cb.status = 'canceled'
  ) then
    raise exception 'Vehicle % cannot be assigned to new work because this company''s subscription is cancelled.',
        coalesce(v_registration, v_vehicle::text)
      using errcode = 'LIC02',
            hint = 'company_billing_cancelled',
            detail = format('vehicle_id=%s table=%s', v_vehicle, tg_table_name);
  end if;

  -- prodfix_97 (H-3): a company past_due for longer than the grace period cannot
  -- put vehicles to new work either. Same company resolution as LIC02.
  if exists (
    select 1
    from public.vehicles v
    left join public.tenants t on t.id = v.tenant_id
    join public.company_billing cb on cb.company_id = coalesce(t.company_id, v.tenant_id)
    where v.id = v_vehicle
      and cb.status = 'past_due'
      and cb.past_due_since is not null
      and cb.past_due_since < now() - make_interval(days => v_grace_days)
  ) then
    raise exception 'Vehicle % cannot be assigned to new work because this company''s payment is more than % days overdue. Update the card on the Billing page.',
        coalesce(v_registration, v_vehicle::text), v_grace_days
      using errcode = 'LIC03',
            hint = 'company_billing_past_due',
            detail = format('vehicle_id=%s table=%s', v_vehicle, tg_table_name);
  end if;

  -- ANY active licence makes the vehicle usable (lib/billing/vehicleCount.ts).
  if exists (
    select 1 from public.vehicle_licences vl
    where vl.vehicle_id = v_vehicle and vl.active is true
  ) then
    return new;
  end if;

  raise exception 'Vehicle % has no active licence. Activate it on the Licences page before assigning it.',
      coalesce(v_registration, v_vehicle::text)
    using errcode = 'LIC01',
          hint = 'vehicle_unlicensed',
          detail = format('vehicle_id=%s table=%s', v_vehicle, tg_table_name);
end $function$;

revoke all on function public.guard_vehicle_assignment_licensed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- STEP 2: remove_company_user deletes the profile instead of nulling NOT NULL columns.
-- Same signature, grants and checks as the live prodfix_20 version.
-- ---------------------------------------------------------------------------------------------
create or replace function public.remove_company_user(p_user_id uuid, p_company_id uuid, p_caller_is_super boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_current text;
begin
  v_current := public.prodfix_lock_company_profile(p_user_id, p_company_id, p_caller_is_super);
  if v_current = 'admin' then
    perform public.prodfix_assert_not_last_admin(p_user_id, p_company_id);
  end if;

  delete from public.memberships m
   where m.user_id = p_user_id
     and m.tenant_id in (select t.id from public.tenants t where t.company_id = p_company_id);
  update public.driver_users d set active = false
   where d.user_id = p_user_id
     and d.tenant_id in (select t.id from public.tenants t where t.company_id = p_company_id);
  update public.subcontractor_users s set active = false
   where s.user_id = p_user_id
     and s.tenant_id in (select t.id from public.tenants t where t.company_id = p_company_id);

  begin
    delete from public.profiles where id = p_user_id;
  exception when foreign_key_violation then
    -- A token, like every other prodfix_20 refusal; lib/tenant/userAdmin.ts maps it to the sentence.
    raise exception 'profile_still_referenced' using errcode = 'PRF01';
  end;
end $function$;

-- The live grants are kept by create or replace; restate the intended ones.
revoke all on function public.remove_company_user(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.remove_company_user(uuid, uuid, boolean) to service_role;


-- ---------------------------------------------------------------------------------------------
-- STEP 3: M-4. Subcontractor tables become read-only from the browser.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  r record;
  v_pred text;
begin
  for r in
    select * from (values
      ('subcontractors', 'tenant_access', 'can_access_tenant(tenant_id)'),
      ('subcontractor_employees', 'subcontractor_employees_tenant_access', '(tenant_id = auth_tenant_id())'),
      ('subcontractor_vehicles', 'subcontractor_vehicles_tenant_access', '(tenant_id = auth_tenant_id())')
    ) as t(table_name, old_policy, predicate)
  loop
    if to_regclass('public.' || r.table_name) is null then
      raise notice 'prodfix_97: public.% not found, skipped', r.table_name;
      continue;
    end if;

    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated, public', r.table_name);
    execute format('grant select on public.%I to authenticated', r.table_name);
    execute format('grant all on public.%I to service_role', r.table_name);

    -- Keep the live predicate if the old policy is still there, else the documented one.
    select coalesce(p.qual, r.predicate) into v_pred
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = r.table_name and p.policyname = r.old_policy;
    v_pred := coalesce(v_pred, r.predicate);

    execute format('drop policy if exists %I on public.%I', r.old_policy, r.table_name);
    execute format('drop policy if exists tenant_read on public.%I', r.table_name);
    execute format('create policy tenant_read on public.%I for select to authenticated using (%s)', r.table_name, v_pred);
    raise notice 'prodfix_97: public.% is now read-only from the browser (select using %)', r.table_name, v_pred;
  end loop;
end $$;

commit;

-- =============================================================================================
-- VERIFY (read-only)
-- =============================================================================================

-- VERIFY 1: expect one row, the trigger on company_billing.
select tgname from pg_trigger where tgrelid = 'public.company_billing'::regclass and tgname = 'stamp_past_due_since';

-- VERIFY 2: expect true (the LIC03 branch is live) and a search_path with pg_temp.
select pg_get_functiondef('public.guard_vehicle_assignment_licensed()'::regprocedure) like '%LIC03%' as has_lic03,
       (select array_to_string(proconfig, ';') from pg_proc where oid = 'public.guard_vehicle_assignment_licensed()'::regprocedure) as config;

-- VERIFY 3: expect false, false, true.
select has_function_privilege('anon', 'public.remove_company_user(uuid, uuid, boolean)', 'execute') as anon_exec,
       has_function_privilege('authenticated', 'public.remove_company_user(uuid, uuid, boolean)', 'execute') as auth_exec,
       has_function_privilege('service_role', 'public.remove_company_user(uuid, uuid, boolean)', 'execute') as service_exec;

-- VERIFY 4: expect only SELECT for authenticated, and one tenant_read SELECT policy per table.
select table_name, string_agg(privilege_type, ',' order by privilege_type) as authenticated_grants
from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public'
  and table_name in ('subcontractors', 'subcontractor_employees', 'subcontractor_vehicles')
group by table_name;
select tablename, policyname, cmd, qual from pg_policies
where schemaname = 'public' and tablename in ('subcontractors', 'subcontractor_employees', 'subcontractor_vehicles');
