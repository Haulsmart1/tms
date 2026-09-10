-- billing_06: period billing (arrears) tables and per-company settings.
-- Apply manually in the Supabase SQL editor, like the rls_* and billing_*
-- series. Safe to re-run: every statement is guarded.
--
-- APPLY THIS BEFORE DEPLOYING THE CODE.
--
-- The file itself is additive and safe to apply against the CURRENT code at any
-- time: it creates new tables and adds defaulted columns to company_billing,
-- and nothing deployed reads any of them. The hazard runs the other way.
--
-- resolveActivation (lib/billing/periodServer.ts) selects billing_model on
-- EVERY licence activation. Against a database without this file, PostgREST
-- answers 42703 ("column does not exist"). The code tolerates exactly that
-- code and falls back to v1, so a deploy that lands first is survivable rather
-- than an outage, but the tolerance is a safety net and not a plan: it means
-- every activation does a wasted round trip and any company you have already
-- switched silently bills on the wrong model.
--
-- Not a money hazard in either order. Compare billing_04, where a missing
-- function threw AFTER Square had taken the money.
--
-- The dangerous file is billing_07, which alters vehicle_licences. Apply this
-- one first: billing_07's backfill reads nothing from here, but the close job
-- needs both, and applying the additive half early shortens the window in
-- which the two are out of step.
--
-- WHAT THIS IMPLEMENTS. See
-- docs/superpowers/specs/2026-09-10-period-billing-design.md for why. In
-- short: licences are billed for time active, in arrears, when a fixed 28-day
-- period closes. Adding a vehicle stops moving money. The GBP 129 period
-- minimum is collected once, up front, at first vehicle activation.
--
-- PRE-FLIGHT. The new tables take foreign keys on companies(id), tenants(id)
-- and vehicles(id). Confirm all three are uuid before applying, or the create
-- fails on a type mismatch:
--
--   select table_name, column_name, data_type
--   from information_schema.columns
--   where table_schema = 'public' and column_name = 'id'
--     and table_name in ('companies', 'tenants', 'vehicles');

begin;

-- ===========================================================================
-- Per-company billing settings.
-- ===========================================================================
--
-- These live ON company_billing rather than in a new settings table. That row
-- is already the one-per-company billing configuration, and a second
-- one-per-company table has to be kept in sync and can go missing, which for
-- a billing input means a company silently priced at defaults.
--
-- The brief specified a tenant_billing_settings table keyed on tenant_id.
-- Billing is at COMPANY grain here: one card, one Square customer, one cycle
-- per company. A company owns many tenants, so tenant grain would mean a
-- separate card per depot.

-- The feature flag. Every v2 code path is gated on this, so both models run
-- side by side and companies migrate one at a time. Defaulting to v1 is what
-- makes this whole file inert until someone opts a company in.
alter table public.company_billing
  add column if not exists billing_model text not null default 'v1_immediate';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.company_billing'::regclass
      and conname = 'company_billing_billing_model_check'
  ) then
    alter table public.company_billing
      add constraint company_billing_billing_model_check
      check (billing_model in ('v1_immediate', 'v2_period'));
  end if;
end $$;

alter table public.company_billing
  add column if not exists currency text not null default 'GBP';

-- The commercial levers from the brief. All three default to OFF, because the
-- GBP 129 floor was chosen over an allowance and neither grace nor a minimum
-- billable window is a launch term. The logic for all three is implemented and
-- tested (lib/billing/invoice.ts, lib/billing/invoiceLine.ts,
-- lib/billing/close.ts), so switching any of them on is a config change rather
-- than a build.
--
-- min_bill_days is 1, not 0: it is a floor on days billed for a vehicle that
-- was actually present, and 0 would mean "no floor" expressed as a value that
-- also reads as "bill nothing".
alter table public.company_billing
  add column if not exists included_vehicles int not null default 0
    check (included_vehicles >= 0);

alter table public.company_billing
  add column if not exists grace_days int not null default 0
    check (grace_days >= 0);

alter table public.company_billing
  add column if not exists min_bill_days int not null default 1
    check (min_bill_days >= 1);

-- The floor on a period's net total. GBP 129.00, which is exactly two vehicles
-- at the headline rate, so "GBP 129 minimum" and "first two vehicles included"
-- describe the same offer.
--
-- Nullable with no default deliberately NOT chosen: a null floor would read as
-- "no minimum" and quietly ship a company on GBP 0. Per-company from day one
-- so a founding cohort can be grandfathered by setting it explicitly.
alter table public.company_billing
  add column if not exists min_invoice_pence bigint not null default 12900
    check (min_invoice_pence >= 0);

