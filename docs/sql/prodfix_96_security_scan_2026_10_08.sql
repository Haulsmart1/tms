-- prodfix_96_security_scan_2026_10_08.sql
--
-- Database half of docs/superpowers/reviews/2026-10-08-security-scan.md, recommended patch order
-- step 2. Every finding below was verified against the live project on 2026-10-08.
--
-- STEP 1  B-1 / H-5. convert_quotation_to_job, next_invoice_number and recalculate_invoice_totals
--         are SECURITY DEFINER, take a caller-chosen tenant and never call can_access_tenant, and
--         `authenticated` can EXECUTE them. Any signed-in user of any company could create a job in
--         another tenant or burn its invoice numbers. Grep of app/ and lib/ on 2026-10-08: the only
--         callers are app/api/accounts/quotations/[id]/convert/route.ts (admin client from
--         requireTenantAccess, i.e. the service role) and the prodfix_41 / prodfix_43 RPCs, which
--         are SECURITY INVOKER and themselves called only with the service role. No browser or
--         user-client caller exists. So EXECUTE is revoked from public, anon and authenticated and
--         granted to service_role. prodfix_86 is edited in the same change so a re-run of it no
--         longer reopens them (its `service_checked` fallback kept authenticated EXECUTE).
--
-- STEP 2  N-2. subcontractor_users and subcontractor_drivers each carry one FOR ALL policy and
--         `authenticated` holds full DML, so any tenant member could link themselves to any driver
--         and act as that driver on /api/driver/**. Grep on 2026-10-08: every write to either table
--         is in a service-role route (app/api/settings/portal-invites, app/api/subcontractor/**,
--         prodfix_20 remove_company_user); the browser never writes them, and every reader
--         (lib/driver/server.ts, lib/jobs/officeAccess.ts, app/api/auth/callback) uses the admin
--         client. Client DML is revoked and the FOR ALL policy becomes SELECT-only with the same
--         predicate. subcontractor_employees is LEFT AS IS: app/subcontractors/page.tsx inserts and
--         updates it from the browser (finding M-4); it needs that page moved behind a route first.
--
-- STEP 3  C-4. The live handle_new_user (AFTER INSERT on auth.users, SECURITY DEFINER) copied
--         tenant_id, company_id and role_id from raw_user_meta_data into a new profiles row. That
--         JSON is chosen by whoever creates the user (invite routes put tenant ids in it, and a
--         client can set it at signUp), so any invitee became an RLS member of the inviter's
--         tenant. The replacement is identity only: it reads full_name / name / phone from the
--         metadata and fills them on an EXISTING profile row whose values are null. It never
--         inserts a profile and never touches tenant_id, company_id or role_id. Any error in it
--         is downgraded to a WARNING so it can never block auth user creation.
--
--         Profiles are created ONLY by service-role code: prodfix_20 provision_tenant_user (staff
--         invites) and signup_01 create_company_with_admin (self-serve signup). Both used to run
--         `insert into profiles (id) values (...)` (a bare row) and rely on the old trigger having
--         already created the row. Live profiles.tenant_id is NOT NULL, so that bare insert fails
--         with 23502 whenever no profile exists. With the old trigger gone (and the invite route
--         already sending no ids in `data:`), every new staff invite and every signup would fail.
--         So this step also rewrites both RPCs with create or replace, keeping their signatures,
--         outcomes, error tokens and grants: when no profile exists they insert it complete
--         (tenant_id, company_id, role_id, and full_name for signup) after the tenant is known. A
--         transaction-scoped advisory lock on the user id replaces the bare-row lock, shared by
--         both functions, so two concurrent provisioning calls for one user still serialise.
--
-- STEP 4  Tracking emails cannot send: document_delivery_log's document_type CHECK has no
--         'tracking_link'. The CHECK is found by definition (its name is not known) and recreated
--         with the same seven values plus 'tracking_link'.
--
-- STEP 5  C-1 residue. `roles` grants INSERT, UPDATE and DELETE to authenticated behind a single
--         SELECT policy (inert today, but one stray policy away from a role catalogue anyone can
--         edit). Revoked. The duplicate row named 'super_admin' || chr(10) is deleted only when no
--         profile points at it and no membership names it.
--
-- STEP 6  N-16 / S-15. Every SECURITY DEFINER function in public whose search_path does not
--         contain pg_temp gets pg_temp appended LAST, keeping whatever schemas it already listed
--         (so a function that resolves an extension function through `extensions` keeps working).
--         A definer function with no search_path at all gets `public, extensions, pg_temp`, which
--         is what it saw from PostgREST before minus "$user" (or `public, pg_temp` when there is no
--         extensions schema). Extension-owned functions and functions this session does not own are
--         skipped and reported. Also: SECURITY DEFINER trigger functions lose EXECUTE for public,
--         anon and authenticated. A trigger fires without an EXECUTE check, so nothing breaks; the
--         grant only let a client call the function directly.
--
-- STEP 7  S-14 / B-5 / S-9.
--         a. TRUNCATE, REFERENCES and TRIGGER are revoked from anon, authenticated and PUBLIC on
--            every table in public. No client path uses them, and TRUNCATE is not subject to RLS.
--         b. job_item_vehicle_custody, load_transfer_batches and load_transfer_items are written
--            only by create_and_confirm_load_transfer and sync_manifest_event_item_custody (both
--            SECURITY DEFINER): client INSERT, UPDATE and DELETE are revoked too.
--         c. planning_saved_plans: UPDATE and DELETE are limited to the plan's creator or a
--            manager of the tenant (can_manage_tenant), created_by is pinned by a trigger
--            (errcode PLN01), and the snapshot is capped at 1 MiB (NOT VALID, so existing rows are
--            not checked; new and updated rows are).
--
-- STEP 9  S-10. The load-transfer destination vehicle is licence- and VOR-gated by trigger.
--
-- STEP 8  N-6. shift_vehicle_periods lacks gate_vehicle_licensed because the shifts_03 re-run
--         failed on 2026-10-08. The shifts_03 DO block is repeated here inside its own exception
--         block: if it fails again, the failure is printed as a WARNING and the rest of this file
--         still applies. VERIFY 8 shows whether the trigger exists.
--
-- ORDER: apply after everything in prodfix_00_APPLY_ORDER.md that is marked applied, and BEFORE
-- shifts_06. Safe to re-run: every statement is idempotent.
--
-- APP FOLLOW-UPS (not in this file): drop tenant, role and portal ids from `data:` in
-- app/api/settings/portal-invites and app/api/subcontractor/users/invite (C-4 code half), and move
-- subcontractor_employees writes behind a route (M-4).

begin;

-- ---------------------------------------------------------------------------------------------
-- STEP 0: preconditions
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.can_access_tenant(uuid)') is null
     or to_regprocedure('public.can_manage_tenant(uuid)') is null
     or to_regprocedure('public.auth_tenant_id()') is null
     or to_regprocedure('public.prodfix_role_id(text)') is null then
    raise exception 'prodfix_96: can_access_tenant, can_manage_tenant, auth_tenant_id or prodfix_role_id is missing (rls_02, prodfix_20). Nothing changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- STEP 1: B-1 / H-5, accounting definer functions become service_role only
-- ---------------------------------------------------------------------------------------------
do $$
declare
  r      record;
  v_deps int;
  v_n    int := 0;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('convert_quotation_to_job', 'next_invoice_number', 'recalculate_invoice_totals')
      and p.prokind = 'f'
  loop
    -- A column default or policy that calls one of these would evaluate as the calling user.
    -- None is expected (the tables involved are server-written since prodfix_95); report any.
    select count(*) into v_deps
    from pg_depend d
    where d.refclassid = 'pg_proc'::regclass and d.refobjid = r.oid
      and d.classid in ('pg_attrdef'::regclass, 'pg_policy'::regclass);
    if v_deps > 0 then
      raise warning 'prodfix_96: % is used by % column default(s) or policy(ies). Only service_role can evaluate them after this; check VERIFY 1b.', r.sig, v_deps;
    end if;

    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    v_n := v_n + 1;
    raise notice 'prodfix_96: % -> service_role only', r.sig;
  end loop;
  if v_n = 0 then
    raise notice 'prodfix_96: none of the three accounting functions exists, step 1 skipped';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- STEP 2: N-2, subcontractor link tables become read-only from the browser
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t   text;
  pol record;
begin
  foreach t in array array['subcontractor_users', 'subcontractor_drivers'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'prodfix_96: public.% not found, skipped', t;
      continue;
    end if;
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'tenant_id') then
      raise exception 'prodfix_96: public.%.tenant_id is missing; refusing to guess a read policy. Nothing changed.', t;
    end if;

    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated, public', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);

    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    -- Same predicate as the live FOR ALL policy, now SELECT only.
    execute format(
      'create policy tenant_read on public.%I for select to authenticated using (tenant_id = public.auth_tenant_id())', t);
    raise notice 'prodfix_96: public.% is SELECT-only for authenticated', t;
  end loop;
  -- subcontractor_employees: deliberately untouched (M-4, browser writes from app/subcontractors).
end $$;

-- ---------------------------------------------------------------------------------------------
-- STEP 3: C-4, identity-only handle_new_user, and the two provisioning RPCs that relied on it
-- ---------------------------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name  text;
  v_phone text;
begin
  -- Identity only. tenant_id, company_id and role_id are NEVER read from raw_user_meta_data:
  -- that JSON is chosen by whoever creates the user. Profiles are created by service-role code
  -- (prodfix_20 provision_tenant_user, signup_01 create_company_with_admin), never here.
  begin
    v_name  := left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                                          new.raw_user_meta_data ->> 'name', '')), ''), 200);
    v_phone := left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''), 32);

    if v_name is not null or v_phone is not null then
      update public.profiles p
         set full_name = coalesce(p.full_name, v_name),
             phone     = coalesce(p.phone, v_phone)
       where p.id = new.id
         and ((p.full_name is null and v_name is not null) or (p.phone is null and v_phone is not null));
    end if;
  exception when others then
    -- Never block auth user creation over a display name.
    raise warning 'handle_new_user: identity copy skipped for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- prodfix_20 provision_tenant_user, rewritten. Same signature, outcomes, error tokens and grants.
-- Changed: no bare `insert into profiles (id)` (fails on NOT NULL tenant_id); a missing profile is
-- inserted complete and answers 'created'. The existing-profile branches are unchanged.
create or replace function public.provision_tenant_user(
  p_user_id uuid,
  p_email text,
  p_tenant_id uuid,
  p_role text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_role_id uuid;
  v_profile record;
  v_home_company uuid;
  v_outcome text;
begin
  if p_user_id is null or p_tenant_id is null then
    raise exception 'invalid_arguments';
  end if;
  if p_role is null or p_role not in ('admin', 'staff', 'driver') then
    raise exception 'invalid_role';
  end if;

  select t.company_id into v_company from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'tenant_not_found';
  end if;
  if v_company is null then
    raise exception 'tenant_without_company';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_not_found';
  end if;

  v_role_id := public.prodfix_role_id(p_role);

  -- memberships.user_id references public.users, so make sure the row exists.
  insert into public.users (id, email)
  values (p_user_id, lower(btrim(coalesce(p_email, ''))))
  on conflict (id) do nothing;

  -- Serialise every provisioning call for this user (shared with create_company_with_admin).
  perform pg_advisory_xact_lock(hashtextextended('profile_provision:' || p_user_id::text, 0));

  select p.id, p.company_id, p.tenant_id, p.role_id, r.name as role_name
    into v_profile
    from public.profiles p
    left join public.roles r on r.id = p.role_id
   where p.id = p_user_id
   for update of p;

  if not found then
    insert into public.profiles (id, tenant_id, company_id, role_id)
    values (p_user_id, p_tenant_id, v_company, v_role_id);
    v_outcome := 'created';
  else
    if v_profile.role_name = 'super_admin' then
      return 'other_company';
    end if;

    v_home_company := coalesce(
      v_profile.company_id,
      (select t.company_id from public.tenants t where t.id = v_profile.tenant_id)
    );

    if v_profile.company_id is null and v_profile.tenant_id is null then
      update public.profiles
         set tenant_id = p_tenant_id,
             company_id = v_company,
             role_id = v_role_id
       where id = p_user_id;
      v_outcome := 'created';
    elsif v_home_company is not distinct from v_company
          and v_profile.tenant_id is not null then
      if v_profile.company_id is null or v_profile.role_id is null then
        update public.profiles
           set company_id = v_company,
               role_id = coalesce(v_profile.role_id, v_role_id)
         where id = p_user_id;
        v_outcome := 'repaired';
      else
        return 'already_member';
      end if;
    else
      return 'other_company';
    end if;
  end if;

  insert into public.memberships (tenant_id, user_id, role)
  select p_tenant_id, p_user_id,
         coalesce((select r.name from public.roles r
                   join public.profiles p on p.role_id = r.id
                   where p.id = p_user_id), p_role)
  where not exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = p_user_id
  );

  return v_outcome;
end $$;

revoke all on function public.provision_tenant_user(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.provision_tenant_user(uuid, text, uuid, text) to service_role;

-- signup_01 create_company_with_admin, rewritten. Same signature, outcomes ('created',
-- 'already_member'), error tokens (invalid_arguments, user_not_found, role_missing,
-- role_ambiguous, not_eligible) and grants, which is the contract lib/auth/signup.ts and
-- app/api/signup/route.ts depend on. Changed: no bare profile insert before the tenant exists
-- (live it failed on NOT NULL tenant_id, so signup could never succeed). A missing profile is
-- inserted complete after the company and tenant are created; an existing one is updated as
-- before.
create or replace function public.create_company_with_admin(
  p_user_id      uuid,
  p_email        text,
  p_company_name text,
  p_contact_name text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_name text := nullif(btrim(coalesce(p_company_name, '')), '');
  v_contact_name text := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_email        text := lower(btrim(coalesce(p_email, '')));
  v_role_id      uuid;
  v_company_id   uuid;
  v_tenant_id    uuid;
  v_profile      record;
  v_has_profile  boolean;
begin
  if p_user_id is null or v_company_name is null then
    raise exception 'invalid_arguments';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_not_found';
  end if;

  -- Resolved before any write, so a missing role leaves nothing behind.
  v_role_id := public.prodfix_role_id('admin');

  -- memberships.user_id references public.users, so the row must exist first.
  insert into public.users (id, email)
  values (p_user_id, v_email)
  on conflict (id) do nothing;

  -- Serialise every provisioning call for this user (shared with provision_tenant_user), so
  -- calling twice for one user still creates one company.
  perform pg_advisory_xact_lock(hashtextextended('profile_provision:' || p_user_id::text, 0));

  select p.id, p.company_id, p.tenant_id, p.role_id, p.full_name
    into v_profile
    from public.profiles p
   where p.id = p_user_id
     for update of p;
  v_has_profile := found;

  if v_has_profile then
    if v_profile.company_id is not null
       or exists (select 1 from public.tenants t
                   where t.id = v_profile.tenant_id and t.company_id is not null) then
      return 'already_member';
    end if;

    -- Never re-role platform staff.
    if exists (select 1 from public.roles r
                where r.id = v_profile.role_id and r.name = 'super_admin') then
      raise exception 'not_eligible';
    end if;
  end if;

  insert into public.companies (name)
  values (v_company_name)
  returning id into v_company_id;

  -- The first tenant is named after the company; the admin can rename it.
  insert into public.tenants (name, company_id)
  values (v_company_name, v_company_id)
  returning id into v_tenant_id;

  -- company_profiles.tenant_id holds the COMPANY id (rls_04_identity_tables.sql,
  -- lib/superAdmin/companyEdit.ts).
  insert into public.company_profiles (tenant_id, company_name)
  values (v_company_id, v_company_name)
  on conflict (tenant_id) do update set company_name = excluded.company_name;

  -- All three columns, or get_tenant_context() answers no-tenant (rls_07_tenant_context.sql).
  if v_has_profile then
    update public.profiles
       set tenant_id  = v_tenant_id,
           company_id = v_company_id,
           role_id    = v_role_id,
           full_name  = coalesce(full_name, v_contact_name)
     where id = p_user_id;
  else
    insert into public.profiles (id, tenant_id, company_id, role_id, full_name)
    values (p_user_id, v_tenant_id, v_company_id, v_role_id, v_contact_name);
  end if;

  -- Legacy, written for compatibility only; nothing reads it for authorization.
  insert into public.memberships (tenant_id, user_id, role)
  select v_tenant_id, p_user_id, 'admin'
  where not exists (
    select 1 from public.memberships m
     where m.tenant_id = v_tenant_id and m.user_id = p_user_id
  );

  return 'created';
end $$;

revoke all on function public.create_company_with_admin(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_company_with_admin(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- STEP 4: document_delivery_log accepts 'tracking_link'
-- ---------------------------------------------------------------------------------------------
do $$
declare
  c record;
begin
  if to_regclass('public.document_delivery_log') is null then
    raise notice 'prodfix_96: public.document_delivery_log not found, step 4 skipped';
    return;
  end if;

  if exists (select 1 from pg_constraint
             where conrelid = 'public.document_delivery_log'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) ilike '%document_type%'
               and pg_get_constraintdef(oid) ilike '%tracking_link%') then
    raise notice 'prodfix_96: document_delivery_log already allows tracking_link';
    return;
  end if;

  for c in
    select conname from pg_constraint
    where conrelid = 'public.document_delivery_log'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%document_type%'
  loop
    execute format('alter table public.document_delivery_log drop constraint %I', c.conname);
    raise notice 'prodfix_96: dropped document_delivery_log CHECK %', c.conname;
  end loop;

  alter table public.document_delivery_log
    add constraint document_delivery_log_document_type_check
    check (document_type in ('quotation', 'invoice', 'credit_note', 'pod', 'statement',
                             'purchase_order', 'chase_letter', 'tracking_link'));
  raise notice 'prodfix_96: document_delivery_log_document_type_check now includes tracking_link';
end $$;

-- ---------------------------------------------------------------------------------------------
-- STEP 5: roles catalogue is read-only from the browser; drop the stray 'super_admin\n' row
-- ---------------------------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger on public.roles from anon, authenticated, public;
grant select, insert, update, delete on public.roles to service_role;

do $$
declare
  v_id   uuid;
  v_name text := 'super_admin' || chr(10);
begin
  select id into v_id from public.roles where name = v_name;
  if v_id is null then
    raise notice 'prodfix_96: no roles row named super_admin plus newline';
    return;
  end if;
  if exists (select 1 from public.profiles where role_id = v_id) then
    raise notice 'prodfix_96: stray super_admin row % is referenced by a profile, kept', v_id;
    return;
  end if;
  if to_regclass('public.memberships') is not null
     and exists (select 1 from public.memberships where role::text = v_name) then
    raise notice 'prodfix_96: stray super_admin row % is named by a membership, kept', v_id;
    return;
  end if;
  begin
    delete from public.roles where id = v_id;
    raise notice 'prodfix_96: deleted stray roles row % (super_admin plus newline)', v_id;
  exception when foreign_key_violation then
    raise notice 'prodfix_96: stray super_admin row % is referenced elsewhere (%), kept', v_id, sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------------------------
-- STEP 6: N-16 / S-15, pg_temp on every definer function; trigger functions lose EXECUTE
-- ---------------------------------------------------------------------------------------------
do $$
declare
  r        record;
  v_path   text;
  v_new    text;
  v_has_ext boolean := exists (select 1 from pg_namespace where nspname = 'extensions');
  v_fixed  int := 0;
  v_skip   int := 0;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.proconfig, p.prorettype,
           pg_has_role(current_user, p.proowner, 'USAGE') as owned
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
      and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    if not r.owned then
      raise notice 'prodfix_96: SKIPPED % (not owned by %)', r.sig, current_user;
      v_skip := v_skip + 1;
      continue;
    end if;

    -- SECURITY DEFINER trigger functions: nobody needs EXECUTE to fire a trigger.
    if r.prorettype = 'trigger'::regtype then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    end if;

    select substr(c, length('search_path=') + 1) into v_path
    from unnest(coalesce(r.proconfig, '{}'::text[])) c
    where c like 'search_path=%'
    limit 1;

    if v_path is not null and v_path ~* '\mpg_temp\M' then
      continue;
    end if;

    if v_path is null then
      v_new := case when v_has_ext then 'public, extensions, pg_temp' else 'public, pg_temp' end;
    elsif btrim(v_path) in ('', '""') then
      v_new := 'pg_temp';
    else
      v_new := v_path || ', pg_temp';
    end if;

    execute format('alter function %s set search_path = %s', r.sig, v_new);
    raise notice 'prodfix_96: % search_path % -> %', r.sig, coalesce(v_path, '<none>'), v_new;
    v_fixed := v_fixed + 1;
  end loop;
  raise notice 'prodfix_96: pg_temp added to % definer functions, % skipped (not owned)', v_fixed, v_skip;
end $$;

-- ---------------------------------------------------------------------------------------------
-- STEP 7: S-14 / B-5 / S-9
-- ---------------------------------------------------------------------------------------------
-- 7a. No client role needs TRUNCATE (which RLS does not govern), REFERENCES or TRIGGER.
do $$
declare
  t record;
  v_n int := 0;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and pg_has_role(current_user, c.relowner, 'USAGE')
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated, public', t.relname);
    v_n := v_n + 1;
  end loop;
  raise notice 'prodfix_96: truncate, references, trigger revoked from client roles on % tables', v_n;
end $$;

-- 7b. Load-transfer and custody tables are written only by SECURITY DEFINER functions.
do $$
declare
  t text;
begin
  foreach t in array array['job_item_vehicle_custody', 'load_transfer_batches', 'load_transfer_items'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'prodfix_96: public.% not found, skipped', t;
      continue;
    end if;
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated, public', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    raise notice 'prodfix_96: public.% is SELECT-only for authenticated', t;
  end loop;
end $$;

-- 7c. planning_saved_plans: creator or manager edits and deletes, created_by pinned, size cap.
create or replace function public.pin_planning_saved_plan_creator()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Invoker rights on purpose: current_user must be the real caller. Clearing created_by (the
  -- auth user was deleted, ON DELETE SET NULL) is allowed; it only narrows who may edit.
  if new.created_by is distinct from old.created_by
     and new.created_by is not null
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'A saved plan keeps the person who created it.' using errcode = 'PLN01';
  end if;
  return new;
end $$;

revoke all on function public.pin_planning_saved_plan_creator() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.planning_saved_plans') is null then
    raise notice 'prodfix_96: public.planning_saved_plans not found, step 7c skipped';
    return;
  end if;

  drop policy if exists planning_saved_plans_update on public.planning_saved_plans;
  create policy planning_saved_plans_update
    on public.planning_saved_plans
    for update
    to authenticated
    using (
      public.can_access_tenant(tenant_id)
      and (created_by = auth.uid() or public.can_manage_tenant(tenant_id))
    )
    with check (
      public.can_access_tenant(tenant_id)
    );

  drop policy if exists planning_saved_plans_delete on public.planning_saved_plans;
  create policy planning_saved_plans_delete
    on public.planning_saved_plans
    for delete
    to authenticated
    using (
      public.can_access_tenant(tenant_id)
      and (created_by = auth.uid() or public.can_manage_tenant(tenant_id))
    );

  drop trigger if exists pin_planning_saved_plan_creator on public.planning_saved_plans;
  create trigger pin_planning_saved_plan_creator
    before update of created_by on public.planning_saved_plans
    for each row execute function public.pin_planning_saved_plan_creator();

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.planning_saved_plans'::regclass
                   and conname = 'planning_saved_plans_snapshot_size') then
    alter table public.planning_saved_plans
      add constraint planning_saved_plans_snapshot_size
      check (pg_column_size(snapshot) <= 1048576) not valid;
  end if;
  raise notice 'prodfix_96: planning_saved_plans policies, creator pin and size cap installed';
end $$;

-- ---------------------------------------------------------------------------------------------
-- STEP 8: N-6, the shifts_03 licence gate on shift_vehicle_periods (copied from shifts_03)
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.shift_vehicle_periods') is null then
    raise notice 'prodfix_96: shift_vehicle_periods not found (shifts_01 not applied), step 8 skipped';
    return;
  end if;
  if to_regprocedure('public.guard_vehicle_assignment_licensed()') is null then
    raise notice 'shifts_03: prodfix_30 is not applied, shift_vehicle_periods is NOT licence-gated. Re-run shifts_03 after prodfix_30.';
    return;
  end if;
  begin
    execute 'drop trigger if exists gate_vehicle_licensed on public.shift_vehicle_periods';
    execute 'create trigger gate_vehicle_licensed before insert or update of vehicle_id on public.shift_vehicle_periods
               for each row execute function public.guard_vehicle_assignment_licensed(''vehicle_id'')';
    raise notice 'shifts_03: gated public.shift_vehicle_periods.vehicle_id';
  exception when others then
    raise warning 'prodfix_96: could NOT gate shift_vehicle_periods (% %). Everything else in this file still applies; investigate before relying on N-6.', sqlstate, sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------------------------
-- STEP 9  S-10. create_and_confirm_load_transfer checked only that the destination vehicle is in
-- the tenant, so freight could be moved onto a VOR vehicle, an unlicensed one, or one belonging to
-- a cancelled company. Rather than copy the whole RPC body, the destination column of
-- load_transfer_batches gets the same prodfix_30 licence gate (LIC01 / LIC02) as every other
-- assignment table, plus a VOR refusal (errcode LTR01). Both fire inside the RPC's insert, so the
-- RPC fails as a whole and nothing is half-transferred.
-- ---------------------------------------------------------------------------------------------
create or replace function public.guard_transfer_destination_not_vor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registration text;
begin
  if tg_op = 'UPDATE' and old.destination_vehicle_id is not distinct from new.destination_vehicle_id then
    return new;
  end if;
  select nullif(btrim(v.registration), '') into v_registration
  from public.vehicles v
  where v.id = new.destination_vehicle_id and v.vor is true;
  if found then
    raise exception 'Vehicle % is off the road. Load cannot be transferred onto it.',
        coalesce(v_registration, new.destination_vehicle_id::text)
      using errcode = 'LTR01', hint = 'destination_vehicle_vor';
  end if;
  return new;
end $$;

revoke all on function public.guard_transfer_destination_not_vor() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.load_transfer_batches') is null then
    raise notice 'prodfix_96: load_transfer_batches not found, step 9 skipped';
    return;
  end if;
  execute 'drop trigger if exists gate_transfer_destination_not_vor on public.load_transfer_batches';
  execute 'create trigger gate_transfer_destination_not_vor before insert or update of destination_vehicle_id
             on public.load_transfer_batches for each row execute function public.guard_transfer_destination_not_vor()';
  if to_regprocedure('public.guard_vehicle_assignment_licensed()') is null then
    raise warning 'prodfix_96: prodfix_30 is not applied, load_transfer_batches is NOT licence-gated.';
    return;
  end if;
  execute 'drop trigger if exists gate_vehicle_licensed on public.load_transfer_batches';
  execute 'create trigger gate_vehicle_licensed before insert or update of destination_vehicle_id
             on public.load_transfer_batches for each row
             execute function public.guard_vehicle_assignment_licensed(''destination_vehicle_id'')';
  raise notice 'prodfix_96: gated public.load_transfer_batches.destination_vehicle_id (licence and VOR)';
end $$;

commit;

-- =============================================================================================
-- VERIFY (read-only)
-- =============================================================================================

-- VERIFY 1: expect anon_exec = false and auth_exec = false, service_exec = true on every row.
select p.oid::regprocedure as function,
       has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role', p.oid, 'execute')  as service_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('convert_quotation_to_job', 'next_invoice_number', 'recalculate_invoice_totals',
                    'provision_tenant_user', 'create_company_with_admin', 'handle_new_user')
order by 1;

-- VERIFY 1b: expect 0 rows (no column default or policy evaluates these as a client role).
select d.classid::regclass as kind, d.objid, d.refobjid::regprocedure as function
from pg_depend d
where d.refclassid = 'pg_proc'::regclass
  and d.classid in ('pg_attrdef'::regclass, 'pg_policy'::regclass)
  and d.refobjid in (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public'
                       and p.proname in ('convert_quotation_to_job', 'next_invoice_number', 'recalculate_invoice_totals'));

-- VERIFY 2: expect one tenant_read / SELECT policy per table and a_ins = a_upd = a_del = false.
select c.relname,
       has_table_privilege('authenticated', c.oid, 'insert') as a_ins,
       has_table_privilege('authenticated', c.oid, 'update') as a_upd,
       has_table_privilege('authenticated', c.oid, 'delete') as a_del,
       (select string_agg(policyname || '/' || cmd, ', ') from pg_policies pp
         where pp.schemaname = 'public' and pp.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('subcontractor_users', 'subcontractor_drivers', 'subcontractor_employees',
                    'job_item_vehicle_custody', 'load_transfer_batches', 'load_transfer_items', 'roles')
order by 1;

-- VERIFY 3: expect reads_metadata_privileged = false and no 'insert into public.profiles' in the trigger.
select p.oid::regprocedure as function,
       p.prosrc ~* 'raw_user_meta_data[^;]*(tenant_id|company_id|role_id)' as reads_metadata_privileged,
       p.prosrc ~* 'insert\s+into\s+public\.profiles' as inserts_profile,
       array_to_string(p.proconfig, ';') as config
from pg_proc p
where p.oid = 'public.handle_new_user()'::regprocedure;

-- VERIFY 3b (rolled back): a fresh staff invite path for an auth user with no profile.
--   begin;
--     select public.provision_tenant_user('<auth user id with no profile>', 'x@example.com', '<tenant id>', 'staff');
--     -- expect 'created', then one profile row with tenant_id, company_id and role_id set:
--     select tenant_id, company_id, role_id from public.profiles where id = '<auth user id with no profile>';
--   rollback;

-- VERIFY 4: expect one CHECK that lists tracking_link.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = to_regclass('public.document_delivery_log') and contype = 'c'
  and pg_get_constraintdef(oid) ilike '%document_type%';

-- VERIFY 5: expect 0 rows named with a newline, and one row each for admin, staff, driver, super_admin.
select name, replace(name, chr(10), '\n') as visible, count(*) over (partition by name) as n,
       (select count(*) from public.profiles p where p.role_id = r.id) as profiles
from public.roles r
order by name;

-- VERIFY 6: expect 0 rows (every definer function in public has pg_temp, except ones reported SKIPPED).
select p.oid::regprocedure as function, pg_get_userbyid(p.proowner) as owner,
       coalesce(array_to_string(p.proconfig, ';'), '<none>') as config
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where c like 'search_path=%' and c ~* '\mpg_temp\M');

-- VERIFY 6b: expect 0 rows (no client role can call a definer trigger function directly).
select p.oid::regprocedure as function
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and p.prorettype = 'trigger'::regtype
  and (has_function_privilege('anon', p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute'));

-- VERIFY 7: expect 0 rows (no client role holds truncate on a public table).
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and (has_table_privilege('authenticated', c.oid, 'truncate') or has_table_privilege('anon', c.oid, 'truncate'));

-- VERIFY 7c: expect the update and delete policies to name created_by and can_manage_tenant.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'planning_saved_plans'
order by policyname;

-- VERIFY 8: expect one row, gate_vehicle_licensed on shift_vehicle_periods.
select c.relname, t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal and t.tgname = 'gate_vehicle_licensed' and c.relname = 'shift_vehicle_periods';
