-- prodfix_32: switch one company from v1 to v2 billing in ONE transaction.
-- Apply manually in the Supabase SQL editor, like the rls_* and billing_*
-- series. Safe to re-run (create or replace; grants restated).
--
-- FINDING: BILL2-21 (2026-09-14 production-readiness review).
--
-- scripts/migrate-company-to-period-billing.mjs --apply used to make three
-- separate PostgREST writes: insert the first period, rewrite activated_at on
-- active licences, flip billing_model. A failure after the first left a v1
-- company holding an open future period (a re-run then refused on 23505 and
-- needed hand cleanup); a failure in the second left a partial activated_at
-- rewrite. It also never checked for pending v1 charges, which are orphaned
-- the moment the v1 cron starts skipping the company.
--
-- This function does all of it atomically, re-checks every eligibility rule
-- under a row lock, and refuses (raises) rather than half-applying. The script
-- calls it on --apply and refuses to fall back to the old writes when it is
-- missing.
--
-- DEPENDS ON billing_06 (billing_model, billing_periods) and billing_07 STEP 1
-- (activated_at, deactivated_at, grace_until). vehicle_addon_charges is from
-- billing_03; platform_charges has no 'pending' status today (billing_01), and
-- checking for one is harmless and future-proof.
--
-- THE SEAM is unchanged: the first v2 period starts at next_charge_on, the
-- date v1 has already been paid up to, and every active licence's
-- activated_at is moved to that date with grace_until null.
--
-- Invoker rights, service_role only. The service role already holds every
-- privilege this needs; definer rights would turn one careless grant into a
-- way for any signed-in user to re-bill a company.

begin;

create or replace function public.migrate_company_to_period_billing(
  p_company_id uuid,
  p_today date
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_billing record;
  v_seam date;
  v_period_id uuid;
  v_licences int;
  v_vehicles int;
begin
  if p_company_id is null or p_today is null then
    raise exception 'migrate_company_to_period_billing: company id and today are required';
  end if;

  select company_id, status, next_charge_on, retry_at, billing_model
    into v_billing
  from public.company_billing
  where company_id = p_company_id
  for update;

  if not found then
    raise exception 'Refusing to migrate %: no company_billing row', p_company_id;
  end if;
  if coalesce(v_billing.billing_model, 'v1_immediate') = 'v2_period' then
    raise exception 'Refusing to migrate %: already v2', p_company_id;
  end if;
  if v_billing.status <> 'active' then
    raise exception 'Refusing to migrate %: status %', p_company_id, v_billing.status;
  end if;
  if v_billing.retry_at is not null then
    raise exception 'Refusing to migrate %: mid-dunning (retry_at %)', p_company_id, v_billing.retry_at;
  end if;
  if v_billing.next_charge_on is null or v_billing.next_charge_on <= p_today then
    raise exception 'Refusing to migrate %: next_charge_on % is not after %',
      p_company_id, v_billing.next_charge_on, p_today;
  end if;

  if exists (select 1 from public.platform_charges
             where company_id = p_company_id and status = 'pending') then
    raise exception 'Refusing to migrate %: a pending v1 cycle charge exists; reconcile it against Square first', p_company_id;
  end if;
  if to_regclass('public.vehicle_addon_charges') is not null
     and exists (select 1 from public.vehicle_addon_charges
                 where company_id = p_company_id and status = 'pending') then
    raise exception 'Refusing to migrate %: a pending v1 add-on charge exists; reconcile it against Square first', p_company_id;
  end if;
  if exists (select 1 from public.billing_periods
             where company_id = p_company_id and status = 'open') then
    raise exception 'Refusing to migrate %: an open billing period already exists (part-migrated?)', p_company_id;
  end if;

  v_seam := v_billing.next_charge_on;

  -- 1. The period, before the flag.
  insert into public.billing_periods (company_id, period_start, period_end, status, prepaid_pence)
  values (p_company_id, v_seam, v_seam + 28, 'open', 0)
  returning id into v_period_id;

  -- 2. Move every active licence's clock to the seam. Vehicles reach the
  --    company through tenants.company_id, or carry the company id in
  --    tenant_id directly (pre-tenants rows). There is no vehicles.company_id.
  with company_vehicles as (
    select v.id
    from public.vehicles v
    where v.tenant_id = p_company_id
       or v.tenant_id in (select t.id from public.tenants t where t.company_id = p_company_id)
  ),
  reset as (
    update public.vehicle_licences vl
    set activated_at = (v_seam::timestamp at time zone 'UTC'),
        grace_until = null
    where vl.deactivated_at is null
      and vl.vehicle_id in (select id from company_vehicles)
    returning vl.vehicle_id
  )
  select count(*), count(distinct vehicle_id) into v_licences, v_vehicles from reset;

  -- 3. The flag, last. Inside one transaction the order no longer matters for
  --    atomicity, but it is kept so the statement order still reads as the
  --    safe order if this is ever split again.
  update public.company_billing
  set billing_model = 'v2_period', updated_at = now()
  where company_id = p_company_id;

  return jsonb_build_object(
    'company_id', p_company_id,
    'period_id', v_period_id,
    'seam', v_seam,
    'period_end', v_seam + 28,
    'licences_reset', v_licences,
    'distinct_vehicles', v_vehicles
  );
end $$;

revoke all on function public.migrate_company_to_period_billing(uuid, date) from public, anon, authenticated;
grant execute on function public.migrate_company_to_period_billing(uuid, date) to service_role;

commit;

-- VERIFY. service_role=X only, invoker rights, neither API role can execute.
--
--   select p.proname, p.prosecdef, p.proacl,
--          has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
--          has_function_privilege('anon', p.oid, 'execute') as anon_exec
--   from pg_proc p
--   where p.oid = 'public.migrate_company_to_period_billing(uuid, date)'::regprocedure;
--
-- Expect prosecdef false, auth_exec false, anon_exec false.
