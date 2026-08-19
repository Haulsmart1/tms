-- Planning page (spec: docs/superpowers/specs/2026-08-19-planning-page-design.md)
--
-- jobs.route_order: the job's position within its vehicle's day. A vehicle's
--   plan for a date is its jobs for that scheduled_date ordered by route_order.
--   NULL means unsequenced.
--
-- job_stops.lat/lng/geocoded_at: TomTom geocode cache so each address is
--   geocoded once, ever. No clearing trigger is needed: app/jobs/page.tsx
--   deletes and reinserts a job's stops on every edit, so a changed address is
--   a brand-new row with NULL coordinates.
--
-- No RLS work: both tables already carry tenant policies (cmd ALL, tenant_id =
-- get_my_company_id()) that cover new columns automatically.

alter table public.jobs
  add column if not exists route_order integer;

alter table public.job_stops
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geocoded_at timestamptz;
