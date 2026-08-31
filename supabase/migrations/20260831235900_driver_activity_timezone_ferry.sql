-- Planning compliance activity/timezone/ferry foundation.
--
-- driver_activity_logs is empty in Production at the time this migration was
-- designed. Refuse to reinterpret populated timestamp-without-time-zone data:
-- a populated environment needs an explicit provenance decision instead.
do $$
declare
    v_has_rows boolean;
    v_start_type text;
begin
    select exists (
        select 1
        from public.driver_activity_logs
        limit 1
    )
    into v_has_rows;

    select c.data_type
    into v_start_type
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'driver_activity_logs'
      and c.column_name = 'start_time';

    if v_start_type = 'timestamp without time zone' and v_has_rows then
        raise exception
            'driver_activity_logs contains rows; refusing automatic timestamp reinterpretation';
    end if;
end
$$;

do $$
declare
    v_start_type text;
    v_end_type text;
    v_created_type text;
    v_duration_generated text;
    v_duration_expression text;
    v_duration_expression_normalized text;
    v_recreate_generated_duration boolean := false;
begin
    select c.data_type
    into v_start_type
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'driver_activity_logs'
      and c.column_name = 'start_time';

    select c.data_type
    into v_end_type
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'driver_activity_logs'
      and c.column_name = 'end_time';

    if v_start_type is null or v_end_type is null then
        raise exception
            'driver_activity_logs start_time/end_time columns are missing';
    end if;

    if v_start_type = 'timestamp without time zone'
       or v_end_type = 'timestamp without time zone'
    then
        if v_start_type <> 'timestamp without time zone'
           or v_end_type <> 'timestamp without time zone'
        then
            raise exception
                'driver_activity_logs timestamp types are inconsistent: start_time=%, end_time=%',
                v_start_type,
                v_end_type;
        end if;

        select
            c.is_generated,
            c.generation_expression
        into
            v_duration_generated,
            v_duration_expression
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'driver_activity_logs'
          and c.column_name = 'duration_minutes';

        if v_duration_generated is null then
            raise exception
                'driver_activity_logs.duration_minutes is missing';
        end if;

        if v_duration_generated = 'ALWAYS' then
            v_duration_expression_normalized :=
                regexp_replace(
                    lower(v_duration_expression),
                    '[[:space:]]+',
                    '',
                    'g'
                );

            if v_duration_expression_normalized <>
                '(extract(epochfrom(end_time-start_time))/(60)::numeric)'
            then
                raise exception
                    'unexpected generated duration_minutes expression: %',
                    v_duration_expression;
            end if;

            alter table public.driver_activity_logs
                drop column duration_minutes;

            v_recreate_generated_duration := true;

        elsif v_duration_generated <> 'NEVER' then
            raise exception
                'unexpected duration_minutes generated state: %',
                v_duration_generated;
        end if;

        alter table public.driver_activity_logs
            alter column start_time type timestamptz
            using start_time at time zone 'UTC';

        alter table public.driver_activity_logs
            alter column end_time type timestamptz
            using end_time at time zone 'UTC';

        if v_recreate_generated_duration then
            alter table public.driver_activity_logs
                add column duration_minutes integer
                generated always as (
                    extract(epoch from (end_time - start_time))
                    / (60)::numeric
                ) stored;
        end if;
    elsif v_start_type <> 'timestamp with time zone'
       or v_end_type <> 'timestamp with time zone'
    then
        raise exception
            'unexpected driver_activity_logs timestamp types: start_time=%, end_time=%',
            v_start_type,
            v_end_type;
    end if;

    select c.data_type
    into v_created_type
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'driver_activity_logs'
      and c.column_name = 'created_at';

    if v_created_type = 'timestamp without time zone' then
        alter table public.driver_activity_logs
            alter column created_at type timestamptz
            using created_at at time zone 'UTC';
    elsif v_created_type <> 'timestamp with time zone' then
        raise exception
            'unexpected driver_activity_logs.created_at type: %',
            v_created_type;
    end if;
