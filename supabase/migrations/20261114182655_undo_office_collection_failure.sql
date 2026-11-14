create function public.undo_office_collection_failure(
  p_tenant uuid, p_job uuid, p_stop uuid, p_actor uuid, p_request uuid, p_attempt uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  j public.jobs%rowtype;
  s public.job_stops%rowtype;
  correction jsonb;
  recorded_at timestamptz := clock_timestamp();
begin
  if p_tenant is null or p_actor is null or p_request is null or p_attempt is null then
    raise exception 'Choose a failed collection to undo.' using errcode = 'PT400';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request::text, 0));
  select data into correction from public.audit_logs
    where tenant_id = p_tenant and user_id = p_actor and action = 'stop_failure_undone'
      and data->>'clientId' = p_request::text;
  if found then
    if correction->>'job_id' = p_job::text and correction->>'stop_id' = p_stop::text
      and correction->>'attempt_id' = p_attempt::text then return correction; end if;
    raise exception 'Undo identifier already used.' using errcode = 'PT409';
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
    or s.status is distinct from 'failed' or s.pod_status is distinct from 'failed'
    or (s.last_failed_attempt->>'clientId') is distinct from p_attempt::text
    or not coalesce(s.last_failed_attempt->'flags' ? 'office', false) then
    raise exception 'The collection status changed. Refresh the plan.' using errcode = 'PT409';
  end if;

  perform set_config('tms.stop_actor', p_actor::text, true);
  update public.job_stops set status = 'planned', pod_status = 'pending',
    attempt_version = coalesce(s.attempt_version, 0) + 1, pod_updated_at = recorded_at
    where id = s.id and tenant_id = p_tenant;
  delete from public.stop_eta_cache where tenant_id = p_tenant and stop_id = s.id;

  correction := jsonb_build_object(
    'job_id',p_job,'stop_id',p_stop,'clientId',p_request,'attempt_id',p_attempt,
    'recorded_at',recorded_at
  );
  insert into public.audit_logs(tenant_id,user_id,action,entity,entity_id,data,created_at)
    values (p_tenant,p_actor,'stop_failure_undone','job_stop',s.id,correction,recorded_at);
  return correction;
end;
$$;

revoke all on function public.undo_office_collection_failure(uuid,uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.undo_office_collection_failure(uuid,uuid,uuid,uuid,uuid,uuid) to service_role;
