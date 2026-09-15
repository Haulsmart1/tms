-- prodfix_73_geocode_failures.sql
--
-- Remember geocode failures so they are not retried on every load. Review
-- finding PLAN-13.
--
-- Why: a stop that does not geocode kept lat/lng null with no failure marker,
-- so /tracking re-geocoded it on every 30 second poll and /planning on every
-- load, each attempt costing up to five TomTom calls plus a postcodes.io call.
--
-- What: two nullable/defaulted columns on job_stops. app/api/tomtom/geocode
-- records a definite "address not found" there and skips the stop until a
-- backoff has passed (lib/tomtom/geocodeRetry.ts: 6 h, doubling, capped at
-- 7 days). Upstream errors are not recorded, so an outage does not blacklist
-- addresses. app/jobs reinserts stops when a job is edited, which resets both
-- columns for a changed address.
--
-- Writes use the caller's RLS-scoped client, like the existing lat/lng cache,
-- so no access changes.
--
-- Degrades safely: until applied, the route detects the missing columns
-- (42703) and geocodes as before, without the cache.
--
-- Safe to re-run. Apply in the Supabase SQL editor.

begin;

alter table public.job_stops
    add column if not exists geocode_failed_at timestamptz;

alter table public.job_stops
    add column if not exists geocode_attempts integer not null default 0;

comment on column public.job_stops.geocode_failed_at is
    'Last time geocoding found no position for this address; retries back off from here (review PLAN-13).';

comment on column public.job_stops.geocode_attempts is
    'Consecutive geocode attempts that found no position.';

commit;

-- Verify (expect two rows):
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'job_stops'
--    and column_name in ('geocode_failed_at', 'geocode_attempts');
