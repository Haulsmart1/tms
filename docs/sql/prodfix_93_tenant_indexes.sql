-- prodfix_93_tenant_indexes.sql
--
-- Finding SQL-19. `public.can_access_tenant(tenant_id)` is evaluated per row, and most tenant tables
-- have no index on tenant_id (only driver_activity_logs, job_items and the newer tables add one),
-- so filtered reads on telematics and logging tables degrade to sequential scans with a function
-- call per row.
--
-- WHAT IT DOES
--   1. For every public table (relkind r or p, not a partition, not extension-owned, owned by this
--      session) with a tenant_id column and NO index whose FIRST column is tenant_id:
--        create index if not exists <table>_tenant_id_idx on public.<table> (tenant_id)
--      unless the table is larger than 256 MB, in which case it is SKIPPED and listed in the result
--      with a ready-made CONCURRENTLY statement.
--   2. Policy-helper predicate columns:
--        tenants (company_id)    read by can_access_tenant / can_manage_tenant / get_tenant_context
--        profiles (company_id)   read by profiles_select (rls_04)
--        user_permissions (user_id)   read by prodfix_91's policy
--      each only if the column exists and no index already leads with it.
--
-- NOT CONCURRENTLY, deliberately: the Supabase SQL editor wraps the script in a transaction and
-- CREATE INDEX CONCURRENTLY cannot run inside one. A plain CREATE INDEX takes a SHARE lock, which
-- blocks INSERT/UPDATE/DELETE on that table (not reads) until the transaction commits. On small
-- tables that is milliseconds. For the large ones, run the generated statement one at a time from
-- psql (outside a transaction), ideally off-peak.
-- Tables most likely to be large: telematics_positions, gps_events, telematics_events,
-- telematics_trips, telematics_fuel, vehicle_locations, driver_activity_logs, audit_logs,
-- load_scan_events, job_item_scans. Check prodfix_80 section I_unindexed for real sizes.
--
-- Not done: a set-returning `accessible_tenant_ids()` helper so policies can be written
-- `tenant_id in (select public.accessible_tenant_ids())` and evaluated once per statement. That
-- rewrites every policy and is a separate, measured change.
--
-- Only adds indexes; changes no access. Safe to re-run. Apply LAST in the batch.
-- Diag to check first: none required; prodfix_80 section I_unindexed shows what will be created.

begin;

do $$
declare
  r record;
  v_name text;
  v_limit constant bigint := 256 * 1024 * 1024;
begin
  for r in
    select c.oid, c.relname, pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relispartition
      and pg_has_role(current_user, c.relowner, 'USAGE')
      and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
      and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)
    order by c.relname
  loop
    if r.bytes > v_limit then
      raise notice 'prodfix_93: SKIPPED public.% (%), run the CONCURRENTLY statement from the result by hand',
        r.relname, pg_size_pretty(r.bytes);
      continue;
    end if;
    v_name := left(r.relname, 48) || '_tenant_id_idx';
    execute format('create index if not exists %I on public.%I (tenant_id)', v_name, r.relname);
  end loop;

  -- Helper predicate columns.
  for r in
    select * from (values ('tenants', 'company_id'), ('profiles', 'company_id'), ('user_permissions', 'user_id')) v(tbl, col)
  loop
    if to_regclass('public.' || r.tbl) is not null
       and exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || r.tbl)
                     and a.attname = r.col and not a.attisdropped)
       and pg_has_role(current_user, (select relowner from pg_class where oid = to_regclass('public.' || r.tbl)), 'USAGE')
       and not exists (select 1 from pg_index i
                       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                       where i.indrelid = to_regclass('public.' || r.tbl) and a.attname = r.col)
    then
      execute format('create index if not exists %I on public.%I (%I)', r.tbl || '_' || r.col || '_idx', r.tbl, r.col);
    end if;
  end loop;
end $$;

commit;

-- RESULT (read-only): tenant tables still without a tenant_id-leading index, with the statement to
-- run by hand from psql. Expect only the tables skipped for size (or not owned by this session).
select c.relname as table_name,
       pg_size_pretty(pg_total_relation_size(c.oid)) as size,
       format('create index concurrently if not exists %I on public.%I (tenant_id);',
              left(c.relname, 48) || '_tenant_id_idx', c.relname) as run_by_hand
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
  and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)
order by pg_total_relation_size(c.oid) desc;
