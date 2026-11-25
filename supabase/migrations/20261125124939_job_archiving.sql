alter table public.jobs add column archived_at timestamptz;

create index jobs_archived_tenant_customer_idx
  on public.jobs (tenant_id, customer_id, archived_at)
  where archived_at is not null;

-- This runs after jobs_set_updated_at, so an archive-only update retains
-- the timestamp from the last operational edit.
create function public.guard_job_archive_marker()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Only a database operator can change the archive marker'
      using errcode = '42501';
  end if;

  new.updated_at := old.updated_at;
  return new;
end;
$$;

create trigger zz_guard_job_archive_marker
  before update of archived_at on public.jobs
  for each row
  when (old.archived_at is distinct from new.archived_at)
  execute function public.guard_job_archive_marker();

-- Called by a database operator after verifying the tenant and customer IDs.
-- Check the whole job row so a pre-existing update trigger cannot silently
-- rewrite historical timestamps or other fields as a side effect.
create function public.archive_customer_jobs(p_tenant_id uuid, p_customer_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  archived_count integer;
  matched_count integer;
  history_changed boolean;
begin
  perform 1
  from public.customers
  where id = p_customer_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Customer does not belong to the selected tenant';
  end if;

  with original as materialized (
    select j.id, to_jsonb(j) - 'archived_at' as history
    from public.jobs j
    where j.tenant_id = p_tenant_id
      and j.customer_id = p_customer_id
      and j.archived_at is null
    for update
  ), archived as (
    update public.jobs j
    set archived_at = statement_timestamp()
    from original
    where j.id = original.id
      and j.tenant_id = p_tenant_id
      and j.customer_id = p_customer_id
      and j.archived_at is null
    returning to_jsonb(j) - 'archived_at' is distinct from original.history
      or j.archived_at is null as history_changed
  )
  select count(*)::integer, (select count(*) from original),
    coalesce(bool_or(a.history_changed), false)
  into archived_count, matched_count, history_changed
  from archived a;

  if history_changed or archived_count <> matched_count then
    raise exception 'Archiving would change historical job fields';
  end if;

  return archived_count;
end;
$$;

revoke execute on function public.archive_customer_jobs(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.archive_customer_jobs(uuid, uuid)
  to service_role;
