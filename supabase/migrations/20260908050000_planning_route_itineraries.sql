begin;

create table public.planning_route_itineraries (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id)
        on update cascade
        on delete restrict,
    planning_date date not null,
    vehicle_id uuid not null references public.vehicles(id)
        on delete restrict,
    driver_id uuid references public.drivers(id)
        on delete set null,
    source text not null default 'smart_optimize',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint planning_route_itineraries_source_check
        check (source = 'smart_optimize'),

    constraint planning_route_itineraries_tenant_date_vehicle_key
        unique (tenant_id, planning_date, vehicle_id),

    constraint planning_route_itineraries_tenant_id_id_key
        unique (tenant_id, id)
);

comment on table public.planning_route_itineraries is
    'Canonical optimized physical route for one tenant, planning date and vehicle.';

comment on column public.planning_route_itineraries.source is
    'How the canonical itinerary was produced; currently smart_optimize only.';


create table public.planning_route_visits (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    itinerary_id uuid not null,
    sequence_number integer not null,
    lat double precision not null,
    lng double precision not null,
    created_at timestamptz not null default now(),

    constraint planning_route_visits_sequence_positive
        check (sequence_number >= 1),

    constraint planning_route_visits_lat_check
        check (
            lat <> 'NaN'::double precision
            and lat between -90 and 90
        ),

    constraint planning_route_visits_lng_check
        check (
            lng <> 'NaN'::double precision
            and lng between -180 and 180
        ),

    constraint planning_route_visits_itinerary_sequence_key
        unique (itinerary_id, sequence_number),

    constraint planning_route_visits_tenant_itinerary_id_key
        unique (tenant_id, itinerary_id, id),

    constraint planning_route_visits_tenant_itinerary_fkey
        foreign key (tenant_id, itinerary_id)
        references public.planning_route_itineraries (tenant_id, id)
        on delete cascade
);

comment on table public.planning_route_visits is
    'Ordered physical travel locations in a canonical planning itinerary.';

comment on column public.planning_route_visits.sequence_number is
    'Authoritative physical travel order; one visit may contain multiple service stops.';


create table public.planning_route_visit_stops (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    itinerary_id uuid not null,
    visit_id uuid not null,
    service_sequence_number integer not null,
    visit_service_order integer not null,
    job_id uuid not null references public.jobs(id)
        on delete cascade,
    stop_id uuid not null references public.job_stops(id)
        on delete cascade,
    service_seconds integer not null default 600,
    created_at timestamptz not null default now(),

    constraint planning_route_visit_stops_service_sequence_positive
        check (service_sequence_number >= 1),

    constraint planning_route_visit_stops_visit_service_order_positive
        check (visit_service_order >= 1),

    constraint planning_route_visit_stops_service_seconds_check
        check (service_seconds = 600),

    constraint planning_route_visit_stops_itinerary_service_sequence_key
        unique (itinerary_id, service_sequence_number),

    constraint planning_route_visit_stops_itinerary_stop_key
        unique (itinerary_id, stop_id),

    constraint planning_route_visit_stops_visit_service_order_key
        unique (visit_id, visit_service_order),

    constraint planning_route_visit_stops_tenant_itinerary_visit_fkey
        foreign key (tenant_id, itinerary_id, visit_id)
        references public.planning_route_visits (tenant_id, itinerary_id, id)
        on delete cascade
);

comment on table public.planning_route_visit_stops is
    'Ordered collection/delivery services performed at physical planning route visits.';

comment on column public.planning_route_visit_stops.service_sequence_number is
    'Authoritative global service order across the itinerary.';

comment on column public.planning_route_visit_stops.visit_service_order is
    'Authoritative service order within one physical visit.';

comment on column public.planning_route_visit_stops.service_seconds is
    'Planning service duration for every actual collection/delivery; fixed at 600 seconds.';


create index planning_route_itineraries_tenant_date_idx
    on public.planning_route_itineraries (tenant_id, planning_date);

create index planning_route_itineraries_vehicle_idx
    on public.planning_route_itineraries (vehicle_id);

create index planning_route_visits_tenant_itinerary_idx
    on public.planning_route_visits (tenant_id, itinerary_id);

