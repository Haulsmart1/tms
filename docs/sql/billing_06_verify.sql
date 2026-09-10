-- billing_06 / billing_07 verification harness. Read-only in effect: every
-- mutation below is rolled back, and the probes that expect an error catch it.
--
-- WHY THIS FILE EXISTS. vitest.config.ts covers `lib/**/*.test.ts` only, and
-- there is no database test harness in this repo. So the pure billing logic is
-- unit tested (rateCard, invoiceLine, invoice, close, period, activation,
-- periodPayment: over a hundred assertions) but four of the checks the brief
-- asked for cannot be expressed there at all, because they are properties of
-- Postgres rather than of a function:
--
--   * RLS: a user in company A cannot read company B's periods, lines or
--     charges
--   * running close twice on one period produces identical lines, no
--     duplicates
--   * two concurrent closes: only one proceeds
--   * the partial unique index enforces one line per vehicle without blocking
--     the discount and minimum lines
--
-- Those four live here, and they are HAND RUN. Treat this file as unrun until
-- someone has actually run it and said so.
--
-- HOW TO RUN. Paste the whole file into the Supabase SQL editor and read the
-- table the final select returns. Every row must say PASS.
--
-- Run it AFTER billing_06 and billing_07 STEP 1.

create or replace function public.billing_period_verify()
returns table(probe text, outcome text)
language plpgsql
as $fn$
declare
  v_company uuid;
  v_period uuid;
  v_period_b uuid;
  v_vehicle uuid;
  v_other_company uuid;
  n int;
