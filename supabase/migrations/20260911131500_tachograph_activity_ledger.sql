alter table public.driver_activity_logs
    add column if not exists source_kind text not null default 'legacy',
    add column if not exists source_provider text,
    add column if not exists external_activity_id text,
    add column if not exists import_batch_id uuid,
    add column if not exists imported_at timestamptz,
    add column if not exists updated_at timestamptz not null default now();

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.driver_activity_logs'::regclass
          and conname = 'driver_activity_logs_source_kind_valid'
    ) then
        alter table public.driver_activity_logs
            add constraint driver_activity_logs_source_kind_valid
            check (
                source_kind in (
                    'legacy',
                    'manual',
                    'tachograph_file',
                    'tachograph_api'
                )
            );
    end if;
end
$$;

create unique index if not exists
    driver_activity_logs_provider_external_unique
on public.driver_activity_logs (
    tenant_id,
    source_provider,
    external_activity_id
)
where
    source_provider is not null
    and external_activity_id is not null
    and source_kind in ('tachograph_file', 'tachograph_api');

create table if not exists public.tachograph_sync_runs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    driver_id uuid,
    provider_id text not null,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    status text not null default 'running',
    records_received integer not null default 0,
    records_inserted integer not null default 0,
    records_skipped integer not null default 0,
    records_failed integer not null default 0,
    cursor_value text,
    error_message text,
    created_at timestamptz not null default now()
);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.tachograph_sync_runs'::regclass
          and conname = 'tachograph_sync_runs_status_valid'
    ) then
        alter table public.tachograph_sync_runs
            add constraint tachograph_sync_runs_status_valid
            check (status in ('running', 'success', 'partial', 'failed'));
    end if;
end
$$;

create index if not exists tachograph_sync_runs_tenant_started_idx
    on public.tachograph_sync_runs (tenant_id, started_at desc);

alter table public.tachograph_sync_runs enable row level security;

drop policy if exists tachograph_sync_runs_select_tenant
    on public.tachograph_sync_runs;

create policy tachograph_sync_runs_select_tenant
    on public.tachograph_sync_runs
    for select
    to authenticated
    using (public.can_access_tenant(tenant_id));

revoke all on public.tachograph_sync_runs from anon;
revoke insert, update, delete
    on public.tachograph_sync_runs
    from authenticated;

grant select
    on public.tachograph_sync_runs
    to authenticated;

grant select, insert, update, delete
    on public.tachograph_sync_runs
    to service_role;


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
set search_path = pg_catalog, public
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

    if not exists (
        select 1
        from public.memberships m
        where m.tenant_id = p_tenant_id
          and m.user_id = auth.uid()
          and m.role in ('admin', 'super_admin')
    ) then
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
set search_path = pg_catalog, public
as $$
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    if not public.can_access_tenant(p_tenant_id) then
        raise exception 'tenant access denied';
    end if;

    if not exists (
        select 1
        from public.memberships m
        where m.tenant_id = p_tenant_id
          and m.user_id = auth.uid()
          and m.role in ('admin', 'super_admin')
    ) then
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

revoke all on function public.upsert_manual_driver_activity(
    uuid,
    uuid,
    uuid,
    text,
    text,
    timestamptz,
    timestamptz
) from public;

revoke all on function public.delete_manual_driver_activity(
    uuid,
    uuid
) from public;

grant execute on function public.upsert_manual_driver_activity(
    uuid,
    uuid,
    uuid,
    text,
    text,
    timestamptz,
    timestamptz
) to authenticated;

grant execute on function public.delete_manual_driver_activity(
    uuid,
    uuid
) to authenticated;

comment on column public.driver_activity_logs.source_kind is
    'Provenance of the activity record: legacy, manual, file import, or API import.';

comment on column public.driver_activity_logs.external_activity_id is
    'Provider activity identifier used for idempotent tachograph imports.';

comment on table public.tachograph_sync_runs is
    'Audit history for tachograph provider/file synchronisation attempts.';

notify pgrst, 'reload schema';