create index planning_route_visit_stops_tenant_itinerary_idx
    on public.planning_route_visit_stops (tenant_id, itinerary_id);

create index planning_route_visit_stops_visit_idx
    on public.planning_route_visit_stops (visit_id);

create index planning_route_visit_stops_job_idx
    on public.planning_route_visit_stops (job_id);

create index planning_route_visit_stops_stop_idx
    on public.planning_route_visit_stops (stop_id);


alter table public.planning_route_itineraries enable row level security;
alter table public.planning_route_visits enable row level security;
alter table public.planning_route_visit_stops enable row level security;


create policy planning_route_itineraries_select_tenant
    on public.planning_route_itineraries
    for select
    to authenticated
    using (public.can_access_tenant(tenant_id));

create policy planning_route_visits_select_tenant
    on public.planning_route_visits
    for select
    to authenticated
    using (public.can_access_tenant(tenant_id));

create policy planning_route_visit_stops_select_tenant
    on public.planning_route_visit_stops
    for select
    to authenticated
    using (public.can_access_tenant(tenant_id));


revoke all on public.planning_route_itineraries from anon;
revoke all on public.planning_route_visits from anon;
revoke all on public.planning_route_visit_stops from anon;

revoke insert, update, delete
    on public.planning_route_itineraries
    from authenticated;

revoke insert, update, delete
    on public.planning_route_visits
    from authenticated;

revoke insert, update, delete
    on public.planning_route_visit_stops
    from authenticated;

grant select
    on public.planning_route_itineraries
    to authenticated;

grant select
    on public.planning_route_visits
    to authenticated;

grant select
    on public.planning_route_visit_stops
    to authenticated;

grant select, insert, update, delete
    on public.planning_route_itineraries
    to service_role;

grant select, insert, update, delete
    on public.planning_route_visits
    to service_role;

grant select, insert, update, delete
    on public.planning_route_visit_stops
    to service_role;


