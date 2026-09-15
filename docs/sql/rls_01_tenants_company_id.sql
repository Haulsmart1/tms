-- RLS Tenancy Hardening (Phase 1) -- 01: add tenants.company_id
--
-- APPLIED ONCE with the 2026-07-28 tenancy hardening. DO NOT RE-RUN. The block below refuses to run.
-- The original header said "Safe to re-run". A re-run recreates the shared placeholder tenant
-- (with a null company_id) if it has since been deleted. Kept for history only.
do $$
begin
  raise exception 'rls_01_tenants_company_id.sql was applied on 2026-07-28 and must not be re-run. Nothing changed.';
end $$;

-- Plan: docs/superpowers/plans/2026-07-28-rls-tenancy-hardening.md
-- APPLY ORDER: 01 -> (reseed tenants + assign admin roles, plan Task 7 steps 1-2)
--              -> 02 -> 03 -> 04 -> 04b -> 05 -> 09.

alter table public.tenants
  add column if not exists company_id uuid references public.companies(id);

-- Ensure a tenants row exists for the current shared placeholder tenant.
-- tenants.name is NOT NULL, so supply one.
insert into public.tenants (id, name)
  values ('2f7cc0dc-b7fd-4556-92be-445e4b42ddcd', 'Shared placeholder tenant')
  on conflict (id) do nothing;

comment on column public.tenants.company_id is
  'Owning company. Used by can_access_tenant() for the admin level. Set NOT NULL after the reseed.';
