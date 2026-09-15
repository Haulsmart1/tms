-- prodfix_31: billing evidence survives vehicle and company deletes.
-- Apply manually in the Supabase SQL editor, like the rls_* and billing_*
-- series. Safe to re-run: every change inspects the catalogue first.
--
-- FINDINGS: SQL-5, SQL-12, SET-4, BILL2-12 (2026-09-14 production-readiness
-- review).
--
--   SQL-5 / BILL2-12  v2 bills at period close from licence rows it reaches
--                     through LIVE vehicle rows. A company admin could delete
--                     18 vehicles the day before close (rls_04b
--                     vehicles_admin_all is FOR ALL, so it includes DELETE)
--                     and pay the GBP 129 floor instead of the real invoice.
--   SET-4 / SQL-12    vehicle_cycle_coverage.vehicle_id and
--                     vehicle_addon_charges.vehicle_id were ON DELETE CASCADE,
--                     so deleting a vehicle erased paid add-on records,
--                     including 'pending' rows whose Square outcome is unknown
--                     (billing_05 says never delete one). Every companies(id)
--                     FK on the billing tables cascaded too, so a company
--                     delete wiped VAT and payment records.
--
-- WHAT THIS DOES.
--   1. public.vehicle_has_billing_evidence(uuid): the one SQL definition of
--      "this vehicle cannot be hard-deleted". Mirrors
--      lib/billing/vehicleDelete.ts: a licence that was ever active (active,
--      or deactivated_at null, or deactivated_at > activated_at), any
--      coverage row, any add-on charge row of any status, any invoice line.
--   2. A BEFORE DELETE trigger on public.vehicles that raises when evidence
--      exists, for EVERY role, service role included. The browser's direct
--      delete and any future server path hit the same wall.
--   3. public.delete_vehicle_if_no_billing_evidence(uuid) returns text, the
--      atomic delete DELETE /api/vehicles/[id] calls: lock the vehicle row,
--      check, delete never-active draft licences, delete the vehicle.
--   4. Foreign keys on billing evidence become ON DELETE RESTRICT, so even
--      with the trigger dropped the database refuses to destroy evidence.
--
-- APP CHANGE THIS PAIRS WITH. The settings agent is switching
-- app/vehicles/page.tsx from `supabase.from("vehicles").delete()` to
-- `DELETE /api/vehicles/[id]`. Once this file is applied, the old browser
-- delete ALSO fails for any vehicle with billing evidence (the trigger raises
-- P0001 with a readable message), so applying before the page change is
-- safe: it refuses, it does not lose data. Vehicles with no billing history
-- still delete from either path.
--
-- LIVE-STATE DEPENDENCY. The FK on vehicle_licences.vehicle_id is not in repo
-- SQL (it predates docs/sql), and the other FKs were created by inline
-- `references` clauses with generated names. Every constraint below is found
-- by catalogue (table, referenced table, column), never by name. Run
-- docs/sql/diag_2026_09_14_live_state.sql section 08_fk before and after to
-- see the change. Other operational tables that reference vehicles (jobs,
-- vehicle_assignments, load_manifests, ...) are deliberately NOT touched:
-- whatever they do today they keep doing, and the rpc reports a refusing FK
-- as 'referenced'. If any of them CASCADES from vehicles, deleting an
-- evidence-free vehicle still removes those rows exactly as today.
--
-- DEPENDS ON billing_03 (coverage, add-on charges) and billing_06 (periods,
-- lines, charges). Tables that do not exist are skipped with a notice, and
-- the evidence function only reads tables that exist at apply time; re-run
-- this file after applying a later billing migration.
--
-- CONSEQUENCE TO KNOW. A company row can no longer be deleted while billing
-- records exist for it. That is the intent: companies are archived, not
-- deleted, once they have been billed. A super admin who genuinely must
-- remove test data deletes the billing rows explicitly first, in the SQL
-- editor, knowing what they are removing.
--
-- ROLLBACK. Drop the trigger and the two functions; restoring CASCADE is a
-- deliberate choice to make evidence destroyable again and is not scripted
-- here. The drop statements:
--   drop trigger if exists guard_vehicle_billing_evidence on public.vehicles;
--   drop function if exists public.delete_vehicle_if_no_billing_evidence(uuid);
--   drop function if exists public.guard_vehicle_billing_evidence();
--   drop function if exists public.vehicle_has_billing_evidence(uuid);

begin;

-- ---------------------------------------------------------------- 1. evidence

-- Built dynamically so the function is correct in a database where a billing
-- table is not there yet, instead of failing at first call with 42P01.
-- SECURITY DEFINER is needed here, unlike the billing_03/07 guards: the check
-- must see coverage and charge rows the deleting browser role cannot read
-- (RLS on those tables is admin-only), or a staff-visible delete would be
-- judged on an empty view. It only returns a boolean, touches nothing, and
-- execute is revoked from every API role below; the trigger runs it as owner
-- regardless of the caller's execute rights.
do $$
declare
  v_body text := 'select false';
