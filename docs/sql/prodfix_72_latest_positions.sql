-- prodfix_72_latest_positions.sql
--
-- Newest GPS fix per vehicle. Review finding PLAN-14.
--
-- Why: app/api/driver/location now writes phone GPS into telematics_positions.
-- The client read a fleet-wide budget of vehicleIds.length * 5 rows ordered by
-- time, so one frequently reporting phone starved every other vehicle, which
-- then showed "No GPS" and could not be optimized in Planning.
--
-- What: two SECURITY INVOKER set-returning functions that return exactly one
-- row (the newest with coordinates) per requested vehicle via DISTINCT ON, and
-- the (vehicle_id, recorded_at desc) indexes that make them cheap. RLS on the
-- underlying tables still applies to the caller, so access is not widened; the
-- client additionally filters the result by tenant_id.
--
-- Degrades safely: until applied, lib/tracking/supabasePositions.ts falls back
-- to one limit-1 query per vehicle.
--
-- Depends on live state not in the repo: both tables have vehicle_id (uuid),
-- latitude, longitude and recorded_at columns, as the client selects them. If
-- vehicle_id is not uuid, creation fails loudly; nothing is half-applied.
-- Index creation briefly locks writes on these tables; run off-peak.
--
-- Safe to re-run. Apply in the Supabase SQL editor.

begin;

create index if not exists telematics_positions_vehicle_recorded_idx
    on public.telematics_positions (vehicle_id, recorded_at desc);

create index if not exists vehicle_locations_vehicle_recorded_idx
    on public.vehicle_locations (vehicle_id, recorded_at desc);

create or replace function public.latest_telematics_positions(
    p_vehicle_ids uuid[]
)
returns setof public.telematics_positions
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
    select distinct on (t.vehicle_id) t.*
      from public.telematics_positions t
     where t.vehicle_id = any (p_vehicle_ids)
       and cardinality(p_vehicle_ids) <= 1000
       and t.latitude is not null
       and t.longitude is not null
     order by t.vehicle_id, t.recorded_at desc nulls last;
$$;

create or replace function public.latest_vehicle_locations(
    p_vehicle_ids uuid[]
)
returns setof public.vehicle_locations
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
    select distinct on (l.vehicle_id) l.*
      from public.vehicle_locations l
     where l.vehicle_id = any (p_vehicle_ids)
       and cardinality(p_vehicle_ids) <= 1000
       and l.latitude is not null
       and l.longitude is not null
     order by l.vehicle_id, l.recorded_at desc nulls last;
$$;

revoke all on function public.latest_telematics_positions(uuid[]) from public;
revoke all on function public.latest_telematics_positions(uuid[]) from anon;
grant execute on function public.latest_telematics_positions(uuid[]) to authenticated;

revoke all on function public.latest_vehicle_locations(uuid[]) from public;
revoke all on function public.latest_vehicle_locations(uuid[]) from anon;
grant execute on function public.latest_vehicle_locations(uuid[]) to authenticated;

commit;

-- Verify (expect both functions security invoker, i.e. prosecdef = false, and anon cannot execute):
-- select proname, prosecdef from pg_proc
--  where proname in ('latest_telematics_positions', 'latest_vehicle_locations');
-- select has_function_privilege('anon', 'public.latest_telematics_positions(uuid[])', 'execute');