create or replace function public.replace_planning_route_itinerary(
    p_tenant_id uuid,
    p_planning_date date,
    p_vehicle_id uuid,
    p_driver_id uuid,
    p_visits jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_itinerary_id uuid;
    v_visit_id uuid;
    v_visit jsonb;
    v_service jsonb;
    v_visit_sequence integer;
    v_service_sequence integer;
    v_visit_service_order integer;
    v_job_id uuid;
    v_stop_id uuid;
    v_service_seconds integer;
    v_lat double precision;
    v_lng double precision;
begin
    if p_tenant_id is null then
        raise exception 'Tenant is required.'
            using errcode = '22004';
    end if;

    if not public.can_access_tenant(p_tenant_id) then
        raise exception 'Not permitted to modify this tenant.'
            using errcode = '42501';
    end if;

    if p_planning_date is null then
        raise exception 'Planning date is required.'
            using errcode = '22004';
    end if;

    if p_vehicle_id is null then
        raise exception 'Vehicle is required.'
            using errcode = '22004';
    end if;

    if p_visits is null
       or jsonb_typeof(p_visits) <> 'array'
       or jsonb_array_length(p_visits) = 0 then
        raise exception 'At least one planning route visit is required.'
            using errcode = '22023';
    end if;

    if not exists (
        select 1
        from public.vehicles v
        where v.id = p_vehicle_id
          and v.tenant_id = p_tenant_id
    ) then
        raise exception 'Vehicle does not belong to this tenant.'
            using errcode = '42501';
    end if;

    if p_driver_id is not null
       and not exists (
           select 1
           from public.drivers d
           where d.id = p_driver_id
             and d.tenant_id = p_tenant_id
       ) then
        raise exception 'Driver does not belong to this tenant.'
            using errcode = '42501';
    end if;

    /*
     * Validate the complete nested physical itinerary before replacing
     * anything. A physical visit can contain multiple collection/delivery
     * services, but every actual service is globally ordered and is 600s.
     */
    v_visit_sequence := 0;
    v_service_sequence := 0;

    for v_visit in
        select value
        from jsonb_array_elements(p_visits)
    loop
        v_visit_sequence := v_visit_sequence + 1;

        if jsonb_typeof(v_visit) <> 'object' then
            raise exception 'Planning route visit % must be an object.',
                v_visit_sequence
                using errcode = '22023';
        end if;

        begin
            v_lat := nullif(btrim(v_visit ->> 'lat'), '')::double precision;
            v_lng := nullif(btrim(v_visit ->> 'lng'), '')::double precision;
        exception
            when invalid_text_representation
              or numeric_value_out_of_range then
                raise exception 'Planning route visit % is malformed.',
                    v_visit_sequence
                    using errcode = '22023';
        end;

        if v_lat is null or v_lng is null then
            raise exception 'Planning route visit % is incomplete.',
                v_visit_sequence
                using errcode = '22023';
        end if;

        if v_lat = 'NaN'::double precision
           or v_lng = 'NaN'::double precision
           or v_lat < -90
           or v_lat > 90
           or v_lng < -180
           or v_lng > 180 then
            raise exception 'Planning route visit % has invalid coordinates.',
                v_visit_sequence
                using errcode = '22023';
        end if;

        if not (v_visit ? 'service_stops')
           or jsonb_typeof(v_visit -> 'service_stops') <> 'array'
           or jsonb_array_length(v_visit -> 'service_stops') = 0 then
            raise exception
                'Planning route visit % requires at least one service stop.',
                v_visit_sequence
                using errcode = '22023';
        end if;

        v_visit_service_order := 0;

        for v_service in
            select value
            from jsonb_array_elements(v_visit -> 'service_stops')
        loop
            v_visit_service_order := v_visit_service_order + 1;
            v_service_sequence := v_service_sequence + 1;

            if jsonb_typeof(v_service) <> 'object' then
                raise exception
                    'Planning service % at visit % must be an object.',
                    v_visit_service_order,
                    v_visit_sequence
                    using errcode = '22023';
            end if;

            begin
                v_job_id :=
                    nullif(btrim(v_service ->> 'job_id'), '')::uuid;

                v_stop_id :=
                    nullif(btrim(v_service ->> 'stop_id'), '')::uuid;

                v_service_seconds :=
                    coalesce(
                        nullif(
                            btrim(v_service ->> 'service_seconds'),
                            ''
                        )::integer,
                        600
                    );
            exception
                when invalid_text_representation
                  or numeric_value_out_of_range then
                    raise exception
                        'Planning service % at visit % is malformed.',
                        v_visit_service_order,
                        v_visit_sequence
                        using errcode = '22023';
            end;

            if v_job_id is null or v_stop_id is null then
                raise exception
                    'Planning service % at visit % is incomplete.',
                    v_visit_service_order,
                    v_visit_sequence
                    using errcode = '22023';
            end if;

            if v_service_seconds <> 600 then
                raise exception
                    'Planning service % at visit % must consume 600 seconds.',
                    v_visit_service_order,
                    v_visit_sequence
                    using errcode = '22023';
            end if;

            if not exists (
                select 1
                from public.jobs j
                join public.job_stops s
                  on s.job_id = j.id
                 and s.tenant_id = p_tenant_id
                where j.id = v_job_id
                  and j.tenant_id = p_tenant_id
                  and j.vehicle_id = p_vehicle_id
                  and s.id = v_stop_id
            ) then
                raise exception
                    'Planning service % at visit % does not belong to this tenant, vehicle, job and stop.',
                    v_visit_service_order,
                    v_visit_sequence
                    using errcode = '42501';
            end if;
        end loop;
    end loop;

    insert into public.planning_route_itineraries (
        tenant_id,
        planning_date,
        vehicle_id,
        driver_id,
        source,
        updated_at
    )
    values (
        p_tenant_id,
        p_planning_date,
        p_vehicle_id,
        p_driver_id,
        'smart_optimize',
        now()
    )
    on conflict (tenant_id, planning_date, vehicle_id)
    do update set
        driver_id = excluded.driver_id,
        source = excluded.source,
        updated_at = now()
    returning id into v_itinerary_id;

    /*
     * Serialize replacements for this exact vehicle/date itinerary.
     */
    perform 1
    from public.planning_route_itineraries
    where id = v_itinerary_id
      and tenant_id = p_tenant_id
    for update;

    /*
     * Cascading visit deletion removes the previous nested service rows.
     */
    delete from public.planning_route_visits
    where tenant_id = p_tenant_id
      and itinerary_id = v_itinerary_id;

    v_visit_sequence := 0;
    v_service_sequence := 0;

    for v_visit in
        select value
        from jsonb_array_elements(p_visits)
    loop
        v_visit_sequence := v_visit_sequence + 1;

        v_lat := nullif(btrim(v_visit ->> 'lat'), '')::double precision;
        v_lng := nullif(btrim(v_visit ->> 'lng'), '')::double precision;

        insert into public.planning_route_visits (
            tenant_id,
            itinerary_id,
            sequence_number,
            lat,
            lng
        )
        values (
            p_tenant_id,
            v_itinerary_id,
            v_visit_sequence,
            v_lat,
            v_lng
        )
        returning id into v_visit_id;

        v_visit_service_order := 0;

        for v_service in
            select value
            from jsonb_array_elements(v_visit -> 'service_stops')
        loop
            v_visit_service_order := v_visit_service_order + 1;
            v_service_sequence := v_service_sequence + 1;

            v_job_id :=
                nullif(btrim(v_service ->> 'job_id'), '')::uuid;

            v_stop_id :=
                nullif(btrim(v_service ->> 'stop_id'), '')::uuid;

            v_service_seconds :=
                coalesce(
                    nullif(
                        btrim(v_service ->> 'service_seconds'),
                        ''
                    )::integer,
                    600
                );

            insert into public.planning_route_visit_stops (
                tenant_id,
                itinerary_id,
                visit_id,
                service_sequence_number,
                visit_service_order,
                job_id,
                stop_id,
                service_seconds
            )
            values (
                p_tenant_id,
                v_itinerary_id,
                v_visit_id,
                v_service_sequence,
                v_visit_service_order,
                v_job_id,
                v_stop_id,
                v_service_seconds
            );
        end loop;
    end loop;

    return v_itinerary_id;
end;
$$;


create or replace function public.invalidate_planning_route_itinerary(
    p_tenant_id uuid,
    p_planning_date date,
    p_vehicle_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_deleted integer;
begin
    if p_tenant_id is null then
        raise exception 'Tenant is required.'
            using errcode = '22004';
    end if;

    if not public.can_access_tenant(p_tenant_id) then
        raise exception 'Not permitted to modify this tenant.'
            using errcode = '42501';
    end if;

    if p_planning_date is null or p_vehicle_id is null then
        raise exception 'Planning date and vehicle are required.'
            using errcode = '22004';
    end if;

    delete from public.planning_route_itineraries
    where tenant_id = p_tenant_id
      and planning_date = p_planning_date
      and vehicle_id = p_vehicle_id;

    get diagnostics v_deleted = row_count;

    return v_deleted > 0;
end;
$$;


revoke all on function public.replace_planning_route_itinerary(
    uuid,
    date,
    uuid,
    uuid,
    jsonb
) from public;

revoke all on function public.invalidate_planning_route_itinerary(
    uuid,
    date,
    uuid
) from public;

grant execute on function public.replace_planning_route_itinerary(
    uuid,
    date,
    uuid,
    uuid,
    jsonb
) to authenticated;

grant execute on function public.invalidate_planning_route_itinerary(
    uuid,
    date,
    uuid
) to authenticated;

grant execute on function public.replace_planning_route_itinerary(
    uuid,
    date,
    uuid,
    uuid,
    jsonb
) to service_role;

grant execute on function public.invalidate_planning_route_itinerary(
    uuid,
    date,
    uuid
) to service_role;


comment on function public.replace_planning_route_itinerary(
    uuid,
    date,
    uuid,
    uuid,
    jsonb
) is
    'Atomically validates and replaces one tenant vehicle/date canonical physical itinerary with nested ordered service stops.';

comment on function public.invalidate_planning_route_itinerary(
    uuid,
    date,
    uuid
) is
    'Deletes a canonical physical itinerary after a manual planning change.';


notify pgrst, 'reload schema';

commit;
