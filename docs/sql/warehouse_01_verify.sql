-- Integration acceptance: synthetic jobs only, all fixture writes rolled back.
-- No real job is updated. Run after the warehouse migration.
begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
 t uuid; other_t uuid; actor uuid; vehicle uuid; j1 uuid:=gen_random_uuid(); j2 uuid:=gen_random_uuid();
 s1 uuid:=gen_random_uuid(); s2 uuid:=gen_random_uuid(); p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid();
 req uuid:=gen_random_uuid(); result jsonb; result2 jsonb; finished timestamptz; n integer;
begin
 select id into t from public.tenants where id='2f7cc0dc-b7fd-4556-92be-445e4b42ddcd';
 select id into other_t from public.tenants where id<>t order by id limit 1;
 select id into actor from auth.users where id in (select id from public.profiles) order by id limit 1;
 select v.id into vehicle from public.vehicles v where v.tenant_id=t and exists(
   select 1 from public.vehicle_licences l where l.vehicle_id=v.id and l.active=true) order by v.id limit 1;
 assert t is not null and actor is not null and other_t is not null and vehicle is not null, 'Test prerequisites unavailable';
 insert into public.jobs(id,tenant_id,reference,status) values(j1,t,'WH-VERIFY-ONE','cancelled'),(j2,t,'WH-VERIFY-TWO','completed');
 insert into public.job_stops(id,tenant_id,job_id,stop_order,type,address_line,contact_name,status,last_failed_attempt,attempt_version)
   values(s1,t,j1,1,'collection','Synthetic verification address','Warehouse fixture','failed','{"reason":"fixture"}',1),
     (s2,t,j1,2,'delivery','Synthetic verification depot',null,'planned',null,0);
 insert into public.job_items(tenant_id,job_id,serial_numbers,sku) values(t,j1,array['FD C10930 0000 0001'],'WH-SKU-VERIFY'),
   (t,j2,array['FD C10930 0000 0002'],'WH-SKU-VERIFY');
 result:=public.warehouse_search_jobs(t,'c1093000000001',true);
 assert (result->>'total')::int=1 and result->'jobs'->0->>'id'=j1::text,'Space/FD normalization failed';
 assert (public.warehouse_search_jobs(t,'WH-SKU-VERIFY',true)->>'total')::int=2,'Shared SKU matches must remain ambiguous';
 assert (public.warehouse_search_jobs(t,'Warehouse fixture',false)->>'total')::int=1,'Contact search failed';
 assert (public.warehouse_search_jobs(other_t,'c1093000000001',true)->>'total')::int=0,'Search leaked to another tenant';
 result:=public.warehouse_apply_operation(t,actor,req,'deliver',array[j1]);
 assert (result->>'count')::int=1,'Incorrect operation count';
 assert (select status='completed' and pod_status='delivered' from public.jobs where id=j1),'Cancelled job sign-off failed';
 assert (select count(*)=2 from public.job_stops where job_id=j1 and status='completed'),'Stops not completed together';
 assert (select collected_at is not null and last_failed_attempt is not null and attempt_version=1 from public.job_stops where id=s1),'Failed attempt history lost';
 assert (select 'pod_evidence_deferred'=any(pod_flags) from public.job_stops where id=s2),'Missing photo was not deferred';
 select completed_at into finished from public.jobs where id=j1;
 result2:=public.warehouse_apply_operation(t,actor,req,'deliver',array[j1]);
 assert result=result2,'Retry did not return original result';
 assert (select count(*)=1 from public.warehouse_operations where tenant_id=t and request_id=req),'Duplicate audit on retry';
 begin
   perform public.warehouse_apply_operation(t,actor,req,'reopen',array[j1]);
   raise exception 'Accepted reused request ID';
 exception when sqlstate 'PT409' then null; end;
 begin
   perform public.warehouse_apply_operation(other_t,actor,gen_random_uuid(),'reopen',array[j1]);
   raise exception 'Cross-tenant mutation accepted';
 exception when sqlstate 'PT404' then null; end;
 begin
   perform public.warehouse_apply_operation(t,actor,gen_random_uuid(),'reopen',array[j1,gen_random_uuid()]);
   raise exception 'Partial batch accepted';
 exception when sqlstate 'PT404' then null; end;
 assert (select completed_at=finished from public.jobs where id=j1),'Failed request modified valid job';
 -- A status-only job without stops can still be signed off explicitly by the warehouse.
 perform public.warehouse_apply_operation(t,actor,gen_random_uuid(),'deliver',array[j2]);
 insert into public.planning_saved_plans(id,tenant_id,planning_date,name,snapshot,created_by) values
 (p1,t,'2026-11-09','Warehouse verification source',jsonb_build_object('version',1,'planningDate','2026-11-09','lanes',
   jsonb_build_array(jsonb_build_object('vehicleId',vehicle,'driverId',null,'jobIds',array[j1,j2])),'canonicalItineraries','[]'::jsonb),actor),
 (p2,t,'2026-11-10','Warehouse verification destination',jsonb_build_object('version',1,'planningDate','2026-11-10','lanes','[]'::jsonb,'canonicalItineraries','[]'::jsonb),actor);
 perform public.warehouse_apply_operation(t,actor,gen_random_uuid(),'move',array[j1],vehicle,null,p2,'2026-11-11','Fixture move');
 assert (select vehicle_id=vehicle and planning_date='2026-11-10' and status='completed' and completed_at=finished from public.jobs where id=j1),'Move changed completion or missed plan date';
 assert (select snapshot->'lanes'->0->'jobIds'=to_jsonb(array[j2]) from public.planning_saved_plans where id=p1),'Source plan retained moved job or lost unrelated job';
 assert (select snapshot->'lanes'->0->'jobIds'=to_jsonb(array[j1]) from public.planning_saved_plans where id=p2),'Destination plan missing job';
 begin
   perform public.warehouse_apply_operation(t,actor,gen_random_uuid(),'move',array[j1],vehicle,gen_random_uuid(),p2);
   raise exception 'Invalid driver accepted';
 exception when sqlstate 'PT404' then null; end;
 perform public.warehouse_apply_operation(t,actor,gen_random_uuid(),'move',array[j1]);
 assert (select vehicle_id is null and driver_id is null from public.jobs where id=j1),'Unassign failed';
 assert (select snapshot->'lanes'->0->'jobIds'='[]'::jsonb from public.planning_saved_plans where id=p2),'Unassigned job remained in plan';
 perform public.warehouse_apply_operation(t,actor,gen_random_uuid(),'reopen',array[j1]);
 assert (select status='planned' and completed_at is null from public.jobs where id=j1),'Reopen failed';
 assert (select count(*)=2 from public.job_stops where job_id=j1 and pod_status='pending' and collected_at is null and delivered_at is null),'Reopen did not reset stops';
 assert (select last_failed_attempt is not null from public.job_stops where id=s1),'Reopen lost attempt history';
 perform public.warehouse_apply_operation(t,actor,gen_random_uuid(),'collect',array[j1]);
 assert (select status='collected' from public.jobs where id=j1),'Collection not saved';
 assert (select pod_status='pending' from public.job_stops where id=s2),'Collect also delivered job';
 assert not has_function_privilege('authenticated','public.warehouse_apply_operation(uuid,uuid,uuid,text,uuid[],uuid,uuid,uuid,date,text)','execute'),'Client can call privileged RPC';
 assert not has_function_privilege('anon','public.warehouse_search_jobs(uuid,text,boolean,text,integer)','execute'),'Anonymous search allowed';
 assert not has_table_privilege('authenticated','public.warehouse_operations','insert'),'Client can forge audit';
end $$;
rollback;
select 'Warehouse integration checks passed; all synthetic fixture writes rolled back.' result;
