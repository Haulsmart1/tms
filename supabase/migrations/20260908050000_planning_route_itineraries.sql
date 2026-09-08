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
    job_id uuid not null references public.jobs(id)
        on delete cascade,
    stop_id uuid not null references public.job_stops(id)
        on delete cascade,
    lat double precision not null,
    lng double precision not null,
    created_at timestamptz not null default now(),

    constraint planning_route_visits_sequence_positive
        check (sequence_number >= 1),

    constraint planning_route_visits_lat_check
        check (lat between -90 and 90),

    constraint planning_route_visits_lng_check
        check (lng between -180 and 180),

    constraint planning_route_visits_itinerary_sequence_key
        unique (itinerary_id, sequence_number),

    constraint planning_route_visits_tenant_itinerary_fkey
        foreign key (tenant_id, itinerary_id)
        references public.planning_route_itineraries (tenant_id, id)
        on delete cascade
);

comment on table public.planning_route_visits is
    'Ordered physical collection/delivery service visits for a canonical planning itinerary.';

comment on column public.planning_route_visits.sequence_number is
    'Authoritative physical visit order: 1 is the first collection/drop after the vehicle start.';


create index planning_route_itineraries_tenant_date_idx
    on public.planning_route_itineraries (tenant_id, planning_date);

create index planning_route_itineraries_vehicle_idx
    on public.planning_route_itineraries (vehicle_id);

create index planning_route_visits_tenant_itinerary_idx
    on public.planning_route_visits (tenant_id, itinerary_id);

create index planning_route_visits_job_idx
    on public.planning_route_visits (job_id);

create index planning_route_visits_stop_idx
    on public.planning_route_visits (stop_id);


alter table public.planning_route_itineraries enable row level security;
alter table public.planning_route_visits enable row level security;


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


revoke all on public.planning_route_itineraries from anon;
revoke all on public.planning_route_visits from anon;

revoke insert, update, delete
    on public.planning_route_itineraries
    from authenticated;

revoke insert, update, delete
    on public.planning_route_visits
    from authenticated;

grant select
    on public.planning_route_itineraries
    to authenticated;

grant select
    on public.planning_route_visits
    to authenticated;

grant select, insert, update, delete
    on public.planning_route_itineraries
    to service_role;

grant select, insert, update, delete
    on public.planning_route_visits
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
    v_visit jsonb;
    v_sequence integer;
    v_job_id uuid;
    v_stop_id uuid;
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
     * Validate every supplied physical service visit before replacing the
     * previous itinerary. The entire function call is transactional.
     */
    v_sequence := 0;

    for v_visit in
        select value
        from jsonb_array_elements(p_visits)
    loop
        v_sequence := v_sequence + 1;

        if jsonb_typeof(v_visit) <> 'object' then
            raise exception 'Planning route visit % must be an object.',
                v_sequence
                using errcode = '22023';
        end if;

        begin
            v_job_id := nullif(btrim(v_visit ->> 'job_id'), '')::uuid;
            v_stop_id := nullif(btrim(v_visit ->> 'stop_id'), '')::uuid;
            v_lat := nullif(btrim(v_visit ->> 'lat'), '')::double precision;
            v_lng := nullif(btrim(v_visit ->> 'lng'), '')::double precision;
        exception
            when invalid_text_representation
              or numeric_value_out_of_range then
                raise exception 'Planning route visit % is malformed.',
                    v_sequence
                    using errcode = '22023';
        end;

        if v_job_id is null
           or v_stop_id is null
           or v_lat is null
           or v_lng is null then
            raise exception 'Planning route visit % is incomplete.',
                v_sequence
                using errcode = '22023';
        end if;

        if v_lat = 'NaN'::double precision
           or v_lng = 'NaN'::double precision
           or v_lat < -90
           or v_lat > 90
           or v_lng < -180
           or v_lng > 180 then
            raise exception 'Planning route visit % has invalid coordinates.',
                v_sequence
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
                'Planning route visit % does not belong to this tenant, vehicle, job and stop.',
                v_sequence
                using errcode = '42501';
        end if;
    end loop;

    /*
     * Upsert the lane/date itinerary. The unique key ensures all replacements
     * for one vehicle/date address the same parent row.
     */
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
     * Serialize concurrent replacements for this exact parent.
     */
    perform 1
    from public.planning_route_itineraries
    where id = v_itinerary_id
      and tenant_id = p_tenant_id
    for update;

    delete from public.planning_route_visits
    where tenant_id = p_tenant_id
      and itinerary_id = v_itinerary_id;

    v_sequence := 0;

    for v_visit in
        select value
        from jsonb_array_elements(p_visits)
    loop
        v_sequence := v_sequence + 1;

        v_job_id := nullif(btrim(v_visit ->> 'job_id'), '')::uuid;
        v_stop_id := nullif(btrim(v_visit ->> 'stop_id'), '')::uuid;
        v_lat := nullif(btrim(v_visit ->> 'lat'), '')::double precision;
        v_lng := nullif(btrim(v_visit ->> 'lng'), '')::double precision;

        insert into public.planning_route_visits (
            tenant_id,
            itinerary_id,
            sequence_number,
            job_id,
            stop_id,
            lat,
            lng
        )
        values (
            p_tenant_id,
            v_itinerary_id,
            v_sequence,
            v_job_id,
            v_stop_id,
            v_lat,
            v_lng
        );
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
    'Atomically validates and replaces one tenant vehicle/date physical planning itinerary.';

comment on function public.invalidate_planning_route_itinerary(
    uuid,
    date,
    uuid
) is
    'Deletes a canonical physical itinerary after a manual planning change.';


notify pgrst, 'reload schema';

commit;
