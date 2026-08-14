begin;

create table if not exists public.accounting_oauth_credentials (
  id uuid primary key default gen_random_uuid(),

  tenant_id uuid not null,

  integration_id uuid not null
    references public.accounting_integrations(id)
    on delete cascade,

  provider text not null,

  access_token_encrypted text not null,

  refresh_token_encrypted text,

  token_type text,

  scope text,

  expires_at timestamptz,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()
);

create unique index if not exists accounting_oauth_credentials_integration_idx
  on public.accounting_oauth_credentials(integration_id);

create unique index if not exists accounting_oauth_credentials_tenant_provider_idx
  on public.accounting_oauth_credentials(tenant_id, provider);

alter table public.accounting_oauth_credentials enable row level security;

-- Intentionally no authenticated-user policy.
-- Only the service-role client in server routes should access this table.

revoke all on public.accounting_oauth_credentials from anon;
revoke all on public.accounting_oauth_credentials from authenticated;

grant select, insert, update, delete
on public.accounting_oauth_credentials
to service_role;

notify pgrst, 'reload schema';

commit;
