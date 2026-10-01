-- Planned collection/delivery contact details.
-- These are intentionally separate from POD recipient details.

alter table public.job_stops
    add column if not exists contact_name text,
    add column if not exists contact_phone text,
    add column if not exists contact_email text;