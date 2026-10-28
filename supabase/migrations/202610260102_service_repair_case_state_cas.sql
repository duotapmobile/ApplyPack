-- A reviewed close must not overwrite feedback or repair work committed while
-- the owner's view was open. Historical099 receipts and paid clocks stay intact.
begin;

create function public.ap_read_service_repair_case_review(p_case_id uuid,p_reviewer_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare customer uuid; report public.ap_service_error_reports; scope jsonb; body jsonb; members jsonb; unfinished boolean;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 customer:=public.ap_lock_service_repair_case(p_case_id,true);
 select * into strict report from public.ap_service_error_reports where id=p_case_id;
 scope:=public.ap_service_repair_scope(p_case_id);
 if (select count(*) from public.ap_service_repair_feedback where case_id=p_case_id)>3000
  or (select count(*) from public.ap_service_repair_case_events where case_id=p_case_id)>3000
  or (select count(*) from public.ap_service_repair_jobs where case_id=p_case_id)>30
 then raise exception 'service_repair_case_review_bound_exceeded'; end if;
 select jsonb_agg(m||jsonb_build_object('artifactType',a.artifact_type,'completed',exists(
  select 1 from public.ap_service_repair_files f join public.ap_service_repair_versions v on v.id=f.repair_version_id
  join public.ap_service_repair_jobs j on j.active_version_id=v.id join public.ap_service_repair_releases r on r.id=v.release_id
  where r.case_id=p_case_id and r.customer_id=customer and f.customer_id=customer
   and v.case_id=p_case_id and v.customer_id=customer and j.case_id=p_case_id and j.customer_id=customer
   and v.job_id=j.id and r.repair_version_id=v.id and r.material_line_id=f.material_line_id
   and v.material_line_id=f.material_line_id and j.material_line_id=f.material_line_id
   and f.material_line_id=(m->>'materialLineId')::uuid and f.artifact_id=(m->>'artifactId')::uuid
   and f.source_snapshot_id=(m->>'sourceSnapshotId')::uuid and f.artifact_type=a.artifact_type
   and f.original_file_version_id=(m->>'fileVersionId')::uuid and v.invalidated_at is null
   and r.committed_at<=clock_timestamp() and v.accepted_scope_sha256=scope->>'acceptedScopeSha256'
   and r.accepted_scope_sha256=scope->>'acceptedScopeSha256'
 )) order by m->>'fileVersionId') into members
 from jsonb_array_elements(scope->'members') m join public.ap_generated_artifacts a on a.id=(m->>'artifactId')::uuid
  and a.customer_id=customer and a.material_line_id=(m->>'materialLineId')::uuid;
 if jsonb_array_length(members) is distinct from jsonb_array_length(scope->'members') then raise exception 'service_repair_scope_invalid'; end if;
 select exists(select 1 from public.ap_service_repair_jobs j join public.ap_service_repair_versions v on v.id=j.active_version_id
  where j.case_id=p_case_id and v.release_id is null) into unfinished;
 -- Only content-free immutable identities/digests and current state enter this
 -- receipt. It authorizes neither rendering, delivery nor a new accepted fact.
 body:=jsonb_build_object('schemaVersion','applypack-service-repair-case-review-v1','caseId',p_case_id,'customerId',customer,
  'materialLineId',report.material_line_id,'scope',scope,'members',members,'unfinished',unfinished,
  'caseState',(select jsonb_build_object('state',state,'resolvedAt',resolved_at) from public.ap_material_support_cases where id=p_case_id),
  'acceptances',(select jsonb_agg(to_jsonb(a) order by a.id) from public.ap_service_error_affected_members a where case_id=p_case_id and member_kind='ACCEPTED_ERROR'),
  'feedback',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.ap_service_repair_feedback f where case_id=p_case_id),'[]'),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.ap_service_repair_case_events e where case_id=p_case_id),'[]'),
  'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'line',j.material_line_id,'activeVersion',j.active_version_id,
    'leaseOwner',j.lease_owner,'leaseToken',j.lease_token,'leaseGeneration',j.lease_generation,'leaseExpiresAt',j.lease_expires_at) order by j.id)
    from public.ap_service_repair_jobs j where case_id=p_case_id),'[]'),
  'versions',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'job',v.job_id,'line',v.material_line_id,'scope',v.accepted_scope_sha256,
    'source',v.source_sha256,'review',v.claim_review_sha256,'memberSet',v.member_set_sha256,'approval',v.approval_sha256,
    'approvedBy',v.approved_by,'approvedAt',v.approved_at,'release',v.release_id,'invalidatedAt',v.invalidated_at) order by v.id)
    from public.ap_service_repair_jobs j join public.ap_service_repair_versions v on v.id=j.active_version_id where j.case_id=p_case_id),'[]'),
  'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'version',f.repair_version_id,'original',f.original_file_version_id,
    'artifact',f.artifact_id,'line',f.material_line_id,'sha256',f.checksum_sha256,'renderSource',f.render_source_sha256) order by f.id)
    from public.ap_service_repair_jobs j join public.ap_service_repair_files f on f.repair_version_id=j.active_version_id where j.case_id=p_case_id),'[]'),
  'releases',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.ap_service_repair_jobs j
    join public.ap_service_repair_releases r on r.repair_version_id=j.active_version_id where j.case_id=p_case_id),'[]'));
 return jsonb_build_object('schemaVersion','applypack-service-repair-case-review-v1','caseId',p_case_id,'customerId',customer,
  'materialLineId',report.material_line_id,'acceptedScopeSha256',scope->>'acceptedScopeSha256',
  'reviewContextSha256',encode(extensions.digest(body::text,'sha256'),'hex'),
  'state',body#>'{caseState,state}','members',members,
  'canResolve',not unfinished and not exists(select 1 from jsonb_array_elements(members) m where m->>'completed'<>'true'),
  'feedback',body->'feedback','events',body->'events');