begin
  v_body := $q$
    select exists (
      select 1 from public.vehicle_licences vl
      where vl.vehicle_id = p_vehicle_id
        and (vl.active is true $q$;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'vehicle_licences'
               and column_name = 'deactivated_at')
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'vehicle_licences'
                   and column_name = 'activated_at') then
    v_body := v_body || $q$
             or vl.deactivated_at is null
             or vl.activated_at is null
             or vl.deactivated_at > vl.activated_at $q$;
  else
    -- billing_07 not applied: no lifecycle history, so every licence is
    -- evidence. Fails closed, matching isLicenceEverActive.
    v_body := v_body || $q$ or true $q$;
  end if;

  v_body := v_body || $q$ )) $q$;

  if to_regclass('public.vehicle_cycle_coverage') is not null then
    v_body := v_body || $q$
      or exists (select 1 from public.vehicle_cycle_coverage c where c.vehicle_id = p_vehicle_id) $q$;
  end if;
  if to_regclass('public.vehicle_addon_charges') is not null then
    v_body := v_body || $q$
      or exists (select 1 from public.vehicle_addon_charges a where a.vehicle_id = p_vehicle_id) $q$;
  end if;
  if to_regclass('public.period_invoice_lines') is not null then
    v_body := v_body || $q$
      or exists (select 1 from public.period_invoice_lines l where l.vehicle_id = p_vehicle_id) $q$;
  end if;

  execute format($f$
    create or replace function public.vehicle_has_billing_evidence(p_vehicle_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as %L
  $f$, v_body);
end $$;

revoke all on function public.vehicle_has_billing_evidence(uuid) from public, anon, authenticated;
grant execute on function public.vehicle_has_billing_evidence(uuid) to service_role;

-- ----------------------------------------------------------------- 2. trigger

-- No role exemption, deliberately. The evidence is what an invoice or a
-- payment record rests on, and no caller, the service role included, has a
-- legitimate reason to destroy it through a vehicle delete. A super admin
-- clearing test data removes the billing rows explicitly first.
create or replace function public.guard_vehicle_billing_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.vehicle_has_billing_evidence(old.id) then
    raise exception 'Vehicle % has billing history, so it cannot be deleted. Mark it inactive instead.',
      coalesce(old.registration, old.id::text)
      using errcode = 'P0001',
            hint = 'vehicle_has_billing_evidence';
  end if;
  return old;
end $$;

revoke all on function public.guard_vehicle_billing_evidence() from public, anon, authenticated;

drop trigger if exists guard_vehicle_billing_evidence on public.vehicles;
create trigger guard_vehicle_billing_evidence
  before delete on public.vehicles
  for each row execute function public.guard_vehicle_billing_evidence();

-- --------------------------------------------------------- 3. the atomic delete

-- Invoker rights: only the service role may execute it, and the service role
-- already holds delete on both tables. The row lock serialises against a
-- concurrent licence activation for this vehicle only as far as that
-- activation also touches the vehicle row; the trigger in step 2 re-checks at
-- delete time inside this same transaction, which is the actual guarantee.
create or replace function public.delete_vehicle_if_no_billing_evidence(p_vehicle_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_found uuid;
begin
  select id into v_found from public.vehicles where id = p_vehicle_id for update;
  if v_found is null then
    return 'not_found';
  end if;

  if public.vehicle_has_billing_evidence(p_vehicle_id) then
    return 'has_billing_evidence';
  end if;

  begin
    -- Only never-active drafts remain at this point (anything else is
    -- evidence), so these are safe to remove with the vehicle.
    delete from public.vehicle_licences where vehicle_id = p_vehicle_id;
    delete from public.vehicles where id = p_vehicle_id;
  exception
    when foreign_key_violation then
      -- A non-billing table (jobs, assignments, manifests) still points here
      -- with a restricting FK. The subtransaction is rolled back, so the
      -- draft licences survive too.
      return 'referenced';
  end;

  return 'deleted';
end $$;

revoke all on function public.delete_vehicle_if_no_billing_evidence(uuid) from public, anon, authenticated;
grant execute on function public.delete_vehicle_if_no_billing_evidence(uuid) to service_role;

-- ------------------------------------------------------------ 4. foreign keys

-- Rewrites one single-column FK to ON DELETE RESTRICT, found by catalogue.
-- Skips when the table is absent or the FK is already restrict. When no FK
-- exists at all it is added NOT VALID and validated only if no orphan rows
-- exist, so a dirty table cannot abort the whole file.
do $$
declare
  spec record;
  v_con record;
  v_attnum smallint;
  v_orphans bigint;
  v_name text;
begin
  for spec in
    select * from (values
      ('vehicle_licences',       'vehicle_id',        'vehicles'),
      ('vehicle_cycle_coverage', 'vehicle_id',        'vehicles'),
      ('vehicle_addon_charges',  'vehicle_id',        'vehicles'),
      ('company_billing',        'company_id',        'companies'),
      ('platform_charges',       'company_id',        'companies'),
      ('vehicle_cycle_coverage', 'company_id',        'companies'),
      ('vehicle_addon_charges',  'company_id',        'companies'),
      ('billing_periods',        'company_id',        'companies'),
      ('period_invoice_lines',   'company_id',        'companies'),
      ('period_charges',         'company_id',        'companies'),
      ('period_invoice_lines',   'billing_period_id', 'billing_periods'),
      ('period_charges',         'billing_period_id', 'billing_periods')
    ) as t(tbl, col, ref)
  loop
    if to_regclass('public.' || spec.tbl) is null or to_regclass('public.' || spec.ref) is null then
      raise notice 'prodfix_31: skipping %.% (table missing)', spec.tbl, spec.col;
      continue;
    end if;

    select a.attnum into v_attnum
    from pg_attribute a
    where a.attrelid = ('public.' || spec.tbl)::regclass
      and a.attname = spec.col and not a.attisdropped;
    if v_attnum is null then
      raise notice 'prodfix_31: skipping %.% (column missing)', spec.tbl, spec.col;
      continue;
    end if;

    select c.conname, c.confdeltype, c.convalidated into v_con
    from pg_constraint c
    where c.conrelid = ('public.' || spec.tbl)::regclass
      and c.confrelid = ('public.' || spec.ref)::regclass
      and c.contype = 'f'
      and c.conkey = array[v_attnum];

    if found and v_con.confdeltype = 'r' then
      raise notice 'prodfix_31: %.% already restrict (%)', spec.tbl, spec.col, v_con.conname;
      continue;
    end if;

    if found then
      v_name := v_con.conname;
      execute format('alter table public.%I drop constraint %I', spec.tbl, v_name);
      -- Existing rows already satisfied the old FK, so this validates cleanly.
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete restrict',
        spec.tbl, v_name, spec.col, spec.ref
      );
      raise notice 'prodfix_31: %.% % -> restrict', spec.tbl, spec.col, v_name;
    else
      v_name := spec.tbl || '_' || spec.col || '_fkey';
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete restrict not valid',
        spec.tbl, v_name, spec.col, spec.ref
      );
      execute format(
        'select count(*) from public.%I t where t.%I is not null and not exists (select 1 from public.%I r where r.id = t.%I)',
        spec.tbl, spec.col, spec.ref, spec.col
      ) into v_orphans;
      if v_orphans = 0 then
        execute format('alter table public.%I validate constraint %I', spec.tbl, v_name);
        raise notice 'prodfix_31: %.% had no FK; added % restrict and validated', spec.tbl, spec.col, v_name;
      else
        raise notice 'prodfix_31: %.% had no FK; added % restrict NOT VALID, % orphan rows need reconciling before validate',
          spec.tbl, spec.col, v_name, v_orphans;
      end if;
    end if;
  end loop;
