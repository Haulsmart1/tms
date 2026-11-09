begin;
create or replace function public.warehouse_apply_operation(p_tenant uuid, p_actor uuid, p_request uuid, p_action text,
 p_jobs uuid[], p_vehicle uuid default null, p_driver uuid default null, p_plan uuid default null,
 p_date date default null, p_note text default '') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
 v_input jsonb; v_existing public.warehouse_operations%rowtype; v_before jsonb; v_result jsonb;
 v_company uuid; v_date date := p_date; v_count integer; v_now timestamptz := now();
 v_plan record; v_lane jsonb; v_lanes jsonb; v_snapshot jsonb; v_ids jsonb;
 v_affected text[]; v_target_found boolean; v_refs text[]; v_order integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Office warehouse access required.' using errcode='42501'; end if;
 if p_tenant is null or p_actor is null or p_request is null or p_action is null or p_action not in ('collect','deliver','move','reopen')
   or coalesce(cardinality(p_jobs),0) not between 1 and 200 or array_position(p_jobs,null) is not null
   or cardinality(p_jobs)<>(select count(distinct x) from unnest(p_jobs) x) or length(coalesce(p_note,''))>2000 then
   raise exception 'Invalid warehouse operation.' using errcode='PT400';
 end if;
 v_input := jsonb_build_object('action',p_action,'jobs',p_jobs,'vehicle',p_vehicle,'driver',p_driver,'plan',p_plan,'date',p_date,'note',coalesce(p_note,''));
 perform pg_advisory_xact_lock(hashtextextended('warehouse:'||p_tenant::text,0));
 select * into v_existing from public.warehouse_operations where tenant_id=p_tenant and request_id=p_request;
 if found then
   if v_existing.input<>v_input or v_existing.actor_id<>p_actor then raise exception 'This request ID was already used for another operation.' using errcode='PT409'; end if;
   return v_existing.result;
 end if;
 select company_id into v_company from public.tenants where id=p_tenant;
 perform id from public.jobs where tenant_id=p_tenant and id=any(p_jobs) order by id for update;
 get diagnostics v_count = row_count;
 if v_count<>cardinality(p_jobs) then raise exception 'One or more jobs are not in this workspace.' using errcode='PT404'; end if;
 perform id from public.job_stops where tenant_id=p_tenant and job_id=any(p_jobs) order by id for update;
 if p_action='move' then
   if p_vehicle is null and (p_driver is not null or p_plan is not null) then raise exception 'Choose a van for the driver or saved plan.' using errcode='PT400'; end if;
   if p_vehicle is not null and not exists(select 1 from public.vehicles where id=p_vehicle and (tenant_id=p_tenant or tenant_id=v_company)) then
     raise exception 'Vehicle not found in this workspace.' using errcode='PT404'; end if;
   if p_driver is not null and not exists(select 1 from public.drivers where id=p_driver and tenant_id=p_tenant) then
     raise exception 'Driver not found in this workspace.' using errcode='PT404'; end if;
   if p_plan is not null then
     select planning_date into v_date from public.planning_saved_plans where id=p_plan and tenant_id=p_tenant;
     if not found then raise exception 'Saved plan not found in this workspace.' using errcode='PT404'; end if;
   end if;
   if p_vehicle is not null and v_date is null then raise exception 'Choose a planning date.' using errcode='PT400'; end if;
 end if;
 v_before := jsonb_build_object(
   'jobs',(select jsonb_agg(jsonb_build_object('id',id,'status',status,'pod_status',pod_status,'completed_at',completed_at,
     'vehicle_id',vehicle_id,'driver_id',driver_id,'planning_date',planning_date,'route_order',route_order)) from public.jobs where tenant_id=p_tenant and id=any(p_jobs)),
   'stops',(select jsonb_agg(jsonb_build_object('id',id,'job_id',job_id,'status',status,'pod_status',pod_status,
     'collected_at',collected_at,'delivered_at',delivered_at,'pod_flags',pod_flags,'last_failed_attempt',last_failed_attempt))
     from public.job_stops where tenant_id=p_tenant and job_id=any(p_jobs)));
 perform set_config('tms.stop_actor',p_actor::text,true);
 if p_action in ('collect','deliver') then
   -- Office override explicitly reopens a failed attempt before recording success; its history is retained.
   update public.job_stops set status='planned' where tenant_id=p_tenant and job_id=any(p_jobs) and status='failed'
     and (p_action='deliver' or type='collection');
   update public.job_stops s set status='completed',pod_status=case when type='collection' then 'collected' else 'delivered' end,
     collected_at=case when type='collection' then coalesce(collected_at,v_now) else collected_at end,
     delivered_at=case when type='delivery' then coalesce(delivered_at,v_now) else delivered_at end,
     pod_updated_at=v_now,
     pod_flags=case when type='delivery' and pod_photo_url is null and pod_document_url is null and not exists(
       select 1 from public.pod_evidence e where e.tenant_id=p_tenant and e.job_id=s.job_id and e.stop_id=s.id)
       then array(select distinct unnest(pod_flags||array['pod_evidence_deferred'])) else pod_flags end
   where tenant_id=p_tenant and job_id=any(p_jobs) and (p_action='deliver' or type='collection');
   if p_action='deliver' then
     update public.jobs set status='completed',pod_status='delivered',completed_at=coalesce(completed_at,v_now)
       where tenant_id=p_tenant and id=any(p_jobs);
   else
     update public.jobs set status='collected',pod_status='collected'
       where tenant_id=p_tenant and id=any(p_jobs) and coalesce(status,'') not in ('completed','delivered') and coalesce(pod_status,'')<>'delivered';
   end if;
 elsif p_action='reopen' then
   update public.job_stops set status='planned',pod_status='pending',collected_at=null,delivered_at=null,
     pod_updated_at=v_now,pod_flags=array_remove(pod_flags,'pod_evidence_deferred') where tenant_id=p_tenant and job_id=any(p_jobs);
   update public.jobs set status='planned',pod_status='pending',completed_at=null where tenant_id=p_tenant and id=any(p_jobs);
 else
   -- Lock saved plans before editing their snapshots. Retain unrelated lanes and draft metadata.
   for v_plan in select * from public.planning_saved_plans where tenant_id=p_tenant order by id for update loop
     v_lanes := '[]'::jsonb; v_affected := array[]::text[]; v_target_found := false;
     for v_lane in select value from jsonb_array_elements(v_plan.snapshot->'lanes') loop
       if exists(select 1 from jsonb_array_elements_text(v_lane->'jobIds') x where x::uuid=any(p_jobs))
         or (v_plan.id=p_plan and v_lane->>'vehicleId'=p_vehicle::text) then
         v_affected := array_append(v_affected,v_lane->>'vehicleId');
         select coalesce(jsonb_agg(x),'[]'::jsonb) into v_ids from jsonb_array_elements_text(v_lane->'jobIds') x where not x::uuid=any(p_jobs);
         v_lane := jsonb_set(v_lane,'{jobIds}',v_ids);
         if v_plan.id=p_plan and v_lane->>'vehicleId'=p_vehicle::text then
           v_lane := jsonb_set(v_lane,'{jobIds}',v_ids||to_jsonb(p_jobs));
           v_lane := jsonb_set(v_lane,'{preserveJobDrivers}','true'::jsonb);
           -- Existing lane driver belongs to other jobs too; each moved job retains its own selected driver.
           if jsonb_array_length(v_ids)=0 then v_lane := jsonb_set(v_lane,'{driverId}',coalesce(to_jsonb(p_driver),'null'::jsonb)); end if;
           v_target_found := true;
         end if;
       end if;
       v_lanes := v_lanes||jsonb_build_array(v_lane);
     end loop;
     if v_plan.id=p_plan and not v_target_found then
       v_lanes := v_lanes||jsonb_build_array(jsonb_build_object('vehicleId',p_vehicle,'driverId',p_driver,'jobIds',p_jobs,'preserveJobDrivers',true));
       v_affected := array_append(v_affected,p_vehicle::text);
     end if;
     if cardinality(v_affected)>0 then
       v_snapshot := jsonb_set(v_plan.snapshot,'{lanes}',v_lanes);
       v_snapshot := jsonb_set(v_snapshot,'{canonicalItineraries}',coalesce((select jsonb_agg(x) from
         jsonb_array_elements(coalesce(v_snapshot->'canonicalItineraries','[]'::jsonb)) x where not (x->>'vehicleId'=any(v_affected))),'[]'::jsonb));
       if v_snapshot ? 'editorDrafts' then v_snapshot := jsonb_set(v_snapshot,'{editorDrafts}',(v_snapshot->'editorDrafts')-v_affected); end if;
       update public.planning_saved_plans set snapshot=v_snapshot,updated_at=v_now where id=v_plan.id and tenant_id=p_tenant;
     end if;
   end loop;
   -- Invalidate only routes containing moved jobs or the destination day/van, never other workspaces.
   delete from public.planning_route_itineraries i where i.tenant_id=p_tenant and (
     (i.vehicle_id=p_vehicle and i.planning_date=v_date) or exists(select 1 from public.planning_route_visit_stops s
       where s.itinerary_id=i.id and s.job_id=any(p_jobs)));
   select coalesce(max(route_order),0) into v_order from public.jobs where tenant_id=p_tenant and vehicle_id=p_vehicle and planning_date=v_date;
   update public.jobs j set vehicle_id=p_vehicle,driver_id=p_driver,planning_date=v_date,
     route_order=case when p_vehicle is null then null else v_order+array_position(p_jobs,j.id) end,
     assignment_transferred_at=v_now where tenant_id=p_tenant and id=any(p_jobs);
 end if;
 select array_agg(coalesce(reference,id::text) order by reference,id) into v_refs from public.jobs where tenant_id=p_tenant and id=any(p_jobs);
 v_result := jsonb_build_object('count',v_count,'references',v_refs,'action',p_action,'recordedAt',v_now,'planningDate',v_date);
 insert into public.warehouse_operations(tenant_id,request_id,actor_id,action,note,input,before_state,result)
   values(p_tenant,p_request,p_actor,p_action,coalesce(p_note,''),v_input,v_before,v_result);
 return v_result;
end;
$$;

commit;
