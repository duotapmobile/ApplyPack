begin;

-- Internal, pre-delivery owner requests. This does not change customer remedies,
-- provider activation, the paid deadline, spending reservations or attempt caps.
-- Instructions and prior prose use the existing encrypted payload service.
create table public.ap_material_draft_change_requests (
 id uuid primary key,
 customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id),
 job_id uuid not null references public.ap_material_draft_jobs(id),
 parent_version_id uuid not null unique references public.ap_material_draft_versions(id),
 successor_version_id uuid not null unique references public.ap_material_draft_versions(id),
 encrypted_payload_id uuid not null unique references public.ap_sensitive_payloads(id),
 request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
 payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 parent_source_sha256 text not null check(parent_source_sha256 ~ '^[a-f0-9]{64}$'),
 parent_proposal_sha256 text not null check(parent_proposal_sha256 ~ '^[a-f0-9]{64}$'),
 packet_sha256 text not null check(packet_sha256 ~ '^[a-f0-9]{64}$'),
 context_sha256 text not null check(context_sha256 ~ '^[a-f0-9]{64}$'),
 reviewer_id uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 check(parent_version_id<>successor_version_id)
);
alter table public.ap_material_draft_change_requests enable row level security;
revoke all on public.ap_material_draft_change_requests from public,anon,authenticated,service_role;
grant select on public.ap_material_draft_change_requests to service_role;

insert into public.ap_retention_private_tables(table_name,primary_key,redaction_patch)
 values('ap_material_draft_change_requests','id','{}');
create trigger ap_service_retention_write before insert or update on public.ap_material_draft_change_requests
 for each row execute function public.ap_guard_service_retention_write();
create trigger ap_material_draft_change_immutable before update or delete on public.ap_material_draft_change_requests
 for each row execute function public.ap_prevent_immutable_mutation();

