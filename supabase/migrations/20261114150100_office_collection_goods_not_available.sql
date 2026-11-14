create or replace function public.office_collection_failure(
  p_tenant uuid, p_job uuid, p_stop uuid, p_actor uuid, p_request uuid, p_reason text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  j public.jobs%rowtype;
  s public.job_stops%rowtype;
  attempt jsonb;
  recorded_at timestamptz := clock_timestamp();
begin
  if p_request is null or p_actor is null or p_reason is null
    or p_reason not in ('not_in', 'customer_uncontactable', 'goods_not_available') then
    raise exception 'Choose a collection failure reason.' using errcode = 'PT400';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request::text, 0));
  select data into attempt from public.audit_logs
    where tenant_id = p_tenant and user_id = p_actor and action = 'stop_failed'
      and data->>'clientId' = p_request::text;
  if found then
    if attempt->>'job_id' = p_job::text and attempt->>'stop_id' = p_stop::text
      and attempt->>'reason' = p_reason then return attempt; end if;
    raise exception 'Attempt identifier already used.' using errcode = 'PT409';
  end if;

  select * into j from public.jobs where id = p_job and tenant_id = p_tenant for update;
  if not found then raise exception 'Job not found.' using errcode = 'PT404'; end if;
  if coalesce(j.status, '') in ('completed','delivered','collected','cancelled','canceled')
    or coalesce(j.pod_status, '') in ('collected','delivered') then
    raise exception 'This job is no longer awaiting collection.' using errcode = 'PT409';
  end if;

  select * into s from public.job_stops where id = p_stop and job_id = p_job
    and tenant_id = p_tenant and type = 'collection' for update;
  if not found then raise exception 'Collection stop not found.' using errcode = 'PT404'; end if;
  if s.collected_at is not null or s.delivered_at is not null
    or coalesce(s.status, '') in ('failed','completed','collected','delivered','cancelled','canceled')
    or coalesce(s.pod_status, '') in ('failed','completed','collected','delivered','cancelled','canceled') then
    raise exception 'The collection status changed. Refresh the plan.' using errcode = 'PT409';
  end if;

  attempt := jsonb_build_object(
    'job_id',p_job,'stop_id',p_stop,'stop_type',s.type,'driver_id',j.driver_id,
    'vehicle_id',j.vehicle_id,'clientId',p_request,'operation','fail','reason',p_reason,
    'notes','Recorded from the Planning van card.','recorded_at',recorded_at,'received_at',recorded_at,
    'attempt_version',s.attempt_version,'flags',jsonb_build_array('office')
  );
  update public.job_stops set status = 'failed', pod_status = 'failed', last_failed_attempt = attempt,
    attempt_version = coalesce(s.attempt_version, 0) + 1, pod_updated_at = recorded_at
    where id = s.id and tenant_id = p_tenant;
  insert into public.audit_logs(tenant_id,user_id,action,entity,entity_id,data,created_at)
    values (p_tenant,p_actor,'stop_failed','job_stop',s.id,attempt,recorded_at);
  delete from public.stop_eta_cache where tenant_id = p_tenant and stop_id = s.id;
  return attempt;
end;
$$;

revoke all on function public.office_collection_failure(uuid,uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.office_collection_failure(uuid,uuid,uuid,uuid,uuid,text) to service_role;
