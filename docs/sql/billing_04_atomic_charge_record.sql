-- billing_04: record a cycle charge and the coverage it bought in ONE
-- statement.
-- Apply manually in the Supabase SQL editor, like the rls_* and billing_*
-- series. Safe to re-run.
--
-- ORDER MATTERS.
--
--   1. Apply billing_03 STEP 1 first. This function body references
--      public.vehicle_cycle_coverage, which STEP 1 creates. A plpgsql body is
--      NOT name-resolved at create time, so applying this file against a
--      database without that table SUCCEEDS SILENTLY and then fails on the
--      first charge with `relation "vehicle_cycle_coverage" does not exist`.
--   2. Apply this file.
--   3. Deploy the code.
--
-- Never deploy the code first. The deployed lib/billing/server.ts calls this
-- function by name, so if the code ships ahead of the SQL every cron charge
-- and every first-time card setup takes the customer's money at Square and
-- then fails on a missing function, recording nothing at all. Skipping step 1
-- lands in the same place by a different route. See "WHAT BREAKS IF THIS IS
-- NOT APPLIED FIRST" at the bottom, which sets out how much of that heals on
-- its own (the cron) and how much does not (the card route).
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
--     same-day retry stores a new Square card, so sourceId differs, so the
--     same idempotency key is refused with IDEMPOTENCY_KEY_REUSED and the
--     customer sees a 409; a next-day retry computes a different cycle_date,
--     hence a different key, hence a genuine SECOND full-cycle charge with no
--     record of the first.
--
-- So stop sequencing them. One function, one statement from the caller's point
-- of view, both writes land together or neither does.
--
-- THE PROPERTY THAT MAKES THIS SAFE.
-- In the code being replaced, the COVERAGE write already threw on error, so a
-- coverage failure already aborted runChargeCycle. Folding it into the audit
-- insert's statement therefore adds no failure mode that was not already
-- there; it only removes the half-written outcomes. (The audit insert threw
-- too, on every error except 23505, and that one tolerance now lives inside
-- this function as `on conflict do nothing`.)
--
-- WHY INVOKER RIGHTS, NOT SECURITY DEFINER.
-- This is deliberately NOT `security definer`. An earlier draft of this file
-- had it the other way round with a false justification, so it is worth
-- stating plainly.
--
-- Invoker rights are SUFFICIENT. The only caller is the service role, which
-- keeps Supabase's default table grants (billing_01 and billing_03 revoke from
-- `authenticated, anon` and from `public`, never from service_role) and
-- additionally bypasses RLS, so the deliberate absence of INSERT policies on
-- platform_charges and vehicle_cycle_coverage does not bite it. The proof is
-- that the code this function replaces performed exactly these two inserts as
-- the service role over PostgREST and worked.
--
-- Invoker rights are also PREFERRED. A definer function that writes billing
-- tables is an escalation primitive whose only defence is the single ACL line
-- below. One `grant execute on all functions in schema public to
-- authenticated`, which is precisely the class of accident billing_03's STEP 3
-- trigger exists to survive, would let any signed-in user mint succeeded
-- charge rows and arbitrary coverage for ANY company_id, and coverage minted
-- against a company's running cycle makes added vehicles read as already paid
-- for through selectAddonAction's alreadyCovered branch. Under definer rights
-- there could be no second layer either: both current_user and session_user
-- evaluate to the owner, so nothing inside the body can tell a browser call
-- from a service-role one. Under invoker rights that same accident is
-- harmless, because an `authenticated` caller still holds no write privilege
-- on either table and the insert is refused.
--
-- The revoke and grant below remain the primary control and must stay
-- immediately adjacent to the definition: `create or replace function` does
-- NOT reset grants, but a `drop function` plus recreate DOES, so anyone who
-- recreates this function that way and skips the revoke hands EXECUTE back to
-- PUBLIC.

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
security invoker
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
  -- yields no rows), which is the zero-vehicle case. The conflict target is
  -- named rather than left bare so that a unique index added to this table
  -- later is not silently swallowed here.
  if p_status = 'succeeded' then
    insert into public.vehicle_cycle_coverage (company_id, cycle_date, vehicle_id)
    select p_company_id, p_cycle_date, vid
    from unnest(coalesce(p_vehicle_ids, '{}'::uuid[])) as vid
    on conflict (company_id, cycle_date, vehicle_id) do nothing;
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

-- VERIFY. The ACL must show service_role=X and nothing else, and prosecdef
-- must be false. An empty-looking `=X/` entry with no role name in front of it
-- is PUBLIC and means the revoke did not take.
--
--   select proname, proacl, prosecdef
--   from pg_proc
--   where oid = 'public.record_cycle_charge(uuid, date, int, int, bigint,
--                bigint, bigint, numeric, text, text, text, text, text,
--                uuid[])'::regprocedure;
--
-- WHAT BREAKS IF THIS IS NOT APPLIED FIRST.
-- PostgREST answers the rpc with PGRST202 ("Could not find the function
-- public.record_cycle_charge in the schema cache"), or, if billing_03 STEP 1
-- was skipped, the function exists and raises 42P01 on the missing coverage
-- table. Either way runChargeCycle throws AFTER Square has taken the money,
-- and the two callers then behave very differently:
--
--   Cron (/api/billing/run): self-heals. The per-company catch absorbs the
--   throw, so applyChargeOutcome never runs and status, retry_count and
--   next_charge_on all stay put. The next run recomputes an identical
--   (cycle_date, attempt) and sends Square the same idempotency key, which
--   replays the original payment instead of taking a second one. One side
--   effect worth knowing: throughout that window retry_at stays null while
--   next_charge_on sits in the past, so selectAddonAction returns
--   free/cycle_due and mid-cycle vehicle additions ride free. That fails
--   toward free, which is the acceptable direction.
--
--   Card route first-time setup (/api/billing/card): does NOT self-heal.
--   firstTimeAttempt is derived from platform_charges rows for
--   cycle_date = today, and orphan recovery looks for a succeeded
--   platform_charges row; the throw suppressed both, so neither can see the
--   payment that went through. A same-day retry at least does not
--   double-charge, because cycle_date and the attempt number are unchanged
--   and Square refuses the changed body under the spent key with
--   IDEMPOTENCY_KEY_REUSED, which surfaces to the customer as a 409. The next
--   day cycle_date is a different date, so the key differs, and the customer
--   is charged a SECOND full cycle with still no record of the first. That is
--   the same failure described above as disqualifying the coverage-first
--   design, and it applies unchanged whenever this rpc throws.
--
-- Recovery for the card-route case is manual: reconcile the affected
-- companies against Square's payment list before letting them retry. So apply
-- the SQL first.