create function public.ap_request_material_draft_changes(p_job_id uuid,p_expected_version_id uuid,
 p_expected_source_sha256 text,p_request_id uuid,p_payload_id uuid,p_request_sha256 text,
 p_payload_sha256 text,p_parent_proposal_sha256 text,p_reviewer_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions;
 previous public.ap_material_draft_change_requests; replacement uuid; attempt_limit integer;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 if p_job_id is null or p_expected_version_id is null or p_request_id is null or p_payload_id is null
  or p_expected_source_sha256 is null or p_expected_source_sha256 !~ '^[a-f0-9]{64}$'
  or p_request_sha256 is null or p_request_sha256 !~ '^[a-f0-9]{64}$'
  or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$'
  or p_parent_proposal_sha256 is null or p_parent_proposal_sha256 !~ '^[a-f0-9]{64}$'
  then raise exception 'material_draft_change_input_invalid'; end if;
 -- Serialize a request identity before the standard obligation lock. Exact
 -- completed replay is a metadata receipt, even after expiry; never a new job.
 perform pg_advisory_xact_lock(hashtextextended('material-draft-change:'||p_request_id::text,0));
 select * into previous from public.ap_material_draft_change_requests where id=p_request_id;
 if previous.id is not null then
  if row(previous.job_id,previous.parent_version_id,previous.parent_source_sha256,
    previous.encrypted_payload_id,previous.request_sha256,previous.payload_sha256,
    previous.parent_proposal_sha256,previous.reviewer_id)
   is distinct from row(p_job_id,p_expected_version_id,p_expected_source_sha256,
    p_payload_id,p_request_sha256,p_payload_sha256,p_parent_proposal_sha256,p_reviewer_id)
   then raise exception 'material_draft_change_request_conflict'; end if;
  return previous.successor_version_id;
 end if;
 j:=public.ap_lock_material_draft_job(p_job_id);
 select * into v from public.ap_material_draft_versions where id=p_expected_version_id for update;
 if j.state not in('SOURCE_READY','REVIEW_READY','APPROVED') or j.active_version_id is distinct from v.id
  or v.job_id is distinct from j.id or v.customer_id is distinct from j.customer_id or v.material_line_id is distinct from j.material_line_id
  or v.invalidated_at is not null or v.release_id is not null or v.encrypted_payload_id is null
  or v.source_sha256 is distinct from p_expected_source_sha256
  or v.context_sha256 is distinct from public.ap_material_draft_context_sha256(j.id)
  then raise exception 'material_draft_change_parent_stale'; end if;
 if exists(select 1 from public.ap_material_draft_attempts where job_id=j.id and state in('DISPATCHED','RESULT_UNKNOWN'))
  then raise exception 'material_draft_result_unresolved'; end if;
 -- A lower configured policy limit must not destroy approved work merely to
 -- create a successor that cannot be generated. Dispatch still rechecks policy
 -- and the shared spending reservation under its existing authority.
 select least(3,coalesce((select p.max_attempts from public.ap_material_draft_runtime r
  join public.ap_material_draft_policies p on p.id=r.policy_id where r.singleton),3)) into attempt_limit;
 if (select count(*) from public.ap_material_draft_attempts where job_id=j.id)>=attempt_limit
  then raise exception 'material_draft_attempt_limit'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_payload_id and customer_id=j.customer_id
   and retention_state='ACTIVE' and content_sha256=p_payload_sha256)
  then raise exception 'material_draft_payload_unavailable'; end if;
 if exists(select 1 from public.ap_material_draft_change_requests where parent_version_id=v.id)
  then raise exception 'material_draft_change_parent_stale'; end if;
 update public.ap_material_draft_versions set invalidated_at=clock_timestamp() where id=v.id;
 update public.ap_artifact_quality_reviews set invalidated_at=coalesce(invalidated_at,clock_timestamp())
  where file_version_id in(select file_version_id from public.ap_material_draft_members where draft_version_id=v.id);
 insert into public.ap_material_draft_versions(customer_id,material_line_id,job_id,version,supersedes_id,
  packet_encrypted_payload_id,packet_sha256,context_sha256)
 values(j.customer_id,j.material_line_id,j.id,v.version+1,v.id,v.packet_encrypted_payload_id,v.packet_sha256,v.context_sha256)
 returning id into replacement;
 insert into public.ap_material_draft_change_requests(id,customer_id,material_line_id,job_id,parent_version_id,
  successor_version_id,encrypted_payload_id,request_sha256,payload_sha256,parent_source_sha256,parent_proposal_sha256,
  packet_sha256,context_sha256,reviewer_id)
 values(p_request_id,j.customer_id,j.material_line_id,j.id,v.id,replacement,p_payload_id,p_request_sha256,p_payload_sha256,
  p_expected_source_sha256,p_parent_proposal_sha256,v.packet_sha256,v.context_sha256,p_reviewer_id);
 update public.ap_material_draft_jobs set active_version_id=replacement,state='READY',lease_owner=null,
  lease_token=null,lease_expires_at=null,error_code=null,updated_at=clock_timestamp() where id=j.id;
 update public.ap_material_lines set fulfillment='GENERATING' where id=j.material_line_id;
 insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
 values(j.customer_id,p_reviewer_id,'MATERIAL_DRAFT_CHANGES_REQUESTED','MATERIAL_DRAFT_VERSION',replacement,
  jsonb_build_object('requestId',p_request_id,'parentVersionId',v.id),'material-draft-change-v1');
 return replacement;
