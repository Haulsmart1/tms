create function public.undo_planning_collection(p_tenant uuid, p_job uuid, p_actor uuid, p_request uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  job public.jobs%rowtype;
  correction jsonb;
  previous_stops jsonb;
  next_status text;
  recorded_at timestamptz := clock_timestamp();
begin
  if p_tenant is null or p_job is null or p_actor is null or p_request is null then
    raise exception 'Choose a collected job to undo.' using errcode = 'PT400';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request::text, 0));
  select data into correction from public.audit_logs
    where tenant_id = p_tenant and user_id = p_actor and action = 'collection_undone'
      and data->>'clientId' = p_request::text;
  if found then
    if correction->>'job_id' = p_job::text then return correction; end if;
    raise exception 'Undo identifier already used.' using errcode = 'PT409';
  end if;

  select * into job from public.jobs where id = p_job and tenant_id = p_tenant for update;
  if not found then raise exception 'Job not found.' using errcode = 'PT404'; end if;
  perform id from public.job_stops where tenant_id = p_tenant and job_id = p_job order by id for update;

  if coalesce(job.status, '') in ('completed', 'delivered', 'cancelled', 'canceled')
    or coalesce(job.pod_status, '') = 'delivered'
    or job.completed_at is not null
    or exists (select 1 from public.job_stops where tenant_id = p_tenant and job_id = p_job
      and type = 'delivery' and (delivered_at is not null or status in ('completed', 'delivered')
        or pod_status in ('completed', 'delivered'))) then
    raise exception 'Collection cannot be undone after delivery or cancellation.' using errcode = 'PT409';
  end if;

  select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'pod_status', pod_status,
    'collected_at', collected_at, 'delivered_at', delivered_at))
    into previous_stops from public.job_stops
    where tenant_id = p_tenant and job_id = p_job and type = 'collection'
      and coalesce(status, '') not in ('failed', 'cancelled', 'canceled')
      and coalesce(pod_status, '') not in ('failed', 'cancelled', 'canceled')
      and (collected_at is not null or delivered_at is not null
        or status in ('collected', 'completed', 'delivered') or pod_status in ('collected', 'completed', 'delivered'));

  if previous_stops is null and job.status is distinct from 'collected'
    and job.pod_status is distinct from 'collected' then
    raise exception 'This job is no longer marked collected.' using errcode = 'PT409';
  end if;

  perform set_config('tms.stop_actor', p_actor::text, true);
  update public.job_stops set status = 'planned', pod_status = 'pending',
    collected_at = null, delivered_at = null, pod_updated_at = recorded_at,
    attempt_version = coalesce(attempt_version, 0) + 1
    where tenant_id = p_tenant and job_id = p_job
      and id in (select (value->>'id')::uuid from jsonb_array_elements(previous_stops));
  delete from public.stop_eta_cache where tenant_id = p_tenant
    and stop_id in (select (value->>'id')::uuid from jsonb_array_elements(previous_stops));

  next_status := case when job.status = 'collected' then 'planned' else job.status end;
  update public.jobs set status = next_status,
    pod_status = case when pod_status = 'collected' then 'pending' else pod_status end
    where id = p_job and tenant_id = p_tenant;

  correction := jsonb_build_object('clientId', p_request, 'job_id', p_job,
    'recorded_at', recorded_at, 'previous_status', job.status, 'previous_pod_status', job.pod_status,
    'previous_stops', coalesce(previous_stops, '[]'::jsonb), 'status', next_status);
  insert into public.audit_logs(tenant_id, user_id, action, entity, entity_id, data, created_at)
    values (p_tenant, p_actor, 'collection_undone', 'job', p_job, correction, recorded_at);
  return correction;
end;
$$;

revoke all on function public.undo_planning_collection(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.undo_planning_collection(uuid,uuid,uuid,uuid) to service_role;