end $$;

-- period_invoice_lines.vehicle_id is deliberately LEFT as ON DELETE SET NULL.
-- An invoice line already snapshots what was billed (vrn_normalised,
-- coverage dates, days, amount, description), and billing_06 relaxed its
-- kind/vehicle_id check for exactly this. It is also unreachable in practice
-- now: an invoice line is billing evidence, so the trigger above refuses the
-- vehicle delete before the FK action could ever fire.

commit;

-- ===========================================================================
-- VERIFY.
-- ===========================================================================
--
-- 1. Every billing FK is restrict ('r'), except period_invoice_lines.vehicle_id
--    which stays set null ('n'). convalidated false means orphans were found
--    (see the notices).
--
--   select con.conrelid::regclass as tbl, a.attname as col,
--          con.confrelid::regclass as ref, con.conname,
--          con.confdeltype, con.convalidated
--   from pg_constraint con
--   join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
--   where con.contype = 'f'
--     and con.conrelid::regclass::text in ('vehicle_licences', 'vehicle_cycle_coverage',
--         'vehicle_addon_charges', 'company_billing', 'platform_charges',
--         'billing_periods', 'period_invoice_lines', 'period_charges')
--   order by 1, 2;
--
-- 2. The functions are locked down: service_role=X only, and neither API role
--    can execute them.
--
--   select p.proname, p.prosecdef, p.proacl,
--          has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
--          has_function_privilege('anon', p.oid, 'execute') as anon_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('vehicle_has_billing_evidence', 'guard_vehicle_billing_evidence',
--                       'delete_vehicle_if_no_billing_evidence');
--
-- 3. The trigger bites. Run as postgres and roll back; expect an exception
--    naming the registration when the vehicle has an ever-active licence:
--
--   begin;
--   delete from public.vehicles
--   where id = (select vehicle_id from public.vehicle_licences where active is true limit 1);
--   rollback;
