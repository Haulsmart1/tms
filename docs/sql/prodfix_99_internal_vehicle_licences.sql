-- Apply before deploying the matching code; grant no internal licences until
-- that deployment is verified. Older code counts every active licence.
-- Existing rows remain paid; no existing billing records are rewritten.
alter table public.vehicle_licences
  add column billing_mode text not null default 'paid',
  add column internal_authorised_by uuid references public.profiles(id) on delete restrict,
  add column internal_authorised_at timestamptz,
  add column internal_reason text;

alter table public.vehicle_licences add constraint vehicle_licence_billing_mode_check
  check (billing_mode in ('paid', 'internal'));
alter table public.vehicle_licences add constraint vehicle_licence_internal_audit_check
  check ((billing_mode = 'paid' and internal_authorised_by is null
          and internal_authorised_at is null and internal_reason is null)
      or (billing_mode = 'internal' and internal_authorised_by is not null
          and internal_authorised_at is not null and length(btrim(internal_reason)) > 0
          and internal_reason is not null));

comment on column public.vehicle_licences.billing_mode is
  'paid contributes to billing; internal is an authorised zero-charge operational licence. Immutable.';

-- security_invoker preserves vehicle_licences RLS for office reporting. Billing
-- services and both billing models use this same view, including history.
create view public.billable_vehicle_licences with (security_invoker = true) as
  select * from public.vehicle_licences where billing_mode = 'paid';
grant select on public.billable_vehicle_licences to authenticated, service_role;
revoke all on public.billable_vehicle_licences from anon;

create function public.guard_internal_vehicle_licence() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.billing_mode = 'internal' then
      raise exception 'Internal vehicle authorisation must be retained for audit; deactivate instead';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.billing_mode is distinct from old.billing_mode
       or new.internal_authorised_by is distinct from old.internal_authorised_by
       or new.internal_authorised_at is distinct from old.internal_authorised_at
       or new.internal_reason is distinct from old.internal_reason
       or (old.billing_mode = 'internal' and
           (new.vehicle_id is distinct from old.vehicle_id or new.tenant_id is distinct from old.tenant_id)) then
      raise exception 'Licence billing classification and internal authorisation are immutable';
    end if;
    if new.vehicle_id is not distinct from old.vehicle_id then return new; end if;
  end if;
  if new.billing_mode = 'internal' then
    if current_user not in ('postgres', 'supabase_admin', 'service_role') then
      raise exception 'Internal authorisation is server-only' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id
                   where p.id = new.internal_authorised_by and r.name = 'super_admin') then
      raise exception 'Internal vehicle authorisation requires a platform super admin' using errcode = '42501';
    end if;
    if not exists (select 1 from public.vehicles v where v.id = new.vehicle_id and v.tenant_id = new.tenant_id) then
      raise exception 'Internal licence tenant does not match vehicle';
    end if;
  end if;
  -- Serialize paid and internal inserts, including the ordinary activation API.
  perform 1 from public.vehicles where id = new.vehicle_id for update;
  if exists (select 1 from public.vehicle_licences l where l.vehicle_id = new.vehicle_id
             and l.billing_mode <> new.billing_mode) then
    raise exception 'Paid and internal licence history cannot be mixed for one vehicle';
  end if;
  return new;
end $$;
create trigger guard_internal_vehicle_licence before insert or update or delete
  on public.vehicle_licences for each row execute function public.guard_internal_vehicle_licence();

-- Supported administrator operation, idempotent and atomic. No charges,
-- invoices, subscription changes, coverage or billing periods are touched.
-- Refuses conversion of paid history; such a conversion needs its own policy.
create function public.grant_internal_vehicle_licence(
  p_vehicle_id uuid, p_authorised_by uuid, p_reason text
) returns uuid language plpgsql set search_path = '' as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'Internal authorisation is server-only' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'An authorisation reason is required';
  end if;
  if not exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id
                 where p.id = p_authorised_by and r.name = 'super_admin') then
    raise exception 'Internal vehicle authorisation requires a platform super admin' using errcode = '42501';
  end if;
  select tenant_id into v_tenant from public.vehicles where id = p_vehicle_id and active is true for update;
  if not found then raise exception 'Active vehicle not found'; end if;
  if exists (select 1 from public.vehicle_licences where vehicle_id = p_vehicle_id and billing_mode = 'paid') then
    raise exception 'Paid licence history exists; conversion is not supported';
  end if;
  select id into v_id from public.vehicle_licences where vehicle_id = p_vehicle_id
    and billing_mode = 'internal' and active is true order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.vehicle_licences
    (tenant_id, vehicle_id, licence_type, active, billing_mode,
     internal_authorised_by, internal_authorised_at, internal_reason, created_by)
  values (v_tenant, p_vehicle_id, 'Free internal TMS', true, 'internal',
          p_authorised_by, now(), btrim(p_reason), p_authorised_by)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.grant_internal_vehicle_licence(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.grant_internal_vehicle_licence(uuid, uuid, text) to service_role;
revoke all on function public.guard_internal_vehicle_licence() from public, anon, authenticated;

-- Rollback: before reverting application code, deactivate ALL internal rows.
-- Keep the schema and audit rows. Reverting code while one remains active
-- would restore the old billable-count rule and risk billing that vehicle.
