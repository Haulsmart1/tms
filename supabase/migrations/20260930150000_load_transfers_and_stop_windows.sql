-- Stop appointment windows and serialized-item physical vehicle custody.
--
-- Physical custody is deliberately separate from:
--   * jobs.vehicle_id / jobs.driver_id (planning)
--   * vehicle_assignments (operational driver assignment)
--   * driver_shifts / shift_vehicle_periods (shift history)
--   * load_scan_events (whole-manifest custody events)
--
-- This migration does not automatically reassign jobs, drivers or shifts.

alter table public.job_stops
  add column if not exists booked_from timestamptz,
  add column if not exists booked_to timestamptz;

alter table public.job_stops
  drop constraint if exists job_stops_booked_window_check;

alter table public.job_stops
  add constraint job_stops_booked_window_check
  check (
    booked_from is null
    or booked_to is null
    or booked_to >= booked_from
  );

create table public.job_item_vehicle_custody (
  tenant_id uuid not null,
  job_id uuid not null
    references public.jobs(id) on delete restrict,
  job_item_id uuid not null
    references public.job_items(id) on delete restrict,
  serial_number text not null,
  vehicle_id uuid not null
    references public.vehicles(id) on delete restrict,
  driver_id uuid
    references public.drivers(id) on delete restrict,
  source text not null
    check (source in ('manifest', 'transfer')),
  updated_by uuid
    references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),

  primary key (job_item_id, serial_number),

  constraint job_item_vehicle_custody_serial_check
    check (
      serial_number = btrim(serial_number)
      and length(serial_number) between 1 and 250
    )
);

create index job_item_vehicle_custody_tenant_vehicle_idx
  on public.job_item_vehicle_custody(tenant_id, vehicle_id);

create index job_item_vehicle_custody_tenant_job_idx
  on public.job_item_vehicle_custody(tenant_id, job_id);

create table public.load_transfer_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  source_vehicle_id uuid not null
    references public.vehicles(id) on delete restrict,
  destination_vehicle_id uuid not null
    references public.vehicles(id) on delete restrict,
  destination_driver_id uuid
    references public.drivers(id) on delete restrict,
  status text not null default 'staged'
    check (status in ('staged', 'confirmed', 'cancelled')),
  created_by uuid not null
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_by uuid
    references auth.users(id) on delete restrict,
  confirmed_at timestamptz,

  constraint load_transfer_batches_different_vehicle_check
    check (source_vehicle_id <> destination_vehicle_id),

  constraint load_transfer_batches_confirmation_check
    check (
      (
        status = 'confirmed'
        and confirmed_by is not null
        and confirmed_at is not null
      )
      or
      (
        status <> 'confirmed'
        and confirmed_by is null
        and confirmed_at is null
      )
    )
);

create index load_transfer_batches_tenant_created_idx
  on public.load_transfer_batches(tenant_id, created_at desc);

create table public.load_transfer_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  transfer_batch_id uuid not null
    references public.load_transfer_batches(id) on delete cascade,
  job_id uuid not null
    references public.jobs(id) on delete restrict,
  job_item_id uuid not null
    references public.job_items(id) on delete restrict,
  serial_number text not null,
  source_vehicle_id uuid not null
    references public.vehicles(id) on delete restrict,
  destination_vehicle_id uuid not null
    references public.vehicles(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint load_transfer_items_serial_check
    check (
      serial_number = btrim(serial_number)
      and length(serial_number) between 1 and 250
    ),

  unique (transfer_batch_id, job_item_id, serial_number)
);

create index load_transfer_items_tenant_batch_idx
  on public.load_transfer_items(tenant_id, transfer_batch_id);

create index load_transfer_items_serial_idx
  on public.load_transfer_items(
    tenant_id,
    job_item_id,
    serial_number
  );

alter table public.job_item_vehicle_custody enable row level security;
alter table public.load_transfer_batches enable row level security;
alter table public.load_transfer_items enable row level security;

