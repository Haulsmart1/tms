-- Full schema + RLS snapshot for planning an RLS overhaul. Read-only, safe to run.
-- Returns ONE JSON cell: every public table (columns, rls flag, policies, foreign keys)
-- plus the auth functions, triggers, and anon/authenticated grants the policies rely on.
-- In the Supabase SQL editor use "Download CSV" if the cell is too big to copy from the grid.

select jsonb_pretty(jsonb_build_object(
  'tables', (
    select coalesce(jsonb_agg(tbl order by tbl->>'table'), '[]'::jsonb) from (
      select jsonb_build_object(
        'table', c.relname,
        'rls_enabled', c.relrowsecurity,
        'columns', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', col.column_name, 'type', col.data_type,
            'nullable', col.is_nullable, 'default', col.column_default
          ) order by col.ordinal_position)
          from information_schema.columns col
          where col.table_schema='public' and col.table_name=c.relname), '[]'::jsonb),
        'foreign_keys', coalesce((
          select jsonb_agg(distinct jsonb_build_object(
            'column', kcu.column_name, 'references', ccu.table_name||'.'||ccu.column_name))
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on kcu.constraint_name=tc.constraint_name and kcu.table_schema='public'
          join information_schema.constraint_column_usage ccu
            on ccu.constraint_name=tc.constraint_name
          where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public'
            and tc.table_name=c.relname), '[]'::jsonb),
        'policies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', p.policyname, 'cmd', p.cmd, 'roles', p.roles,
            'using', p.qual, 'with_check', p.with_check
          ) order by p.policyname)
          from pg_policies p
          where p.schemaname='public' and p.tablename=c.relname), '[]'::jsonb)
      ) as tbl
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r'
    ) s),
  'functions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', p.proname, 'security_definer', p.prosecdef, 'definition', pg_get_functiondef(p.oid)))
    from pg_proc p where p.pronamespace='public'::regnamespace
      and (p.prosecdef or p.proname ~ '^(get_my|can_|guard_)')), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', c.relname, 'name', tg.tgname, 'definition', pg_get_triggerdef(tg.oid)))
    from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not tg.tgisinternal), '[]'::jsonb),
  'grants', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', table_name, 'grantee', grantee, 'privilege', privilege_type)
      order by table_name, grantee)
    from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated')), '[]'::jsonb)
)) as rls_overhaul_dump;