end
$$;

alter table public.driver_activity_logs
    alter column created_at set default now(),
    add column if not exists activity_kind text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.driver_activity_logs'::regclass
          and conname = 'driver_activity_logs_activity_kind_valid'
    ) then
        alter table public.driver_activity_logs
            add constraint driver_activity_logs_activity_kind_valid
            check (
                activity_kind is null
                or activity_kind in (
                    'driving',
                    'other_work',
                    'availability',
                    'break',
                    'rest',
                    'unknown'
                )
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.driver_activity_logs'::regclass
          and conname = 'driver_activity_logs_time_order_valid'
    ) then
        alter table public.driver_activity_logs
            add constraint driver_activity_logs_time_order_valid
            check (end_time > start_time);
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.driver_activity_logs'::regclass
          and conname = 'driver_activity_logs_duration_nonnegative'
    ) then
        alter table public.driver_activity_logs
            add constraint driver_activity_logs_duration_nonnegative
            check (duration_minutes is null or duration_minutes >= 0);
    end if;
end
$$;

create table if not exists public.driver_transport_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on update cascade on delete restrict,
    driver_id uuid not null references public.drivers(id) on delete restrict,
    vehicle_id uuid references public.vehicles(id) on delete set null,

    mode text not null,

    boarding_time timestamptz not null,
    departure_time timestamptz,
    arrival_time timestamptz,
    disembark_time timestamptz not null,

    scheduled_crossing_minutes integer,
    sleeper_available boolean,
    intended_rest_type text not null default 'unknown',

    notes text,
    created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'driver_transport_events_tenant_id_id_key'
      and conrelid = 'public.driver_transport_events'::regclass
  ) then
    alter table public.driver_transport_events
      add constraint driver_transport_events_tenant_id_id_key
      unique (tenant_id, id);
  end if;
end
$$;


create table if not exists public.driver_transport_interruptions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    transport_event_id uuid not null,

    start_time timestamptz not null,
    end_time timestamptz not null,
    reason text not null,

    notes text,
    created_at timestamptz not null default now()
);

-- driver_transport_interruptions_legacy_event_fk_cleanup
-- If an earlier/partial execution created a single-column
-- transport_event_id -> driver_transport_events(id) FK, remove only that
-- exact relationship before enforcing the tenant-safe composite FK.
do $$
declare
    v_constraint_name text;
begin
    for v_constraint_name in
        select c.conname
        from pg_constraint c
        where c.contype = 'f'
          and c.conrelid =
              'public.driver_transport_interruptions'::regclass
          and c.confrelid =
              'public.driver_transport_events'::regclass
          and array_length(c.conkey, 1) = 1
          and array_length(c.confkey, 1) = 1
          and c.conkey[1] = (
              select a.attnum
              from pg_attribute a
              where a.attrelid =
                  'public.driver_transport_interruptions'::regclass
                and a.attname = 'transport_event_id'
                and not a.attisdropped
          )
          and c.confkey[1] = (
              select a.attnum
              from pg_attribute a
              where a.attrelid =
                  'public.driver_transport_events'::regclass
                and a.attname = 'id'
                and not a.attisdropped
          )
    loop
        execute format(
            'alter table public.driver_transport_interruptions drop constraint %I',
            v_constraint_name
        );
    end loop;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'driver_transport_interruptions_tenant_event_fkey'
      and conrelid = 'public.driver_transport_interruptions'::regclass
  ) then
    alter table public.driver_transport_interruptions
      add constraint driver_transport_interruptions_tenant_event_fkey
      foreign key (tenant_id, transport_event_id)
      references public.driver_transport_events (tenant_id, id)
      on delete cascade;
  end if;
end
$$;