create policy job_item_vehicle_custody_select_tenant
  on public.job_item_vehicle_custody
  for select
  to authenticated
  using (can_access_tenant(tenant_id));

create policy load_transfer_batches_select_tenant
  on public.load_transfer_batches
  for select
  to authenticated
  using (can_access_tenant(tenant_id));

create policy load_transfer_items_select_tenant
  on public.load_transfer_items
  for select
  to authenticated
  using (can_access_tenant(tenant_id));

revoke all on public.job_item_vehicle_custody from anon;
revoke all on public.load_transfer_batches from anon;
revoke all on public.load_transfer_items from anon;

grant select on public.job_item_vehicle_custody to authenticated;
grant select on public.load_transfer_batches to authenticated;
grant select on public.load_transfer_items to authenticated;

/*
 * Seed physical custody from the latest whole-manifest event for each
 * serialized item.
 *
 * Only a latest LOADED event establishes custody. UNLOADED items are not
 * seeded. jobs.vehicle_id is deliberately not used as physical evidence.
 */
with manifest_events as (
  select
    lm.tenant_id,
    lmi.job_id,
    lmi.job_item_id,
    lmi.serial_number,
    lm.vehicle_id,
    lm.driver_id,
    lse.event_type,
    lse.scanned_by,
    lse.scanned_at,
    row_number() over (
      partition by
        lm.tenant_id,
        lmi.job_item_id,
        lmi.serial_number
      order by lse.scanned_at desc, lse.id desc
    ) as event_rank
  from public.load_manifest_items lmi
  join public.load_manifests lm
    on lm.id = lmi.manifest_id
   and lm.tenant_id = lmi.tenant_id
  join public.load_scan_events lse
    on lse.manifest_id = lm.id
   and lse.tenant_id = lm.tenant_id
  where lmi.serial_number is not null
    and btrim(lmi.serial_number) <> ''
)
insert into public.job_item_vehicle_custody (
  tenant_id,
  job_id,
  job_item_id,
  serial_number,
  vehicle_id,
  driver_id,
  source,
  updated_by,
  updated_at
)
select
  tenant_id,
  job_id,
  job_item_id,
  btrim(serial_number),
  vehicle_id,
  driver_id,
  'manifest',
  scanned_by,
  scanned_at
from manifest_events
where event_rank = 1
  and event_type = 'loaded'
on conflict (job_item_id, serial_number) do nothing;

/*
 * Synchronize per-serial physical custody with future whole-manifest scans.
 *
 * This is additive: the historical load-manifest migration is not modified.
 *
 * A loaded event establishes custody on the scanned vehicle.
 * An unloaded event removes custody only if that item is still recorded on
 * the same vehicle, so a later explicit vehicle transfer is not erased.
 */
create or replace function public.sync_manifest_event_item_custody()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.event_type = 'loaded' then
    insert into public.job_item_vehicle_custody (
      tenant_id,
      job_id,
      job_item_id,
      serial_number,
      vehicle_id,
      driver_id,
      source,
      updated_by,
      updated_at
    )
    select
      new.tenant_id,
      lmi.job_id,
      lmi.job_item_id,
      btrim(lmi.serial_number),
      new.vehicle_id,
      new.driver_id,
      'manifest',
      new.scanned_by,
      new.scanned_at
    from public.load_manifest_items lmi
    where lmi.tenant_id = new.tenant_id
      and lmi.manifest_id = new.manifest_id
      and length(btrim(lmi.serial_number)) between 1 and 250
    on conflict (job_item_id, serial_number)
    do update
    set
      tenant_id = excluded.tenant_id,
      job_id = excluded.job_id,
      vehicle_id = excluded.vehicle_id,
      driver_id = excluded.driver_id,
      source = excluded.source,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
    where
      public.job_item_vehicle_custody.tenant_id = excluded.tenant_id
      and public.job_item_vehicle_custody.updated_at <= excluded.updated_at;

  elsif new.event_type = 'unloaded' then
    delete from public.job_item_vehicle_custody c
    using public.load_manifest_items lmi
    where lmi.tenant_id = new.tenant_id
      and lmi.manifest_id = new.manifest_id
      and c.tenant_id = new.tenant_id
      and c.job_id = lmi.job_id
      and c.job_item_id = lmi.job_item_id
      and c.serial_number = btrim(lmi.serial_number)
      and c.vehicle_id = new.vehicle_id
      and c.updated_at <= new.scanned_at;
  end if;

  return new;
