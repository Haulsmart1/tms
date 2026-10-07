-- tracking_02_pod_flags.sql
--
-- Why: offline POD saves (docs/superpowers/specs/2026-10-07-offline-pod-and-tracking-links-design.md).
-- A delivery completed with no signal is sent later carrying the time the driver tapped Complete.
-- When the server cannot trust that time (outside the shift, in the future, older than 72 hours) it
-- uses its own receive time and marks the stop with the flag 'pod_time_untrusted' so the office can
-- see it in /jobs.
--
-- Deploy order: the app degrades without this column. The complete route retries its update without
-- pod_flags on 42703 and logs a warning, so a missing column never blocks a delivery.
--
-- Idempotent.

begin;

alter table public.job_stops
  add column if not exists pod_flags text[] not null default '{}';

commit;

-- VERIFY (expect one row, data_type ARRAY, is_nullable NO):
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'job_stops' and column_name = 'pod_flags';
