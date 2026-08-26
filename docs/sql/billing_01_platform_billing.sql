-- billing_01: platform subscription billing (Square card-on-file).
-- Apply manually in the Supabase SQL editor, like the rls_* series. Safe to re-run.
-- Depends on helpers that already exist in the DB: get_my_role(), get_my_company_id().

create table if not exists public.company_billing (
  company_id uuid primary key references public.companies(id) on delete cascade,
  square_customer_id text not null,
  square_card_id text not null,
  card_brand text,
  card_last4 text,
  card_exp_month int,
  card_exp_year int,
  status text not null check (status in ('active', 'past_due', 'canceled')),
  anchor_day int not null check (anchor_day between 1 and 31),
  next_charge_on date not null,
  retry_at date,
  retry_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cycle_date date not null,
  attempt int not null check (attempt >= 1),
  vehicle_count int not null check (vehicle_count >= 0),
  net_pence bigint not null,
  vat_pence bigint not null,
  gross_pence bigint not null,
  vat_rate numeric not null default 20.0,
  currency text not null default 'GBP',
  square_payment_id text,
  receipt_url text,
  status text not null check (status in ('succeeded', 'failed')),
  failure_code text,
  created_at timestamptz not null default now(),
  unique (company_id, cycle_date, attempt)
);

create index if not exists platform_charges_company_created_idx
  on public.platform_charges (company_id, created_at desc);

alter table public.company_billing enable row level security;
alter table public.platform_charges enable row level security;

-- Company admins read their own company's rows; super_admin reads all.
drop policy if exists company_billing_select on public.company_billing;
create policy company_billing_select on public.company_billing
  for select to authenticated
  using (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and company_id = public.get_my_company_id())
  );

drop policy if exists platform_charges_select on public.platform_charges;
create policy platform_charges_select on public.platform_charges
  for select to authenticated
  using (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and company_id = public.get_my_company_id())
  );

-- No INSERT/UPDATE/DELETE policies on purpose. All writes come from server
-- routes on the service role, which bypasses RLS. Belt and braces: revoke the
-- table grants too, matching rls_05_revoke_grants.sql.
revoke insert, update, delete on public.company_billing from authenticated, anon;
revoke insert, update, delete on public.platform_charges from authenticated, anon;