end;
$function$;

revoke all on function public.sync_manifest_event_item_custody()
  from public;

revoke all on function public.sync_manifest_event_item_custody()
  from anon;

revoke all on function public.sync_manifest_event_item_custody()
  from authenticated;

drop trigger if exists load_scan_events_sync_item_custody
  on public.load_scan_events;

create trigger load_scan_events_sync_item_custody
after insert on public.load_scan_events
for each row
execute function public.sync_manifest_event_item_custody();

create or replace function public.create_and_confirm_load_transfer(
  p_tenant_id uuid,
  p_source_vehicle_id uuid,
  p_destination_vehicle_id uuid,
  p_destination_driver_id uuid,
  p_created_by uuid,
  p_items jsonb
)
returns table (
  transfer_batch_id uuid,
  transferred_item_count integer,
  affected_job_count integer,
  fully_moved_job_count integer,
  confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_batch_id uuid;
  v_item_count integer;
  v_affected_job_count integer;
  v_fully_moved_job_count integer;
  v_confirmed_at timestamptz;
begin
  if p_tenant_id is null
     or p_source_vehicle_id is null
     or p_destination_vehicle_id is null
     or p_created_by is null then
    raise exception 'Transfer identity fields are required.'
      using errcode = '22023';
  end if;

  if p_source_vehicle_id = p_destination_vehicle_id then
    raise exception 'Source and destination vehicles must differ.'
      using errcode = '23514';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'A load transfer requires at least one serialized item.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 1000 then
    raise exception 'A load transfer cannot contain more than 1000 serialized items.'
      using errcode = '22023';
  end if;

  perform 1
  from public.vehicles v
  where v.id = p_source_vehicle_id
    and v.tenant_id = p_tenant_id
  for key share;

  if not found then
    raise exception 'Source vehicle does not belong to this tenant.'
      using errcode = '23503';
  end if;

  perform 1
  from public.vehicles v
  where v.id = p_destination_vehicle_id
    and v.tenant_id = p_tenant_id
  for key share;

  if not found then
    raise exception 'Destination vehicle does not belong to this tenant.'
      using errcode = '23503';
  end if;

  if p_destination_driver_id is not null then
    perform 1
    from public.drivers d
    where d.id = p_destination_driver_id
      and d.tenant_id = p_tenant_id
    for key share;

    if not found then
      raise exception 'Destination driver does not belong to this tenant.'
        using errcode = '23503';
    end if;
  end if;

  create temporary table tmp_load_transfer_items (
    job_id uuid not null,
    job_item_id uuid not null,
    serial_number text not null,
    primary key (job_item_id, serial_number)
  ) on commit drop;

  begin
    insert into tmp_load_transfer_items (
      job_id,
      job_item_id,
      serial_number
    )
    select
      nullif(btrim(item ->> 'job_id'), '')::uuid,
      nullif(btrim(item ->> 'job_item_id'), '')::uuid,
      btrim(coalesce(item ->> 'serial_number', ''))
    from jsonb_array_elements(p_items) item;
  exception
    when invalid_text_representation then
      raise exception 'Transfer contains an invalid job or item identifier.'
        using errcode = '22023';
    when unique_violation then
      raise exception 'Transfer contains a duplicate serialized item.'
        using errcode = '23505';
  end;

  if (
    select count(*)
    from tmp_load_transfer_items
  ) <> jsonb_array_length(p_items) then
    raise exception 'Transfer item payload could not be parsed completely.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from tmp_load_transfer_items
    where length(serial_number) not between 1 and 250
  ) then
    raise exception 'Every transfer item requires a valid serial number.'
      using errcode = '22023';
  end if;

  /*
   * Lock the serialized job items before validating their identity.
   * This prevents their serial membership changing underneath the transfer.
   */
  perform ji.id
  from public.job_items ji
  join (
    select distinct job_item_id
    from tmp_load_transfer_items
  ) requested
    on requested.job_item_id = ji.id
  where ji.tenant_id = p_tenant_id
  order by ji.id
  for key share;

  if exists (
    select 1
    from tmp_load_transfer_items t
    left join public.job_items ji
      on ji.id = t.job_item_id
     and ji.tenant_id = p_tenant_id
     and ji.job_id = t.job_id
    left join public.jobs j
      on j.id = t.job_id
     and j.tenant_id = p_tenant_id
    where ji.id is null
       or j.id is null
       or not (
         t.serial_number = any(
           coalesce(ji.serial_numbers, array[]::text[])
         )
       )
  ) then
    raise exception 'A serial does not belong to its supplied tenant, job or job item.'
      using errcode = '23514';
  end if;

  /*
   * Bootstrap custody only where no authoritative custody row exists.
   *
   * jobs.vehicle_id is NOT physical evidence.
   *
   * The manifest subsystem defines latest state using:
   *   scanned_at DESC, id DESC
   *
   * Only a latest LOADED event establishes vehicle custody.
   */
  with missing as (
    select t.*
    from tmp_load_transfer_items t
    left join public.job_item_vehicle_custody c
      on c.tenant_id = p_tenant_id
     and c.job_item_id = t.job_item_id
     and c.serial_number = t.serial_number
    where c.job_item_id is null
  ),
  latest_manifest_evidence as (
    select distinct on (
      m.job_item_id,
      m.serial_number
    )
      m.job_id,
      m.job_item_id,
      m.serial_number,
      lm.vehicle_id,
      lm.driver_id,
      lse.event_type,
      lse.scanned_by,
      lse.scanned_at
    from missing m
    join public.load_manifest_items lmi
      on lmi.tenant_id = p_tenant_id
     and lmi.job_id = m.job_id
     and lmi.job_item_id = m.job_item_id
     and lmi.serial_number = m.serial_number
    join public.load_manifests lm
      on lm.id = lmi.manifest_id
     and lm.tenant_id = p_tenant_id
    join public.load_scan_events lse
      on lse.manifest_id = lm.id
     and lse.tenant_id = p_tenant_id
    order by
      m.job_item_id,
      m.serial_number,
      lse.scanned_at desc,
      lse.id desc
  )
  insert into public.job_item_vehicle_custody (
    tenant_id,
    job_id,
    job_item_id,
    serial_number,
    vehicle_id,
    driver_id,
    source,
    updated_by,
    updated_at
  )
  select
    p_tenant_id,
    e.job_id,
    e.job_item_id,
    e.serial_number,
    e.vehicle_id,
    e.driver_id,
    'manifest',
    e.scanned_by,
    e.scanned_at
  from latest_manifest_evidence e
  where e.event_type = 'loaded'
  on conflict (job_item_id, serial_number) do nothing;

  /*
   * Lock all requested custody rows in a deterministic order.
   */
  perform c.job_item_id
  from public.job_item_vehicle_custody c
  join tmp_load_transfer_items t
    on t.job_item_id = c.job_item_id
   and t.serial_number = c.serial_number
  where c.tenant_id = p_tenant_id
  order by c.job_item_id, c.serial_number
  for update of c;

  /*
   * Every physical item must now have custody on the stated source vehicle.
   * Missing custody, stale source selection and concurrent transfers all fail.
   */
  if exists (
    select 1
    from tmp_load_transfer_items t
    left join public.job_item_vehicle_custody c
      on c.tenant_id = p_tenant_id
     and c.job_item_id = t.job_item_id
     and c.serial_number = t.serial_number
    where c.job_item_id is null
       or c.job_id <> t.job_id
       or c.vehicle_id <> p_source_vehicle_id
  ) then
    raise exception
      'One or more items are not physically recorded on the source vehicle.'
      using errcode = '23514';
  end if;

  v_confirmed_at := now();

  insert into public.load_transfer_batches (
    tenant_id,
    source_vehicle_id,
    destination_vehicle_id,
    destination_driver_id,
    status,
    created_by,
    created_at,
    confirmed_by,
    confirmed_at
  )
  values (
    p_tenant_id,
    p_source_vehicle_id,
    p_destination_vehicle_id,
    p_destination_driver_id,
    'confirmed',
    p_created_by,
    v_confirmed_at,
    p_created_by,
    v_confirmed_at
  )
  returning id
  into v_batch_id;

  insert into public.load_transfer_items (
    tenant_id,
    transfer_batch_id,
    job_id,
    job_item_id,
    serial_number,
    source_vehicle_id,
    destination_vehicle_id,
    created_at
  )
  select
    p_tenant_id,
    v_batch_id,
    t.job_id,
    t.job_item_id,
    t.serial_number,
    p_source_vehicle_id,
    p_destination_vehicle_id,
    v_confirmed_at
  from tmp_load_transfer_items t
  order by t.job_item_id, t.serial_number;

  update public.job_item_vehicle_custody c
  set
    vehicle_id = p_destination_vehicle_id,
    driver_id = p_destination_driver_id,
    source = 'transfer',
    updated_by = p_created_by,
    updated_at = v_confirmed_at
  from tmp_load_transfer_items t
  where c.tenant_id = p_tenant_id
    and c.job_id = t.job_id
    and c.job_item_id = t.job_item_id
    and c.serial_number = t.serial_number
    and c.vehicle_id = p_source_vehicle_id;

  get diagnostics v_item_count = row_count;

  if v_item_count <> jsonb_array_length(p_items) then
    raise exception 'Transfer custody update was incomplete.'
      using errcode = '40001';
  end if;

  select count(distinct t.job_id)::integer
  into v_affected_job_count
  from tmp_load_transfer_items t;

  /*
   * A job is "fully moved" only when:
   *   - it has at least one declared serialized item; and
   *   - every declared serial on every job item has custody on destination.
   *
   * This is reporting only. Planning is never reassigned here.
   */
  select count(*)::integer
  into v_fully_moved_job_count
  from (
    select distinct t.job_id
    from tmp_load_transfer_items t
    where exists (
      select 1
      from public.job_items ji
      where ji.tenant_id = p_tenant_id
        and ji.job_id = t.job_id
        and cardinality(
          coalesce(ji.serial_numbers, array[]::text[])
        ) > 0
    )
    and not exists (
      select 1
      from public.job_items ji
      cross join lateral unnest(
        coalesce(
          ji.serial_numbers,
          array[]::text[]
        )
      ) declared(serial_number)
      left join public.job_item_vehicle_custody c
        on c.tenant_id = ji.tenant_id
       and c.job_item_id = ji.id
       and c.serial_number = declared.serial_number
      where ji.tenant_id = p_tenant_id
        and ji.job_id = t.job_id
        and (
          c.job_item_id is null
          or c.vehicle_id <> p_destination_vehicle_id
        )
    )
  ) fully_moved_jobs;

  return query
  select
    v_batch_id,
    v_item_count,
    v_affected_job_count,
    v_fully_moved_job_count,
    v_confirmed_at;
end;
$function$;

revoke all on function public.create_and_confirm_load_transfer(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb
) from public;

revoke all on function public.create_and_confirm_load_transfer(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb
) from anon;

revoke all on function public.create_and_confirm_load_transfer(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb
) from authenticated;

grant execute on function public.create_and_confirm_load_transfer(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  jsonb
) to service_role;