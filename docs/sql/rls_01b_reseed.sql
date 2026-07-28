-- RLS Tenancy Hardening (Phase 1) -- 01b: reseed TEST DATA (per-company tenants + admin roles).
-- Run AFTER rls_01 and BEFORE rls_02..05: an admin must exist before the admin-write
-- policies land, or company-settings saving and fleet edits lock to super_admin.
-- Idempotent. THIS EDITS DATA and is for the current throwaway test set only.
--
-- Current state: 7 companies (one profile each) all sharing tenant 2f7cc0dc with null roles,
-- plus 1 super_admin. This gives each company its own tenant and makes its sole user the admin.

-- 0. Ensure the 'admin' role exists (super_admin already does). Check what you have:
--      select id, name from public.roles order by name;
--    If there is no 'admin' row, create one to match your roles table, e.g.:
--      insert into public.roles (name) values ('admin');

-- 1. Ensure a companies row exists for every company_id used by profiles
--    (satisfies the tenants.company_id -> companies.id foreign key).
insert into public.companies (id, name)
select distinct p.company_id, coalesce(cp.company_name, 'Company')
from public.profiles p
left join public.company_profiles cp on cp.tenant_id = p.company_id
where p.company_id is not null
on conflict (id) do nothing;

-- 2. One operational tenant per company, named after the company. Idempotent.
insert into public.tenants (name, company_id)
select distinct coalesce(cp.company_name, 'Company'), p.company_id
from public.profiles p
left join public.company_profiles cp on cp.tenant_id = p.company_id
where p.company_id is not null
  and not exists (select 1 from public.tenants t where t.company_id = p.company_id);

-- 3. Point each company user at their company's tenant.
update public.profiles p
set tenant_id = t.id
from public.tenants t
where t.company_id = p.company_id and p.company_id is not null;

-- 4. Make each company's sole user its admin (first profile in a company = admin).
update public.profiles
set role_id = (select id from public.roles where name = 'admin')
where company_id is not null and role_id is null;

-- 5. OPTIONAL (recommended for testing): move the leftover operational test rows off the
--    shared placeholder tenant onto a real company tenant, so a signed-in user can see them.
--   with target as (
--     select id from public.tenants where company_id is not null order by created_at limit 1)
--   update public.jobs     set tenant_id = (select id from target) where tenant_id = '2f7cc0dc-b7fd-4556-92be-445e4b42ddcd';
--   -- repeat for public.vehicles, public.drivers, etc. as your tests need.

-- VERIFY the reseed:
--   select p.id, p.tenant_id, p.company_id, r.name as role
--   from public.profiles p left join public.roles r on r.id = p.role_id
--   order by p.company_id nulls first;