end $$;
revoke all on function public.ap_request_material_draft_changes(uuid,uuid,text,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.ap_request_material_draft_changes(uuid,uuid,text,uuid,uuid,text,text,text,uuid) to service_role;

-- Packet refresh appends a descendant version. Resolve its nearest immutable
-- owner request without rebinding the original receipt to newer evidence.
create function public.ap_material_draft_change_evidence(p_version_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare root public.ap_material_draft_versions; node public.ap_material_draft_versions;
 request public.ap_material_draft_change_requests; seen uuid[]:='{}';
begin
 select * into root from public.ap_material_draft_versions where id=p_version_id;
 if root.id is null then raise exception 'material_draft_version_stale'; end if;
 node:=root;
 loop
  if node.id=any(seen) or cardinality(seen)>=64 or node.job_id is distinct from root.job_id
   or node.customer_id is distinct from root.customer_id or node.material_line_id is distinct from root.material_line_id
   then raise exception 'material_draft_change_history_invalid'; end if;
  seen:=array_append(seen,node.id);
  select * into request from public.ap_material_draft_change_requests where successor_version_id=node.id;
  if request.id is not null then
   if request.job_id is distinct from root.job_id or request.customer_id is distinct from root.customer_id
    or request.material_line_id is distinct from root.material_line_id or request.parent_version_id is distinct from node.supersedes_id
    then raise exception 'material_draft_change_history_invalid'; end if;
   return to_jsonb(request);
  end if;
  if node.supersedes_id is null then return null; end if;
  select * into node from public.ap_material_draft_versions where id=node.supersedes_id;
  if node.id is null then raise exception 'material_draft_change_history_invalid'; end if;
 end loop;
end $$;
revoke all on function public.ap_material_draft_change_evidence(uuid) from public,anon,authenticated;
grant execute on function public.ap_material_draft_change_evidence(uuid) to service_role;

-- The previous budget/reservation implementation stays byte-for-byte intact.
-- Only this wrapper may reach it for a request-bound version, so an old worker
-- cannot silently omit the owner's instructions and still reserve a dispatch.
alter function public.ap_begin_material_draft_request(uuid,uuid,uuid,uuid,uuid,integer,integer)
 rename to ap_begin_material_draft_request_before097;
revoke all on function public.ap_begin_material_draft_request_before097(uuid,uuid,uuid,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
create function public.ap_begin_material_draft_request(p_job_id uuid,p_lease_token uuid,p_version_id uuid,p_request_id uuid,p_policy_id uuid,p_input_token_cap integer,p_output_token_cap integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.ap_lock_material_draft_job(p_job_id,p_lease_token);
 if public.ap_material_draft_change_evidence(p_version_id) is not null then raise exception 'material_draft_change_evidence_required'; end if;
 return public.ap_begin_material_draft_request_before097(p_job_id,p_lease_token,p_version_id,p_request_id,p_policy_id,p_input_token_cap,p_output_token_cap);
end $$;
create function public.ap_begin_material_draft_request_with_changes(p_job_id uuid,p_lease_token uuid,p_version_id uuid,p_request_id uuid,p_policy_id uuid,
 p_input_token_cap integer,p_output_token_cap integer,p_change_request_id uuid,p_change_payload_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; evidence jsonb;
begin
 j:=public.ap_lock_material_draft_job(p_job_id,p_lease_token);
 if j.active_version_id is distinct from p_version_id then raise exception 'material_draft_version_stale'; end if;
 evidence:=public.ap_material_draft_change_evidence(p_version_id);
 if evidence is null or evidence->>'id' is distinct from p_change_request_id::text
  or evidence->>'payload_sha256' is distinct from p_change_payload_sha256
  or evidence->>'job_id' is distinct from j.id::text
  then raise exception 'material_draft_change_evidence_required'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=(evidence->>'encrypted_payload_id')::uuid
  and customer_id=j.customer_id and retention_state='ACTIVE' and content_sha256=p_change_payload_sha256)
  then raise exception 'material_draft_payload_unavailable'; end if;
 return public.ap_begin_material_draft_request_before097(p_job_id,p_lease_token,p_version_id,p_request_id,p_policy_id,p_input_token_cap,p_output_token_cap);
end $$;
revoke all on function public.ap_begin_material_draft_request(uuid,uuid,uuid,uuid,uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.ap_begin_material_draft_request_with_changes(uuid,uuid,uuid,uuid,uuid,integer,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.ap_begin_material_draft_request(uuid,uuid,uuid,uuid,uuid,integer,integer) to service_role;
grant execute on function public.ap_begin_material_draft_request_with_changes(uuid,uuid,uuid,uuid,uuid,integer,integer,uuid,text) to service_role;

alter function public.ap_request_material_draft_changes(uuid,uuid,text,uuid,uuid,text,text,text,uuid) set lock_timeout='5s';
alter function public.ap_begin_material_draft_request(uuid,uuid,uuid,uuid,uuid,integer,integer) set lock_timeout='5s';
alter function public.ap_begin_material_draft_request_with_changes(uuid,uuid,uuid,uuid,uuid,integer,integer,uuid,text) set lock_timeout='5s';

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610250097','MATERIAL_DRAFT_CHANGE_REQUESTS',0,clock_timestamp());
create function public.ap_material_draft_change_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250097' and checkpoint='MATERIAL_DRAFT_CHANGE_REQUESTS')
 and exists(select 1 from public.ap_retention_private_tables where table_name='ap_material_draft_change_requests' and redaction_patch='{}')
 and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='ap_material_draft_change_requests' and c.relrowsecurity)
 and (select count(*)=2 from pg_trigger where tgrelid='public.ap_material_draft_change_requests'::regclass and not tgisinternal and tgenabled in('O','A')
  and (tgname='ap_service_retention_write' and tgfoid='public.ap_guard_service_retention_write()'::regprocedure
   or tgname='ap_material_draft_change_immutable' and tgfoid='public.ap_prevent_immutable_mutation()'::regprocedure))
 and to_regprocedure('public.ap_request_material_draft_changes(uuid,uuid,text,uuid,uuid,text,text,text,uuid)') is not null
 and to_regprocedure('public.ap_material_draft_change_evidence(uuid)') is not null
 and to_regprocedure('public.ap_begin_material_draft_request_with_changes(uuid,uuid,uuid,uuid,uuid,integer,integer,uuid,text)') is not null
 and position('material_draft_change_evidence_required' in pg_get_functiondef('public.ap_begin_material_draft_request(uuid,uuid,uuid,uuid,uuid,integer,integer)'::regprocedure))>0
 and not has_function_privilege('service_role','public.ap_begin_material_draft_request_before097(uuid,uuid,uuid,uuid,uuid,integer,integer)','EXECUTE')
 and not has_function_privilege('authenticated','public.ap_request_material_draft_changes(uuid,uuid,text,uuid,uuid,text,text,text,uuid)','EXECUTE')
 and not has_table_privilege('service_role','public.ap_material_draft_change_requests','INSERT')
 and not has_table_privilege('authenticated','public.ap_material_draft_change_requests','SELECT');
$$;
revoke all on function public.ap_material_draft_change_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_material_draft_change_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=20 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250096''' in definition)=0
  or position('(''202610250096'',''SERVICE_ERROR_CONTRACT_AND_TRIAGE'')' in definition)=0 or position('''202610250095'',''202610250096''' in definition)=0
  or position('public.ap_service_error_triage_schema_installed()' in definition)=0
  then raise exception 'material_draft_change_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=20 as installed','select count(*)=21 as installed');
 definition:=replace(definition,'(''202610250096'',''SERVICE_ERROR_CONTRACT_AND_TRIAGE'')','(''202610250096'',''SERVICE_ERROR_CONTRACT_AND_TRIAGE''),(''202610250097'',''MATERIAL_DRAFT_CHANGE_REQUESTS'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250096''','''requiredSchemaVersion'', ''202610250097''');
 definition:=replace(definition,'''202610250095'',''202610250096''','''202610250095'',''202610250096'',''202610250097''');
 definition:=replace(definition,'public.ap_service_error_triage_schema_installed()','public.ap_service_error_triage_schema_installed() and public.ap_material_draft_change_schema_installed()');
 execute definition;
end $$;

commit;