-- Snapshot of the rate a period is priced at, so a later reprice cannot
-- rewrite an invoice that has already been sent.
alter table public.company_billing
  add column if not exists unit_amount_pence bigint not null default 6450
    check (unit_amount_pence >= 0);

-- Rule 7's anti-recycling half needs somewhere to remember that a company has
-- already used its one accidental-signup refund.
alter table public.company_billing
  add column if not exists cooling_off_refunded_at timestamptz;

comment on column public.company_billing.billing_model is
  'v1_immediate charges in advance and pro-rata on vehicle add; v2_period bills in arrears at period close. Every v2 code path is gated on this.';
comment on column public.company_billing.min_invoice_pence is
  'Floor on a period net total, applied AFTER the volume discount. Never added on top of it.';
comment on column public.company_billing.cooling_off_refunded_at is
  'Set when the one-per-company 48-hour accidental-signup refund is used. Non-null means no further cooling-off refund.';

-- ===========================================================================
-- Billing periods.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'billing_period_status') then
    create type public.billing_period_status as enum
      ('open', 'closing', 'closed', 'invoiced', 'failed');
  end if;
end $$;

-- Dates are `date`, not `timestamptz`, matching every other billing date in
-- this codebase. lib/billing/schedule.ts sets out why: billing days are UK
-- business days, and timestamp arithmetic meets a 23-hour day twice a year.
-- The conversion from the timestamptz columns on vehicle_licences happens once
-- at the edge, via londonDateISO.
--
-- period_end is EXCLUSIVE. The day a period closes belongs to the next one; if
-- both counted it, every customer would pay 13 extra days a year.
create table if not exists public.billing_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status public.billing_period_status not null default 'open',

  -- Largest number of VEHICLES live at once inside the period. Vehicles, not
  -- licences: this table holds compliance documents, so one vehicle carries an
  -- O-licence, a waste carrier licence and an ADR certificate at once, and
  -- counting rows would report a fleet several times its real size.
  --
  -- Informational, and deliberately NOT the invoice line count either: two
  -- vehicles that never overlapped produce two lines but a mark of one. See
  -- highWaterMark in lib/billing/close.ts.
  high_water_mark int check (high_water_mark >= 0),

  -- Set when a run claims the period. The claim is a conditional UPDATE
  -- (set status='closing' where status='open'), which is what actually makes
  -- concurrent runs safe; this only lets a later run tell a live claim from
  -- one abandoned by a crash. See selectCloseAction.
  closing_since timestamptz,

  -- Why the period ended. A period shorter than 28 days is normal for a
  -- cancellation and a bug for anything else, and without this nobody can tell
  -- which they are looking at.
  closed_reason text check (closed_reason in ('scheduled', 'cancellation', 'cooling_off')),
  closed_at timestamptz,

  -- The minimum collected up front at the start of this period. The close job
  -- charges the balance above it, so most small-fleet cancellations settle to
  -- nothing. Stored per period rather than derived, because the floor is a
  -- per-company setting that may change between periods.
  prepaid_pence bigint not null default 0 check (prepaid_pence >= 0),

  -- Invoice totals. Net is after the volume discount and the minimum. VAT is
  -- charged once on the net total rather than per line: every line is 20%
  -- today, so per-line VAT would carry no information while producing a second
  -- figure that can differ from this one by a penny.
  net_pence bigint,
  vat_pence bigint,
  gross_pence bigint,
  vat_rate numeric not null default 20.0,

  provider_invoice_id text,
  created_at timestamptz not null default now(),

  unique (company_id, period_start),
  constraint billing_periods_end_after_start check (period_end > period_start)
);

-- The cron scans for due periods by status and end date.
create index if not exists billing_periods_due_idx
  on public.billing_periods (status, period_end);

create index if not exists billing_periods_company_start_idx
  on public.billing_periods (company_id, period_start desc);

-- At most one period per company may be open at a time. Without this, a race
-- in ensure_open_billing_period could open two overlapping periods and bill
-- the same days twice.
create unique index if not exists billing_periods_one_open
  on public.billing_periods (company_id)
  where status = 'open';

