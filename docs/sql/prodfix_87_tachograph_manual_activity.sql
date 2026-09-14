-- prodfix_87_tachograph_manual_activity.sql
--
-- Findings SQL-18 (the manual tachograph activity overlap check is racy) and SQL-7, database side
-- (the two tachograph RPCs authorize from the legacy memberships table).
--
-- Replaces the bodies of public.upsert_manual_driver_activity and
-- public.delete_manual_driver_activity from
-- supabase/migrations/20260911131500_tachograph_activity_ledger.sql. Same signatures, same return
-- types, same error strings for every validation; two changes:
--
-- 1. RACE (SQL-18). The old body checked `exists (... overlapping activity ...)` and then inserted,
--    unserialized, so two concurrent saves for the same driver could both pass the check and store
--    overlapping records. The upsert now takes
--      pg_advisory_xact_lock(hashtextextended('manual_driver_activity:' || tenant || ':' || driver, 0))
--    before the check. The lock is held to the end of the calling transaction, so the second save
--    waits, then sees the first row and raises 'activity overlaps an existing record'.
--    Why not an exclusion constraint (btree_gist, tstzrange &&): driver_activity_logs already holds
--    legacy and imported tachograph rows that may legitimately overlap (raw provider data), so
--    adding the constraint could fail or, worse, start rejecting imports. The lock scopes the fix to
--    the manual path this check exists for. Imports (service role, source_kind tachograph_*) do not
--    take the lock and are not overlap-checked, exactly as before.
--
-- 2. ROLE SOURCE (SQL-7). The old body required a memberships row with role admin/super_admin. The
--    product decision is that profiles is the single source of truth, and the route in front of
--    this RPC (lib/tachograph/serverAuth.ts, since deec4cd) already authorizes with the
--    can_manage_tenant rule. A company admin with no memberships row therefore passed the route and
--    failed here. Both functions now require public.can_manage_tenant(p_tenant_id) (super_admin, or
--    admin of the tenant's company, read from profiles). Nothing here reads memberships.
--    Behaviour change: a user whose only admin grant is a memberships row, not profiles, loses
--    manual tachograph edits. That matches every other admin write in the app.
--
-- Also sets search_path = public, pg_temp (SQL-15) and re-asserts the grants: EXECUTE for
-- authenticated (the route calls it with the cookie client) and service_role, none for public/anon.
--
-- PRECONDITIONS (asserted): both functions exist with the original signatures;
-- public.can_manage_tenant(uuid) exists; driver_activity_logs has the columns the body uses;
-- this session owns both functions.
--
-- Diag to check first: 04_function (both signatures present), 10_column is not needed (asserted).
-- Safe to re-run.

begin;

do $$
declare
  v_fn text;
  v_col text;
begin
  foreach v_fn in array array[
    'public.upsert_manual_driver_activity(uuid,uuid,uuid,text,text,timestamptz,timestamptz)',
    'public.delete_manual_driver_activity(uuid,uuid)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'prodfix_87: % not found; apply 20260911131500_tachograph_activity_ledger.sql first. Nothing changed.', v_fn;
    end if;
    if not pg_has_role(current_user, (select proowner from pg_proc where oid = to_regprocedure(v_fn)), 'USAGE') then
      raise exception 'prodfix_87: % does not own %. Nothing changed.', current_user, v_fn;
    end if;
  end loop;
  if to_regprocedure('public.can_manage_tenant(uuid)') is null then
    raise exception 'prodfix_87: public.can_manage_tenant(uuid) is missing. Nothing changed.';
  end if;
  foreach v_col in array array['id', 'tenant_id', 'driver_id', 'activity_type', 'activity_kind',
                               'start_time', 'end_time', 'source_kind', 'updated_at'] loop
    if not exists (select 1 from pg_attribute a
                   where a.attrelid = to_regclass('public.driver_activity_logs')
                     and a.attname = v_col and not a.attisdropped) then
      raise exception 'prodfix_87: public.driver_activity_logs.% is missing. Nothing changed.', v_col;
    end if;
  end loop;
end $$;

create or replace function public.upsert_manual_driver_activity(
    p_tenant_id uuid,
    p_driver_id uuid,
    p_activity_id uuid,
    p_activity_kind text,
    p_activity_type text,
    p_start_time timestamptz,
    p_end_time timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    if not public.can_access_tenant(p_tenant_id) then
        raise exception 'tenant access denied';
    end if;

    -- profiles-based admin check (super_admin, or admin of this tenant's company).
    if not public.can_manage_tenant(p_tenant_id) then
        raise exception 'tenant administrator required';
    end if;

    if p_activity_kind not in (
        'driving',
        'other_work',
        'availability',
        'break',
        'rest',
        'unknown'
    ) then
        raise exception 'invalid activity kind';
    end if;

    if p_end_time <= p_start_time then
        raise exception 'activity end must be after start';
    end if;

    if not exists (
        select 1
        from public.drivers d
        where d.id = p_driver_id
          and d.tenant_id = p_tenant_id
    ) then
        raise exception 'driver not found for tenant';
    end if;

    -- Serialize manual saves per driver so the overlap check and the write are atomic.
    perform pg_advisory_xact_lock(
        hashtextextended('manual_driver_activity:' || p_tenant_id::text || ':' || p_driver_id::text, 0)
    );

    if exists (
        select 1
        from public.driver_activity_logs a
        where a.tenant_id = p_tenant_id
          and a.driver_id = p_driver_id
          and (p_activity_id is null or a.id <> p_activity_id)
          and a.start_time < p_end_time
          and a.end_time > p_start_time
    ) then
        raise exception 'activity overlaps an existing record';
    end if;

    if p_activity_id is null then
        insert into public.driver_activity_logs (
            tenant_id,
            driver_id,
            activity_type,
            activity_kind,
            start_time,
            end_time,
            source_kind,
            updated_at
        )
        values (
            p_tenant_id,
            p_driver_id,
            nullif(btrim(p_activity_type), ''),
            p_activity_kind,
            p_start_time,
            p_end_time,
            'manual',
            now()
        )
        returning id into v_id;

        return v_id;
    end if;

    update public.driver_activity_logs
    set
        activity_type = nullif(btrim(p_activity_type), ''),
        activity_kind = p_activity_kind,
        start_time = p_start_time,
        end_time = p_end_time,
        updated_at = now()
    where id = p_activity_id
      and tenant_id = p_tenant_id
      and driver_id = p_driver_id
      and source_kind = 'manual'
    returning id into v_id;

    if v_id is null then
        raise exception 'manual activity not found or is not editable';
    end if;

    return v_id;
end
$$;

create or replace function public.delete_manual_driver_activity(
    p_tenant_id uuid,
    p_activity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    if not public.can_access_tenant(p_tenant_id) then
        raise exception 'tenant access denied';
    end if;

    if not public.can_manage_tenant(p_tenant_id) then
        raise exception 'tenant administrator required';
    end if;

    delete from public.driver_activity_logs
    where id = p_activity_id
      and tenant_id = p_tenant_id
      and source_kind = 'manual';

    if not found then
        raise exception 'manual activity not found or is not deletable';
    end if;
end
$$;

revoke all on function public.upsert_manual_driver_activity(uuid, uuid, uuid, text, text, timestamptz, timestamptz)
  from public, anon;
revoke all on function public.delete_manual_driver_activity(uuid, uuid)
  from public, anon;
grant execute on function public.upsert_manual_driver_activity(uuid, uuid, uuid, text, text, timestamptz, timestamptz)
  to authenticated, service_role;
grant execute on function public.delete_manual_driver_activity(uuid, uuid)
  to authenticated, service_role;

commit;

-- VERIFY (read-only). Expect: memberships_in_body=false, takes_lock true for upsert,
-- config search_path=public, pg_temp, anon_exec=false, auth_exec=true.
select p.oid::regprocedure as function,
       p.prosrc ilike '%memberships%' as memberships_in_body,
       p.prosrc ilike '%pg_advisory_xact_lock%' as takes_lock,
       array_to_string(p.proconfig, ';') as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('upsert_manual_driver_activity', 'delete_manual_driver_activity');