end $$;

create function public.ap_set_service_repair_case_state_reviewed(p_case_id uuid,p_request_id uuid,p_scope_sha256 text,
 p_expected_review_context_sha256 text,p_resolved boolean,p_payload_id uuid,p_content_sha256 text,p_reviewer_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.ap_service_repair_case_events; reviewed jsonb;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 select * into prior from public.ap_service_repair_case_events where id=p_request_id;
 if found then
  -- The original immutable request remains reconcilable after expiry or later
  -- feedback. Replaying it never resolves/reopens the case for a second time.
  return public.ap_set_service_repair_case_state(p_case_id,p_request_id,p_scope_sha256,p_resolved,p_payload_id,p_content_sha256,p_reviewer_id);
 end if;
 if p_expected_review_context_sha256 is null or p_expected_review_context_sha256!~'^[a-f0-9]{64}$'
  then raise exception 'service_repair_case_review_changed'; end if;
 reviewed:=public.ap_read_service_repair_case_review(p_case_id,p_reviewer_id);
 -- An identical request may have committed while this call waited for the
 -- case lock. Reconcile that immutable receipt before comparing stale context.
 if exists(select 1 from public.ap_service_repair_case_events where id=p_request_id) then
  return public.ap_set_service_repair_case_state(p_case_id,p_request_id,p_scope_sha256,p_resolved,p_payload_id,p_content_sha256,p_reviewer_id);
 end if;
 if reviewed->>'reviewContextSha256' is distinct from p_expected_review_context_sha256
  or reviewed->>'acceptedScopeSha256' is distinct from p_scope_sha256 then raise exception 'service_repair_case_review_changed'; end if;
 if p_resolved and reviewed->>'canResolve' is distinct from 'true' then raise exception 'service_repair_accepted_scope_unfinished'; end if;
 -- Retain099's actual complete-union/no-unreleased-active-version guard in the
 -- same transaction and lock scope as the new review-context comparison.
 return public.ap_set_service_repair_case_state(p_case_id,p_request_id,p_scope_sha256,p_resolved,p_payload_id,p_content_sha256,p_reviewer_id);
end $$;
revoke all on function public.ap_set_service_repair_case_state(uuid,uuid,text,boolean,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ap_read_service_repair_case_review(uuid,uuid) from public,anon,authenticated;
revoke all on function public.ap_set_service_repair_case_state_reviewed(uuid,uuid,text,text,boolean,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.ap_read_service_repair_case_review(uuid,uuid) to service_role;
grant execute on function public.ap_set_service_repair_case_state_reviewed(uuid,uuid,text,text,boolean,uuid,text,uuid) to service_role;
alter function public.ap_read_service_repair_case_review(uuid,uuid) set lock_timeout='5s';
alter function public.ap_set_service_repair_case_state_reviewed(uuid,uuid,text,text,boolean,uuid,text,uuid) set lock_timeout='5s';

create or replace function public.ap_archive_snapshot_schema_supported(p_schema text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(p_schema=any(array[
  '202610250090','202610250091','202610250092','202610250093','202610250094','202610250095',
  '202610250096','202610250097','202610250098','202610250099','202610250100','202610250101','202610260102'
 ]) and exists(select 1 from supabase_migrations.schema_migrations where version=p_schema),false);
$$;
revoke all on function public.ap_archive_snapshot_schema_supported(text) from public,anon,authenticated,service_role;
insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610260102','SERVICE_REPAIR_CASE_STATE_CAS',0,clock_timestamp());
create function public.ap_service_repair_case_state_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610260102' and checkpoint='SERVICE_REPAIR_CASE_STATE_CAS')
 and public.ap_material_clarification_schema_installed()
 and not has_function_privilege('service_role','public.ap_set_service_repair_case_state(uuid,uuid,text,boolean,uuid,text,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.ap_read_service_repair_case_review(uuid,uuid)','EXECUTE')
 and not has_function_privilege('anon','public.ap_set_service_repair_case_state_reviewed(uuid,uuid,text,text,boolean,uuid,text,uuid)','EXECUTE')
 and has_function_privilege('service_role','public.ap_read_service_repair_case_review(uuid,uuid)','EXECUTE')
 and has_function_privilege('service_role','public.ap_set_service_repair_case_state_reviewed(uuid,uuid,text,text,boolean,uuid,text,uuid)','EXECUTE')
 and position('ap_read_service_repair_case_review' in pg_get_functiondef('public.ap_set_service_repair_case_state_reviewed(uuid,uuid,text,text,boolean,uuid,text,uuid)'::regprocedure))>0;
$$;
revoke all on function public.ap_service_repair_case_state_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_service_repair_case_state_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=25 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250101''' in definition)=0
  or position('(''202610250101'',''MATERIAL_CLARIFICATION_CONFIRMATION'')' in definition)=0
  or position('''202610250100'',''202610250101''' in definition)=0
  or position('public.ap_material_clarification_schema_installed()' in definition)=0 then raise exception 'repair_case_state_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=25 as installed','select count(*)=26 as installed');
 definition:=replace(definition,'(''202610250101'',''MATERIAL_CLARIFICATION_CONFIRMATION'')','(''202610250101'',''MATERIAL_CLARIFICATION_CONFIRMATION''),(''202610260102'',''SERVICE_REPAIR_CASE_STATE_CAS'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250101''','''requiredSchemaVersion'', ''202610260102''');
 definition:=replace(definition,'''202610250100'',''202610250101''','''202610250100'',''202610250101'',''202610260102''');
 definition:=replace(definition,'public.ap_material_clarification_schema_installed()','public.ap_material_clarification_schema_installed() and public.ap_service_repair_case_state_schema_installed()');
 execute definition;
end $$;
commit;