-- ===========================================================================
-- Invoice lines.
-- ===========================================================================
--
-- Three kinds of line, and only one of them belongs to a vehicle:
--
--   vehicle             one per billable vehicle, prorated at the FULL rate
--   volume_discount     one negative line against their sum
--   minimum_adjustment  one line lifting the total to min_invoice_pence
--
-- The discount is a line rather than an adjustment folded into the per-vehicle
-- amounts, because a whole-fleet discount does not divide evenly across them.
-- Folding it in would need a largest-remainder allocation and the per-vehicle
-- amounts would stop matching the rate the customer was quoted.
create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_period_id uuid not null
    references public.billing_periods(id) on delete cascade,

  kind text not null
    check (kind in ('vehicle', 'volume_discount', 'minimum_adjustment')),

  -- Null on the discount and minimum lines. The brief had this NOT NULL with a
  -- plain unique constraint; both had to give, because those two lines belong
  -- to no vehicle. Rule 5 is unaffected: it only ever concerned real vehicles,
  -- and the partial index below enforces it exactly as before.
  vehicle_id uuid references public.vehicles(id) on delete set null,

  -- Reporting only. Billing is at company grain, but a multi-depot operator
  -- gets one bill that can still be broken down by depot.
  tenant_id uuid references public.tenants(id) on delete set null,

  vrn_normalised text,
  coverage_start date,
  coverage_end date,
  actual_days int not null default 0 check (actual_days >= 0),
  billable_days int not null default 0 check (billable_days >= 0),

  -- The rate this line was priced at, snapshotted at close.
  unit_amount_pence bigint not null default 0,

  -- Negative on the discount line, which is why there is no >= 0 check here.
  net_pence bigint not null,

  included_in_plan boolean not null default false,
  description text not null,
  created_at timestamptz not null default now(),

  -- vehicle_id is required on a vehicle line and forbidden on the others. A
  -- vehicle line without one could not be traced back to what it billed, and a
  -- discount line WITH one would be counted by any query that sums a vehicle's
  -- cost.
  constraint invoice_lines_vehicle_kind_agrees check (
    (kind = 'vehicle' and vehicle_id is not null)
    or (kind <> 'vehicle' and vehicle_id is null)
  )
);

-- RULE 5: one line per vehicle per period. Partial, because the discount and
-- minimum lines share a null vehicle_id and a plain unique constraint would
-- let only one of them exist per period.
create unique index if not exists invoice_lines_one_per_vehicle
  on public.invoice_lines (billing_period_id, vehicle_id)
  where vehicle_id is not null;

create index if not exists invoice_lines_period_idx
  on public.invoice_lines (billing_period_id);

create index if not exists invoice_lines_company_created_idx
  on public.invoice_lines (company_id, created_at desc);

-- ===========================================================================
-- Period charges.
-- ===========================================================================
--
-- A period produces at most two charges, and they are different things rather
-- than two attempts at one:
--
--   minimum  taken UP FRONT when the period opens, at first vehicle
--            activation or reactivation after suspension
--   balance  taken at close, for whatever the period cost ABOVE the minimum
--            already collected. Often zero.
--
-- Deliberately NOT folded into platform_charges. That table is unique on
-- (company_id, cycle_date, attempt), and a v2 company has a minimum charge
-- filed at its period start and a balance charge for the period that ended
-- there, so the two would collide on every boundary. Same reasoning that kept
-- vehicle_addon_charges separate in billing_03.
--
-- STATUS 'pending' EXISTS FOR THE REASON billing_05 SETS OUT AT LENGTH. The
-- code records intent BEFORE calling Square and updates the row after, so a
-- crash in between leaves a row a retry can rebuild a byte-identical request
-- body from. Without it, the retry sends a different body under a key Square
-- has already seen, gets IDEMPOTENCY_KEY_REUSED, and the charge can never
-- advance.
--
-- A pending row is an UNKNOWN outcome, NOT an unpaid one. The card may well
-- have been charged. Never delete one to tidy up: that frees the attempt
-- number and the next request spends the same key with a different body,
-- which wedges the period permanently. ANY READER OF THIS TABLE MUST FILTER
-- ON status; anything customer-facing should show 'succeeded' only.
--
-- Rows should leave 'pending' within seconds. Anything still pending after a
-- day is a crash that never got retried and needs reconciling against Square
-- by idempotency key (the format is in periodChargeIdempotencyKey,
-- lib/billing/periodPayment.ts):
--
--   select * from public.period_charges
--   where status = 'pending' and created_at < now() - interval '1 day';
create table if not exists public.period_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_period_id uuid not null
    references public.billing_periods(id) on delete cascade,

  kind text not null check (kind in ('minimum', 'balance')),
  attempt int not null check (attempt >= 1),

  net_pence bigint not null,
  vat_pence bigint not null,
  gross_pence bigint not null,
  vat_rate numeric not null default 20.0,
  currency text not null default 'GBP',

  -- The card is part of the idempotency-keyed request body just as much as
  -- the amount is, so a replay must resend exactly these. billing_05 added
  -- the same two columns to vehicle_addon_charges after a customer who
  -- replaced their card mid-retry wedged their own vehicle permanently.
  square_payment_id text,
  square_card_id text,
  square_customer_id text,
  receipt_url text,

  status text not null check (status in ('pending', 'succeeded', 'failed')),
  failure_code text,
  created_at timestamptz not null default now(),

  unique (billing_period_id, kind, attempt)
);