do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.driver_transport_events'::regclass
          and conname = 'driver_transport_events_mode_valid'
    ) then
        alter table public.driver_transport_events
            add constraint driver_transport_events_mode_valid
            check (mode in ('ferry', 'train'));
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.driver_transport_events'::regclass
          and conname = 'driver_transport_events_rest_type_valid'
    ) then
        alter table public.driver_transport_events
            add constraint driver_transport_events_rest_type_valid
            check (
                intended_rest_type in (
                    'regular_daily',
                    'split_daily',
                    'regular_weekly',
                    'none',
                    'unknown'
                )
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.driver_transport_events'::regclass
          and conname = 'driver_transport_events_time_order_valid'
    ) then
        alter table public.driver_transport_events
            add constraint driver_transport_events_time_order_valid
            check (
                disembark_time > boarding_time
                and (
                    departure_time is null
                    or departure_time >= boarding_time
                )
                and (
                    arrival_time is null
                    or arrival_time <= disembark_time
                )
                and (
                    departure_time is null
                    or arrival_time is null
                    or arrival_time >= departure_time
                )
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.driver_transport_events'::regclass
          and conname = 'driver_transport_events_scheduled_minutes_positive'
    ) then
        alter table public.driver_transport_events
            add constraint driver_transport_events_scheduled_minutes_positive
            check (
                scheduled_crossing_minutes is null
                or scheduled_crossing_minutes > 0
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.driver_transport_interruptions'::regclass
          and conname = 'driver_transport_interruptions_reason_valid'
    ) then
        alter table public.driver_transport_interruptions
            add constraint driver_transport_interruptions_reason_valid
            check (
                reason in (
                    'embark',
                    'disembark',
                    'vehicle_movement',
                    'border',
                    'other'
                )
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.driver_transport_interruptions'::regclass
          and conname = 'driver_transport_interruptions_time_order_valid'
    ) then
        alter table public.driver_transport_interruptions
            add constraint driver_transport_interruptions_time_order_valid
            check (end_time > start_time);
    end if;
end
$$;

create index if not exists driver_activity_logs_tenant_driver_start_idx
    on public.driver_activity_logs (tenant_id, driver_id, start_time);

create index if not exists driver_transport_events_tenant_driver_boarding_idx
    on public.driver_transport_events (tenant_id, driver_id, boarding_time);

create index if not exists driver_transport_interruptions_event_start_idx
    on public.driver_transport_interruptions (transport_event_id, start_time);

alter table public.driver_transport_events enable row level security;
alter table public.driver_transport_interruptions enable row level security;

drop policy if exists driver_transport_events_tenant on public.driver_transport_events;

create policy driver_transport_events_tenant
on public.driver_transport_events
for select
to authenticated
using (public.can_access_tenant(tenant_id));

drop policy if exists driver_transport_interruptions_tenant
on public.driver_transport_interruptions;

create policy driver_transport_interruptions_tenant
on public.driver_transport_interruptions
for select
to authenticated
using (public.can_access_tenant(tenant_id));

-- Ferry/train compliance records are readable by authenticated tenant users.
-- Mutations are intentionally reserved for trusted server/service-role paths.
grant select
on public.driver_transport_events
to authenticated;

grant select
on public.driver_transport_interruptions
to authenticated;

grant select, insert, update, delete
on public.driver_transport_events
to service_role;

grant select, insert, update, delete
on public.driver_transport_interruptions
to service_role;

comment on column public.driver_activity_logs.activity_kind is
    'Normalized compliance activity; activity_type remains the source/raw label.';

comment on table public.driver_transport_events is
    'Ferry/train crossing facts used for drivers-hours compliance evaluation.';

comment on column public.driver_transport_events.sleeper_available is
    'Whether the required sleeper/cabin accommodation was available; null means unknown.';

comment on column public.driver_transport_events.intended_rest_type is
    'Operator/imported rest intention. Compliance eligibility is calculated, not stored.';

comment on table public.driver_transport_interruptions is
    'Interruptions occurring during a ferry/train-associated rest period.';

notify pgrst, 'reload schema';
