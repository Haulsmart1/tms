-- billing_02: fixed 4-weekly billing cycle.
-- Apply manually in the Supabase SQL editor, like the rls_* series and
-- billing_01. Safe to re-run.
--
-- Cycles are now a fixed 28 days (lib/billing/schedule.ts), so there is no
-- anchor day to clamp into a short month and the column is dead. Apply this
-- together with the code change that stops writing it: the column is NOT NULL,
-- so the old code cannot run against the new schema and the new code cannot
-- insert against the old one.

alter table public.company_billing drop column if exists anchor_day;
