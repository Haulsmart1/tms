begin;

create table if not exists public.planning_saved_plans (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    planning_date date not null,
    name text not null,
    snapshot jsonb not null,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint planning_saved_plans_name_not_blank
        check (length(btrim(name)) > 0),

    constraint planning_saved_plans_name_length
        check (char_length(name) <= 120),

    constraint planning_saved_plans_snapshot_object
        check (jsonb_typeof(snapshot) = 'object')
);

create index if not exists planning_saved_plans_tenant_date_idx
    on public.planning_saved_plans (
        tenant_id,
        planning_date,
        updated_at desc
    );

alter table public.planning_saved_plans enable row level security;

drop policy if exists planning_saved_plans_select
    on public.planning_saved_plans;

create policy planning_saved_plans_select
    on public.planning_saved_plans
    for select
    to authenticated
    using (
        public.can_access_tenant(tenant_id)
    );

drop policy if exists planning_saved_plans_insert
    on public.planning_saved_plans;

create policy planning_saved_plans_insert
    on public.planning_saved_plans
    for insert
    to authenticated
    with check (
        public.can_access_tenant(tenant_id)
        and created_by = auth.uid()
    );

drop policy if exists planning_saved_plans_update
    on public.planning_saved_plans;

create policy planning_saved_plans_update
    on public.planning_saved_plans
    for update
    to authenticated
    using (
        public.can_access_tenant(tenant_id)
    )
    with check (
        public.can_access_tenant(tenant_id)
    );

drop policy if exists planning_saved_plans_delete
    on public.planning_saved_plans;

create policy planning_saved_plans_delete
    on public.planning_saved_plans
    for delete
    to authenticated
    using (
        public.can_access_tenant(tenant_id)
    );

revoke all
    on public.planning_saved_plans
    from anon;

grant select, insert, update, delete
    on public.planning_saved_plans
    to authenticated;

grant select, insert, update, delete
    on public.planning_saved_plans
    to service_role;

comment on table public.planning_saved_plans is
    'Named planning snapshots that can be reopened without immediately mutating operational jobs.';

comment on column public.planning_saved_plans.snapshot is
    'Versioned planning-board snapshot containing lane assignments, driver assignments, job order and canonical itinerary identity.';

commit;