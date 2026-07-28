-- RLS Tenancy Hardening (Phase 1) -- 01: add tenants.company_id
-- Run in the Supabase SQL editor, in numeric order. Safe to re-run.
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