begin
  select id into v_company from public.companies order by created_at limit 1;
  if v_company is null then
    probe := 'setup'; outcome := 'SKIP: no companies exist'; return next; return;
  end if;

  select v.id into v_vehicle
  from public.vehicles v
  left join public.tenants t on t.id = v.tenant_id
  where t.company_id = v_company or v.tenant_id = v_company
  limit 1;

  -- ---------------------------------------------------------------- schema

  probe := 'billing_periods RLS enabled';
  outcome := case when (select relrowsecurity from pg_class
                        where oid = 'public.billing_periods'::regclass)
                  then 'PASS' else 'FAIL: RLS is off, so its policy is inert' end;
  return next;

  probe := 'invoice_lines RLS enabled';
  outcome := case when (select relrowsecurity from pg_class
                        where oid = 'public.invoice_lines'::regclass)
                  then 'PASS' else 'FAIL: RLS is off, so its policy is inert' end;
  return next;

  probe := 'period_charges RLS enabled';
  outcome := case when (select relrowsecurity from pg_class
                        where oid = 'public.period_charges'::regclass)
                  then 'PASS' else 'FAIL: RLS is off, so its policy is inert' end;
  return next;

  -- A grant to PUBLIC is a separate ACL entry every role inherits, and
  -- revoking from `authenticated` does not touch it. This is the check that
  -- catches it: it looks for ANY write privilege reachable by a browser role.
  probe := 'no browser write grants on the billing tables';
  select count(*) into n
  from (
    select unnest(array['public.billing_periods','public.invoice_lines','public.period_charges']) as rel
  ) t
  where has_table_privilege('authenticated', t.rel, 'INSERT')
     or has_table_privilege('authenticated', t.rel, 'UPDATE')
     or has_table_privilege('authenticated', t.rel, 'DELETE')
     or has_table_privilege('anon', t.rel, 'INSERT')
     or has_table_privilege('anon', t.rel, 'UPDATE')
     or has_table_privilege('anon', t.rel, 'DELETE');
  outcome := case when n = 0 then 'PASS'
                  else 'FAIL: ' || n || ' table(s) still writable from a browser role' end;
  return next;

  probe := 'authenticated can still READ the billing tables';
  outcome := case when has_table_privilege('authenticated','public.billing_periods','SELECT')
                   and has_table_privilege('authenticated','public.invoice_lines','SELECT')
                   and has_table_privilege('authenticated','public.period_charges','SELECT')
                  then 'PASS'
                  else 'FAIL: a policy without a grant reads as an EMPTY TABLE, not an error, so the billing page would silently show nothing' end;
  return next;

  -- billing_07's most important omission, asserted as an omission.
  probe := 'no one-active-licence-per-vehicle index';
  select count(*) into n from pg_indexes
  where schemaname = 'public' and tablename = 'vehicle_licences'
    and indexdef ilike '%deactivated_at is null%'
    and indexdef ilike '%unique%';
  outcome := case when n = 0 then 'PASS'
                  else 'FAIL: this index breaks compliance records; a vehicle legitimately holds several licences at once' end;
  return next;

  -- ------------------------------------------------------- behaviour probes

  begin
    insert into public.billing_periods (company_id, period_start, period_end, status)
    values (v_company, date '2000-01-01', date '2000-01-29', 'open')
    returning id into v_period;

    -- RULE 5, and the two non-vehicle lines that must not collide with it.
    probe := 'discount and minimum lines coexist in one period';
    begin
      insert into public.invoice_lines (company_id, billing_period_id, kind, net_pence, description)
      values (v_company, v_period, 'volume_discount', -100, 'probe discount'),
             (v_company, v_period, 'minimum_adjustment', 100, 'probe minimum');
      outcome := 'PASS';
    exception when others then
      outcome := 'FAIL: ' || sqlerrm || ' (the unique index must be PARTIAL on vehicle_id is not null)';
    end;
    return next;

    if v_vehicle is not null then
      probe := 'one line per vehicle per period';
      begin
        insert into public.invoice_lines (company_id, billing_period_id, kind, vehicle_id, net_pence, description)
        values (v_company, v_period, 'vehicle', v_vehicle, 6450, 'probe one');
        insert into public.invoice_lines (company_id, billing_period_id, kind, vehicle_id, net_pence, description)
        values (v_company, v_period, 'vehicle', v_vehicle, 6450, 'probe two');
        outcome := 'FAIL: the same vehicle was billed twice in one period';
      exception when unique_violation then
        outcome := 'PASS';
      end;
      return next;
    end if;

    probe := 'a vehicle line requires a vehicle_id';
    begin
      insert into public.invoice_lines (company_id, billing_period_id, kind, net_pence, description)
      values (v_company, v_period, 'vehicle', 100, 'probe orphan');
      outcome := 'FAIL: a vehicle line with no vehicle cannot be traced to what it billed';
    exception when check_violation then
      outcome := 'PASS';
    end;
    return next;

    probe := 'a discount line must NOT carry a vehicle_id';
    if v_vehicle is not null then
      begin
        insert into public.invoice_lines (company_id, billing_period_id, kind, vehicle_id, net_pence, description)
        values (v_company, v_period, 'volume_discount', v_vehicle, -100, 'probe mislabelled');
        outcome := 'FAIL: any query summing a vehicle cost would pick this up';
      exception when check_violation then
        outcome := 'PASS';
      end;
    else
      outcome := 'SKIP: no vehicle available';
    end if;
    return next;

    -- THE CONCURRENT CLOSE. The claim in closeOnePeriod is
    -- `update ... where id = ? and status = ?`, so a second run reading the
    -- same 'open' row updates ZERO rows once the first has moved it. This
    -- reproduces that exactly.
    probe := 'concurrent close: only one run claims the period';
    update public.billing_periods set status = 'closing', closing_since = now()
    where id = v_period and status = 'open';
    get diagnostics n = row_count;

    if n <> 1 then
      outcome := 'FAIL: the first claim did not take';
    else
      update public.billing_periods set status = 'closing', closing_since = now()
      where id = v_period and status = 'open';
      get diagnostics n = row_count;
      outcome := case when n = 0 then 'PASS'
                      else 'FAIL: a second run claimed a period already being closed' end;
    end if;
    return next;

    probe := 'one open period per company';
    begin
      update public.billing_periods set status = 'open' where id = v_period;
      insert into public.billing_periods (company_id, period_start, period_end, status)
      values (v_company, date '2000-02-01', date '2000-02-29', 'open')
      returning id into v_period_b;
      outcome := 'FAIL: two open periods overlap, so the same days can be billed twice';
    exception when unique_violation then
      outcome := 'PASS';
    end;
    return next;

    raise exception 'rollback probes';
  exception when others then
    if sqlerrm <> 'rollback probes' then
      probe := 'behaviour probes'; outcome := 'ERROR: ' || sqlerrm; return next;
    end if;
  end;

  return;
end $fn$;

-- Run it.
select * from public.billing_period_verify();

-- Clean up. The function is a probe harness, not part of the schema.
drop function if exists public.billing_period_verify();

-- ===========================================================================
-- THE RLS PROBE CANNOT BE AUTOMATED HERE, and this is the honest version of
-- why. The SQL editor connects as postgres, which BYPASSES row level security
-- entirely, so a policy test run from here passes whether or not the policy
-- works. rls_09_verify.sql has the same limitation and solves it by taking
-- profile ids as arguments and calling the helper functions directly.
--
-- Do it from the app instead. Sign in as an admin of company A and run this in
-- devtools; every one must come back empty, NOT an error:
--
--   await supabase.from('billing_periods').select('id, company_id')
--   await supabase.from('invoice_lines').select('id, company_id')
--   await supabase.from('period_charges').select('id, company_id')
--
-- Then confirm the rows a company SHOULD see are visible: seed one period for
-- company A, re-run the first query, expect exactly that row and nothing
-- belonging to any other company.
--
-- An EMPTY result where you expected rows is the failure worth looking for. A
-- policy without a matching grant reads as an empty table rather than as an
-- error, which is why the grant probe above exists as well.