create index if not exists period_charges_company_created_idx
  on public.period_charges (company_id, created_at desc);

-- Finds the pending row a retry has to rebuild its request body from.
create index if not exists period_charges_pending_idx
  on public.period_charges (billing_period_id, kind)
  where status = 'pending';

-- ===========================================================================
-- RLS. Mirrors billing_01 and billing_03: company admins read their own rows,
-- super_admin reads all, nothing writes from a browser.
-- ===========================================================================

alter table public.billing_periods enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.period_charges enable row level security;

drop policy if exists billing_periods_select on public.billing_periods;
create policy billing_periods_select on public.billing_periods
  for select to authenticated
  using (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and company_id = public.get_my_company_id())
  );

drop policy if exists invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and company_id = public.get_my_company_id())
  );

drop policy if exists period_charges_select on public.period_charges;
create policy period_charges_select on public.period_charges
  for select to authenticated
  using (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and company_id = public.get_my_company_id())
  );

-- Granted explicitly rather than left to Supabase's default privileges, which
-- depend on which role runs this file. A policy without a grant reads as an
-- empty table, not as an error, so the billing page would silently show
-- nothing. Same reasoning as billing_03.
grant select on public.billing_periods, public.invoice_lines,
  public.period_charges to authenticated;

-- No INSERT/UPDATE/DELETE policies on purpose. All writes come from server
-- routes on the service role, which bypasses RLS.
--
-- `public` is in the revoke list alongside the two API roles. A privilege
-- granted to PUBLIC is held by every role and `revoke ... from authenticated`
-- does not touch it: the two are separate ACL entries and the effective
-- privilege is their sum. Omitting it is the mistake billing_03 documents.
revoke insert, update, delete on public.billing_periods
  from authenticated, anon, public;
revoke insert, update, delete on public.invoice_lines
  from authenticated, anon, public;
revoke insert, update, delete on public.period_charges
  from authenticated, anon, public;

commit;

-- ===========================================================================
-- VERIFY.
-- ===========================================================================
--
-- 1. Every existing company is on v1 and nothing has changed for them.
--
--    select billing_model, count(*) from public.company_billing
--    group by billing_model;
--
--    Expect one row: v1_immediate, with your full company count.
--
-- 2. The write lockdown took, against PUBLIC as well as authenticated. An
--    empty-looking `=arwd/` entry with no role name in front of it is PUBLIC.
--
--    select relname, relacl from pg_class
--    where oid in ('public.billing_periods'::regclass,
--                  'public.invoice_lines'::regclass,
--                  'public.period_charges'::regclass);
--
-- 3. RLS is actually ON, not merely policied. A policy on a table with RLS
--    disabled is inert, which is the trap rls_11 exists to close.
--
--    select relname, relrowsecurity from pg_class
--    where oid in ('public.billing_periods'::regclass,
--                  'public.invoice_lines'::regclass,
--                  'public.period_charges'::regclass);
--
--    All three must be true.
--
-- 4. The partial unique index enforces rule 5 without blocking the two
--    non-vehicle lines. This must succeed, then fail on the second insert of
--    the same vehicle, and leave nothing behind:
--
--    begin;
--    insert into public.billing_periods (company_id, period_start, period_end)
--    select id, date '2000-01-01', date '2000-01-29' from public.companies limit 1;
--    insert into public.invoice_lines (company_id, billing_period_id, kind, net_pence, description)
--    select company_id, id, 'volume_discount', -100, 'x' from public.billing_periods
--    where period_start = date '2000-01-01';
--    insert into public.invoice_lines (company_id, billing_period_id, kind, net_pence, description)
--    select company_id, id, 'minimum_adjustment', 100, 'y' from public.billing_periods
--    where period_start = date '2000-01-01';
--    -- both of the above must succeed: two null vehicle_ids in one period
--    rollback;
--
-- 5. The kind/vehicle_id agreement check bites. This must FAIL with 23514:
--
--    begin;
--    insert into public.invoice_lines (company_id, billing_period_id, kind, net_pence, description)
--    select company_id, id, 'vehicle', 100, 'no vehicle id' from public.billing_periods limit 1;
--    rollback;
--
-- WHAT BREAKS IF THIS IS NOT APPLIED.
--
-- With the OLD code deployed: nothing at all.
--
-- With the NEW code deployed: every licence activation and every estimate
-- takes the 42703 fallback described at the top, so they still work and every
-- company reads as v1. No company can be switched to v2 (there is no column to
-- set), and nothing is mis-billed. The cost is a wasted query per activation
-- and a feature that cannot be turned on.
--
-- The close job is unaffected either way: billing_periods does not exist, the
-- query throws, and app/api/billing/run/route.ts catches it per run and
-- reports it in the response while the v1 charge run continues normally.
