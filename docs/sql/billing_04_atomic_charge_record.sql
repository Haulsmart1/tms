-- billing_04: record a cycle charge and the coverage it bought in ONE
-- statement.
-- Apply manually in the Supabase SQL editor, like the rls_* and billing_*
-- series. Safe to re-run.
--
-- ORDER MATTERS: APPLY THIS BEFORE DEPLOYING THE CODE.
-- The deployed lib/billing/server.ts calls this function by name. If the code
-- ships first, every cron charge and every first-time card setup takes the
-- customer's money at Square and then fails on a missing function, recording
-- nothing at all. See "WHAT BREAKS IF THIS IS NOT APPLIED" at the bottom.
--
-- WHY THIS EXISTS.
-- runChargeCycle has to record two things after Square accepts a payment:
--   * the platform_charges audit row, and
--   * one vehicle_cycle_coverage row per vehicle the cycle paid for.
-- Coverage completeness is money: /api/licences/activate consults coverage to
-- decide whether a mid-cycle vehicle needs a pro-rata charge, so a missing
-- coverage row silently bills a customer twice for a vehicle they already paid
-- for.
--
-- Sequencing those two writes in application code is wrong in BOTH orders:
--
--   audit first, coverage second, coverage errors swallowed
--     Coverage can be lost permanently. The prior-success early return then
--     short circuits every later rerun, so nothing ever repairs it, and the
--     next mid-cycle addition over-charges.
--
--   coverage first, audit second, throw on coverage failure
--     Fixes the cron but breaks the card route's first-time setup: the throw
--     leaves the card charged with no platform_charges row and no
--     company_billing row. Orphan recovery there looks for a succeeded
--     platform_charges row, which is exactly what the throw suppressed. A
--     same-day retry creates a new Square card (new sourceId) so the same
--     idempotency key is refused with IDEMPOTENCY_KEY_REUSED and the customer
--     sees a 409; a next-day retry computes a different cycle_date, hence a
--     different key, hence a genuine SECOND full-cycle charge with no record
--     of the first.
--
-- So stop sequencing them. One function, one statement from the caller's point
-- of view, both writes land together or neither does.
--
-- THE PROPERTY THAT MAKES THIS STRICTLY BETTER.
-- The audit insert ALREADY threw on failure before this change ("Charge
-- recorded at Square but platform_charges insert failed"). Folding coverage
-- into the same call means coverage inherits the audit row's existing fate and
-- introduces no new failure mode: the set of ways this can fail is unchanged,
-- only the set of half-written outcomes shrinks to empty.
--
-- WHY SECURITY DEFINER IS CORRECT HERE.
-- Note the contrast with guard_vehicle_licence_active in billing_03, which is
-- deliberately INVOKER rights because SECURITY DEFINER would have made its
-- current_user check compare the function OWNER against the exempt list and
-- silently enforce nothing. That reasoning does not apply here: this function
-- contains no caller-identity test of any kind. It needs owner rights for the
-- opposite reason, that platform_charges and vehicle_cycle_coverage have no
-- INSERT policies and no write grants (billing_01, billing_03), so an
-- invoker-rights body would be refused. Do NOT "fix" this by copying the
-- trigger's invoker-rights pattern.
--
-- Because it is SECURITY DEFINER and it writes billing tables, the grants at
-- the bottom are load-bearing. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, which here would be a privilege escalation reachable
-- straight from the browser over PostgREST: any signed-in user could mint
-- arbitrary "succeeded" charge rows and arbitrary coverage. The revoke/grant
-- pair must stay immediately adjacent to the definition, because
-- `create or replace function` does NOT reset grants but a `drop function`
-- plus recreate DOES: anyone who ever recreates this function that way and
-- skips the revoke reopens the hole.

create or replace function public.record_cycle_charge(
  p_company_id uuid,
  p_cycle_date date,
  p_attempt int,
  p_vehicle_count int,
  p_net_pence bigint,
  p_vat_pence bigint,
  p_gross_pence bigint,
  p_vat_rate numeric,
  p_currency text,
  p_square_payment_id text,
  p_receipt_url text,
  p_status text,
  p_failure_code text,
  p_vehicle_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `do nothing` on the (company_id, cycle_date, attempt) unique key replaces
  -- the 23505 tolerance the application used to carry. A rerun of the same
  -- attempt after a crash reuses the same Square idempotency key, so the
  -- recomputed outcome matches the row already stored: treat it as
  -- already-recorded rather than an error.
  insert into public.platform_charges (
    company_id, cycle_date, attempt, vehicle_count,
    net_pence, vat_pence, gross_pence, vat_rate, currency,
    square_payment_id, receipt_url, status, failure_code
  )
  values (
    p_company_id, p_cycle_date, p_attempt, p_vehicle_count,
    p_net_pence, p_vat_pence, p_gross_pence, p_vat_rate, p_currency,
    p_square_payment_id, p_receipt_url, p_status, p_failure_code
  )
  on conflict (company_id, cycle_date, attempt) do nothing;

  -- Coverage is written ONLY for a succeeded charge: a failed charge paid for
  -- nothing, and the retry recounts from scratch. The status gate lives here
  -- rather than in the caller so there is exactly one place that decides it.
  -- A null or empty p_vehicle_ids writes no rows (unnest of an empty array
  -- yields no rows), which is the zero-vehicle case.
  if p_status = 'succeeded' then
    insert into public.vehicle_cycle_coverage (company_id, cycle_date, vehicle_id)
    select p_company_id, p_cycle_date, vid
    from unnest(coalesce(p_vehicle_ids, '{}'::uuid[])) as vid
    on conflict do nothing;
  end if;
end $$;

-- Lock it down. Full argument-type signature in both statements, because a
-- bare name is ambiguous the moment an overload exists and Postgres will
-- refuse rather than guess.
revoke all on function public.record_cycle_charge(
  uuid, date, int, int, bigint, bigint, bigint, numeric,
  text, text, text, text, text, uuid[]
) from public, anon, authenticated;

grant execute on function public.record_cycle_charge(
  uuid, date, int, int, bigint, bigint, bigint, numeric,
  text, text, text, text, text, uuid[]
) to service_role;

-- VERIFY. The ACL must show service_role=X and nothing else. An empty-looking
-- `=X/` entry with no role name in front of it is PUBLIC and means the revoke
-- did not take.
--
--   select proname, proacl, prosecdef
--   from pg_proc
--   where oid = 'public.record_cycle_charge(uuid, date, int, int, bigint,
--                bigint, bigint, numeric, text, text, text, text, text,
--                uuid[])'::regprocedure;
--
-- WHAT BREAKS IF THIS IS NOT APPLIED BEFORE THE DEPLOY.
-- PostgREST answers the rpc call with PGRST202 ("Could not find the function
-- public.record_cycle_charge in the schema cache"). runChargeCycle turns that
-- into a throw, AFTER Square has already taken the money. Every charge in that
-- window is a real payment with no audit row and no coverage. Recovery is
-- manual: apply this file, then reconcile the affected cycles against Square's
-- payment list by idempotency key before the next cron run. So apply it first.
