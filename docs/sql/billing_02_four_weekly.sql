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
--   3. Soak, then run STEP 2. See the rollback warning below first.
--
-- ROLLBACK. STEP 2 is the point of no return, and the deploy itself is
-- already one-way before that:
--
--   * After STEP 2, reverting the code breaks card capture outright. The old
--     insert names anchor_day and the column is gone: Postgres 42703.
--   * Between the deploy and STEP 2, reverting is ALSO unsafe. Rows written by
--     the new code have anchor_day NULL, and the old applyChargeOutcome does
--     Number(existing.anchor_day) on them, which is 0, which the old
--     Math.min(anchorDay, daysInMonth(...)) turns into a date ending -00.
--
-- So: leave a soak window before STEP 2, and if you must revert after the
-- deploy, backfill anchor_day first (for example
-- update public.company_billing set anchor_day = extract(day from next_charge_on)
-- where anchor_day is null) before restoring the old code.
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
