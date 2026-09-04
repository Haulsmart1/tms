-- billing_02: retire company_billing.anchor_day for the fixed 4-weekly cycle.
-- Apply manually in the Supabase SQL editor, like the rls_* series and
-- billing_01. Both steps are safe to re-run.
--
-- Cycles are now a fixed 28 days (lib/billing/schedule.ts), so there is no
-- anchor day to clamp into a short month and the column is dead.
--
-- ORDER MATTERS. This touches live payment code, and the two steps below sit
-- either side of the deploy on purpose.
--
--   1. Run STEP 1 BEFORE deploying the code.
--   2. Deploy the code.
--   3. Run STEP 2 any time after.
--
-- Why: the new code stops writing anchor_day, and the column is NOT NULL with
-- no default, so a new-code insert fails 23502 against the untouched schema.
-- Dropping the NOT NULL first removes that window, which makes STEP 1 safe to
-- run against the OLD code (which still writes a real value) and STEP 2 safe
-- to run against the NEW code (which never reads it).
--
-- Never run STEP 2 before the code deploys. The old cron does
-- anchor_day: Number(raw.anchor_day) on the fetched row; with the column gone
-- that is NaN, which the old two-argument computeNextChargeOn turns into a
-- garbage next_charge_on. runChargeCycle charges Square BEFORE persisting the
-- outcome, so the card is charged and the cycle date never advances: the
-- customer gets charged again on the next run.
--
-- Reads tolerate either schema. Every company_billing read in the app is
-- either select("*") or an explicit list that never named anchor_day, and no
-- policy, index, view or function references it. The inline
-- check (anchor_day between 1 and 31) is dropped with the column by Postgres.

-- STEP 1: run BEFORE deploying the code.
-- Guarded so that re-running this file after STEP 2 is a no-op rather than an
-- undefined-column error.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'company_billing'
      and column_name = 'anchor_day'
  ) then
    alter table public.company_billing alter column anchor_day drop not null;
  end if;
end $$;

-- STEP 2: run AFTER the code is deployed.
alter table public.company_billing drop column if exists anchor_day;
