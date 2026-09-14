-- prodfix_90_child_tenant_binding.sql
--
-- Finding SQL-16. job_items.job_id and job_item_scans.job_id / stop_id / job_item_id are single-column
-- foreign keys, and their RLS policies check only the row's own tenant_id. A member of tenant A can
-- therefore insert a job_items row with tenant_id = A that points at tenant B's job, or repoint
-- job_id on update. The damage is integrity pollution (create_load_manifest re-checks tenancy), but
-- it is also a way to attach data to another operator's job.
--
-- WHAT IT DOES: BEFORE INSERT / UPDATE triggers that require
--   job_items.tenant_id      = jobs.tenant_id       (via job_id)
--   job_item_scans.tenant_id = jobs.tenant_id       (via job_id)
--                            = job_stops.tenant_id  (via stop_id)
--                            = job_items.tenant_id  (via job_item_id)
-- They fire for every role, service_role included: a server route that writes a mismatched row is a
-- bug too (app/api/integrations/cambridge-audio/rma inserts job_items with the service role).
--
-- Why triggers rather than composite foreign keys `(tenant_id, job_id) references jobs (tenant_id, id)`:
-- that needs a new unique constraint on jobs and job_items, which rewrites nothing but takes locks
-- on the busiest tables and fails on any duplicate, and it cannot be staged as a no-op. The
-- trigger functions are SECURITY DEFINER so the parent lookup is not hidden by the caller's RLS;
-- the error text is identical whether the parent is missing or belongs to another tenant, so the
-- trigger reveals nothing about other tenants' ids.
--
-- Not covered (documented, not changed): moving a JOB to another tenant does not cascade or block;
-- its children keep the old tenant_id and fail the next time they are updated.
--
-- PRECONDITIONS (asserted; any failure raises and nothing changes):
--   - job_items(tenant_id, job_id) and jobs(tenant_id) exist.
--   - if job_item_scans exists: it has tenant_id, job_id, stop_id, job_item_id, and job_stops has tenant_id.
--   - NO EXISTING ROW ALREADY BREAKS THE RULE. If some do, the exception prints the count and the
--     query to list them. Fix those rows first (the triggers would otherwise block the next edit of
--     each one).
--   - this session owns the tables.
--
-- Diag to check first: 10_column (job_items), 01_table_rls (job_item_scans present?). Safe to re-run.

begin;

do $$
declare
  v_n bigint;
  v_col text;
begin
  if to_regclass('public.job_items') is null or to_regclass('public.jobs') is null then
    raise exception 'prodfix_90: public.job_items or public.jobs not found. Nothing changed.';
  end if;
  foreach v_col in array array['tenant_id', 'job_id'] loop
    if not exists (select 1 from pg_attribute where attrelid = 'public.job_items'::regclass
                   and attname = v_col and not attisdropped) then
      raise exception 'prodfix_90: public.job_items.% is missing. Nothing changed.', v_col;
    end if;
  end loop;
  if not exists (select 1 from pg_attribute where attrelid = 'public.jobs'::regclass
                 and attname = 'tenant_id' and not attisdropped) then
    raise exception 'prodfix_90: public.jobs.tenant_id is missing. Nothing changed.';
  end if;
  if not pg_has_role(current_user, (select relowner from pg_class where oid = 'public.job_items'::regclass), 'USAGE') then
    raise exception 'prodfix_90: % does not own public.job_items. Nothing changed.', current_user;
  end if;

  execute 'select count(*) from public.job_items ji left join public.jobs j on j.id = ji.job_id
           where j.id is null or j.tenant_id is distinct from ji.tenant_id' into v_n;
  if v_n > 0 then
    raise exception 'prodfix_90: % job_items rows already disagree with their job''s tenant. List them with: select ji.id, ji.tenant_id, j.tenant_id as job_tenant from public.job_items ji left join public.jobs j on j.id = ji.job_id where j.id is null or j.tenant_id is distinct from ji.tenant_id; Nothing changed.', v_n;
  end if;

  if to_regclass('public.job_item_scans') is not null then
    foreach v_col in array array['tenant_id', 'job_id', 'stop_id', 'job_item_id'] loop
      if not exists (select 1 from pg_attribute where attrelid = 'public.job_item_scans'::regclass
                     and attname = v_col and not attisdropped) then
        raise exception 'prodfix_90: public.job_item_scans.% is missing. Nothing changed.', v_col;
      end if;
    end loop;
    if not exists (select 1 from pg_attribute where attrelid = to_regclass('public.job_stops')
                   and attname = 'tenant_id' and not attisdropped) then
      raise exception 'prodfix_90: public.job_stops.tenant_id is missing. Nothing changed.';
    end if;
    execute 'select count(*) from public.job_item_scans s
             left join public.jobs j on j.id = s.job_id
             left join public.job_stops st on st.id = s.stop_id
             left join public.job_items ji on ji.id = s.job_item_id
             where j.tenant_id is distinct from s.tenant_id
                or st.tenant_id is distinct from s.tenant_id
                or ji.tenant_id is distinct from s.tenant_id' into v_n;
    if v_n > 0 then
      raise exception 'prodfix_90: % job_item_scans rows already disagree with a parent''s tenant (job, stop or item). Fix them first. Nothing changed.', v_n;
    end if;
  end if;
end $$;

create or replace function public.enforce_job_items_tenant()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.jobs j
                 where j.id = new.job_id and j.tenant_id = new.tenant_id) then
    raise exception 'job_items.tenant_id must equal the tenant of its job'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_job_items_tenant() from public, anon, authenticated;

drop trigger if exists enforce_job_items_tenant on public.job_items;
create trigger enforce_job_items_tenant
  before insert or update of tenant_id, job_id on public.job_items
  for each row execute function public.enforce_job_items_tenant();

do $$
begin
  if to_regclass('public.job_item_scans') is null then
    raise notice 'prodfix_90: public.job_item_scans not found, only job_items is bound';
    return;
  end if;

  create or replace function public.enforce_job_item_scans_tenant()
  returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
  begin
    if not exists (select 1 from public.jobs j where j.id = new.job_id and j.tenant_id = new.tenant_id)
       or not exists (select 1 from public.job_stops st where st.id = new.stop_id and st.tenant_id = new.tenant_id)
       or not exists (select 1 from public.job_items ji where ji.id = new.job_item_id and ji.tenant_id = new.tenant_id)
    then
      raise exception 'job_item_scans.tenant_id must equal the tenant of its job, stop and item'
        using errcode = 'check_violation';
    end if;
    return new;
  end;
  $fn$;
  revoke all on function public.enforce_job_item_scans_tenant() from public, anon, authenticated;

  drop trigger if exists enforce_job_item_scans_tenant on public.job_item_scans;
  create trigger enforce_job_item_scans_tenant
    before insert or update of tenant_id, job_id, stop_id, job_item_id on public.job_item_scans
    for each row execute function public.enforce_job_item_scans_tenant();
end $$;

commit;

-- VERIFY (read-only). Expect one row per table that exists.
select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal and t.tgname in ('enforce_job_items_tenant', 'enforce_job_item_scans_tenant');

-- Behavioural check (rolled back), as a tenant A user, against a tenant B job id: expect ERROR
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<TENANT_A_USER_ID>","role":"authenticated"}';
--     insert into public.job_items (tenant_id, job_id, description)
--       values ('<TENANT_A_ID>', '<TENANT_B_JOB_ID>', 'cross-tenant probe');
--   rollback;
