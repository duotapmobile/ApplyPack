-- A delivered service-error obligation is separate from a new paid drafting
-- obligation. Original paid deadlines, capacity, releases and files never move.
-- No provider policy, legal contract, scheduler or hosted delivery is enabled.
begin;

create table public.ap_service_repair_jobs(
 id uuid primary key,case_id uuid not null references public.ap_service_error_reports(id),
 customer_id uuid not null references public.profiles(id),material_line_id uuid not null references public.ap_material_lines(id),
 active_version_id uuid,lease_owner uuid,lease_token uuid,lease_generation integer not null default 0,
 lease_expires_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 unique(case_id,material_line_id),check((lease_token is null)=(lease_expires_at is null)));
create table public.ap_service_repair_versions(
 id uuid primary key,request_id uuid not null unique,job_id uuid not null references public.ap_service_repair_jobs(id),
 case_id uuid not null references public.ap_service_error_reports(id),customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id),version integer not null check(version>0),
 supersedes_id uuid references public.ap_service_repair_versions(id),accepted_scope_sha256 text not null check(accepted_scope_sha256~'^[a-f0-9]{64}$'),
 originals jsonb not null check(jsonb_typeof(originals)='array' and jsonb_array_length(originals) between 1 and 3),
 context_sha256 text not null check(context_sha256~'^[a-f0-9]{64}$'),
 encrypted_payload_id uuid references public.ap_sensitive_payloads(id),source_sha256 text check(source_sha256~'^[a-f0-9]{64}$'),
 claim_review_encrypted_payload_id uuid references public.ap_sensitive_payloads(id),claim_review_sha256 text check(claim_review_sha256~'^[a-f0-9]{64}$'),
 claim_review_metadata jsonb,claims_reviewed_by uuid references public.profiles(id),claims_reviewed_at timestamptz,
 member_set_sha256 text check(member_set_sha256~'^[a-f0-9]{64}$'),approval_sha256 text check(approval_sha256~'^[a-f0-9]{64}$'),
 review_checklist jsonb,approved_by uuid references public.profiles(id),approved_at timestamptz,
 release_id uuid,invalidated_at timestamptz,created_by uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),
 unique(job_id,version),check((encrypted_payload_id is null)=(source_sha256 is null)));
alter table public.ap_service_repair_jobs add foreign key(active_version_id) references public.ap_service_repair_versions(id);
create table public.ap_service_repair_files(
 id uuid primary key,repair_version_id uuid not null references public.ap_service_repair_versions(id),
 customer_id uuid not null references public.profiles(id),material_line_id uuid not null references public.ap_material_lines(id),
 artifact_id uuid not null references public.ap_generated_artifacts(id),original_file_version_id uuid not null references public.ap_generated_file_versions(id),
 source_snapshot_id uuid not null references public.ap_intake_snapshots(id),artifact_type public.ap_artifact_type not null,
 storage_bucket text not null check(storage_bucket='customer-deliveries'),storage_path text unique,
 safe_filename text,mime_type text not null,size_bytes integer not null check(size_bytes between 1 and 33554432),
 checksum_sha256 text not null check(checksum_sha256~'^[a-f0-9]{64}$'),
 render_source_sha256 text not null check(render_source_sha256~'^[a-f0-9]{64}$'),
 preview_bucket text not null check(preview_bucket='operator-render-previews'),preview_path text unique,preview_sha256 text not null check(preview_sha256~'^[a-f0-9]{64}$'),
 editable_bucket text not null check(editable_bucket='operator-drafts'),editable_path text unique,editable_sha256 text not null check(editable_sha256~'^[a-f0-9]{64}$'),
 registration jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(repair_version_id,original_file_version_id));
create table public.ap_service_repair_releases(
 id uuid primary key,repair_version_id uuid not null unique references public.ap_service_repair_versions(id),
 case_id uuid not null references public.ap_service_error_reports(id),customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id),order_id uuid not null references public.orders(id),
 outbox_id uuid not null unique references public.ap_outbox_messages(id),accepted_scope_sha256 text not null,
 member_set_sha256 text not null,approval_sha256 text not null,approved_by uuid not null references public.profiles(id),
 committed_at timestamptz not null,access_expires_at timestamptz not null,
 check(access_expires_at=committed_at+interval '720 hours'));
alter table public.ap_service_repair_versions add foreign key(release_id) references public.ap_service_repair_releases(id);
create table public.ap_service_repair_case_events(
 id uuid primary key,case_id uuid not null references public.ap_service_error_reports(id),customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id),kind text not null check(kind in('RESOLVED','REOPENED')),
 accepted_scope_sha256 text not null check(accepted_scope_sha256~'^[a-f0-9]{64}$'),
 sensitive_payload_id uuid not null references public.ap_sensitive_payloads(id),content_sha256 text not null check(content_sha256~'^[a-f0-9]{64}$'),
 reviewer_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp());
create table public.ap_service_repair_feedback(
 id uuid primary key,case_id uuid not null references public.ap_service_error_reports(id),customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id),repair_release_id uuid not null references public.ap_service_repair_releases(id),
 sensitive_payload_id uuid not null references public.ap_sensitive_payloads(id),content_sha256 text not null check(content_sha256~'^[a-f0-9]{64}$'),
 members jsonb not null check(jsonb_typeof(members)='array' and jsonb_array_length(members) between 1 and 3),created_at timestamptz not null default clock_timestamp());

create function public.ap_guard_service_repair_identity() returns trigger language plpgsql security definer set search_path='' as $$
declare allowed text[]; key text;
begin
 if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,to_jsonb(old),to_jsonb(new)) then return new; end if;
 if tg_op='DELETE' then raise exception 'service_repair_history_immutable'; end if;
 if tg_table_name='ap_service_repair_versions' then
  allowed:=array['encrypted_payload_id','source_sha256','claim_review_encrypted_payload_id','claim_review_sha256','claim_review_metadata',
   'claims_reviewed_by','claims_reviewed_at','member_set_sha256','approval_sha256','review_checklist','approved_by','approved_at','invalidated_at','release_id'];
  if to_jsonb(old)-allowed is distinct from to_jsonb(new)-allowed then raise exception 'service_repair_identity_immutable'; end if;
  foreach key in array allowed loop
   if to_jsonb(old)->key is distinct from 'null'::jsonb and to_jsonb(old)->key is distinct from to_jsonb(new)->key then raise exception 'service_repair_version_write_once'; end if;
  end loop;
 elsif tg_table_name='ap_service_repair_jobs' then
  if to_jsonb(old)-array['active_version_id','lease_owner','lease_token','lease_generation','lease_expires_at'] is distinct from to_jsonb(new)-array['active_version_id','lease_owner','lease_token','lease_generation','lease_expires_at']
   or new.lease_generation<old.lease_generation then raise exception 'service_repair_identity_immutable'; end if;
 end if;
 return new;
end $$;
create trigger ap_service_repair_identity before update or delete on public.ap_service_repair_jobs for each row execute function public.ap_guard_service_repair_identity();
create trigger ap_service_repair_identity before update or delete on public.ap_service_repair_versions for each row execute function public.ap_guard_service_repair_identity();

-- Only finite ASCII identities use this encoding. SQL and the pure contract
-- both sort keys recursively, preserve array order and use compact JSON.
create function public.ap_service_repair_identity_json(p_value jsonb) returns text language plpgsql immutable set search_path='' as $$
declare result text;
begin
 case jsonb_typeof(p_value)
 when 'object' then select '{'||coalesce(string_agg(to_json(key)::text||':'||public.ap_service_repair_identity_json(value),',' order by key),'')||'}' into result from jsonb_each(p_value);
 when 'array' then select '['||coalesce(string_agg(public.ap_service_repair_identity_json(value),',' order by position),'')||']' into result from jsonb_array_elements(p_value) with ordinality e(value,position);
 else result:=p_value::text;
 end case; return result;
end $$;
create function public.ap_service_repair_scope(p_case uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid; members jsonb; body jsonb; total integer;
begin
 select customer_id into customer from public.ap_service_error_reports where id=p_case;
 select count(*) into total from public.ap_service_error_affected_members where case_id=p_case and member_kind='ACCEPTED_ERROR';
 if customer is null or total not between 1 and 3000 then raise exception 'service_repair_scope_unavailable'; end if;
 if exists(select 1 from public.ap_service_error_affected_members a where a.case_id=p_case and a.member_kind='ACCEPTED_ERROR' and
  (a.customer_id<>customer or not exists(select 1 from public.ap_service_error_decisions d where d.id=a.decision_id and d.case_id=p_case and d.customer_id=customer and d.classification='CONFIRMED_SERVICE_ERROR')))
  or exists(select 1 from public.ap_service_error_affected_members where case_id=p_case and member_kind='ACCEPTED_ERROR' group by file_version_id having count(distinct (material_line_id,source_snapshot_id,artifact_id,release_id))<>1)
  then raise exception 'service_repair_scope_invalid'; end if;
 select jsonb_agg(jsonb_build_object('materialLineId',material_line_id,'sourceSnapshotId',source_snapshot_id,'artifactId',artifact_id,'fileVersionId',file_version_id,'releaseId',release_id) order by file_version_id) into members
 from (select distinct material_line_id,source_snapshot_id,artifact_id,file_version_id,release_id from public.ap_service_error_affected_members where case_id=p_case and member_kind='ACCEPTED_ERROR') m;
 if jsonb_array_length(members)>30 then raise exception 'service_repair_scope_bound_exceeded'; end if;
 body:=jsonb_build_object('schemaVersion','applypack-service-error-accepted-scope-v1','caseId',p_case,'customerId',customer,'members',members);
 return body||jsonb_build_object('acceptedScopeSha256',encode(extensions.digest(public.ap_service_repair_identity_json(body),'sha256'),'hex'));
end $$;

create function public.ap_service_repair_originals(p_case uuid,p_line uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare scope jsonb:=public.ap_service_repair_scope(p_case); member jsonb; result jsonb:='[]'; original jsonb;
begin
 for member in select value from jsonb_array_elements(scope->'members') where value->>'materialLineId'=p_line::text order by value->>'fileVersionId' loop
  perform public.ap_service_error_member((scope->>'customerId')::uuid,jsonb_build_object('artifactId',member->>'artifactId','fileVersionId',member->>'fileVersionId','releaseId',member->>'releaseId'));
  select member||jsonb_build_object('artifactType',m.artifact_type,'checksumSha256',f.checksum_sha256,'draftVersionId',v.id,'draftJobId',v.job_id,
   'packetPayloadId',v.packet_encrypted_payload_id,'packetSha256',v.packet_sha256,'sourcePayloadId',v.encrypted_payload_id,'sourceSha256',v.source_sha256,
   'revisionId',r.id,'revisionVersion',r.version,'bindingSha256',r.binding_sha256,'approvedAt',v.approved_at,'deliveredAt',release.committed_at) into original
  from public.ap_material_draft_members m join public.ap_material_draft_versions v on v.id=m.draft_version_id
  join public.ap_material_draft_jobs j on j.id=v.job_id join public.ap_material_line_revisions r on r.id=j.line_revision_id
  join public.ap_generated_file_versions f on f.id=m.file_version_id join public.ap_releases release on release.id=v.release_id
  join public.ap_sensitive_payloads packet on packet.id=v.packet_encrypted_payload_id and packet.customer_id=v.customer_id and packet.content_sha256=v.packet_sha256 and packet.retention_state='ACTIVE'
  join public.ap_sensitive_payloads source on source.id=v.encrypted_payload_id and source.customer_id=v.customer_id and source.content_sha256=v.source_sha256 and source.retention_state='ACTIVE'
  where f.id=(member->>'fileVersionId')::uuid and release.id=(member->>'releaseId')::uuid and v.customer_id=(scope->>'customerId')::uuid
   and r.source_snapshot_id=(member->>'sourceSnapshotId')::uuid and v.approved_at is not null and v.approved_at<=release.committed_at;
  if original is null then raise exception 'service_repair_original_unavailable'; end if;
  result:=result||jsonb_build_array(original);
 end loop;
 if jsonb_array_length(result) not between 1 and 3 then raise exception 'service_repair_line_scope_invalid'; end if;
 return result;
end $$;

-- The customer lock is the same lock used by triage, privacy cleanup and paid
-- mutations. Lock all affected lines in UUID order before any repair row lock.
create function public.ap_lock_service_repair_case(p_case uuid,p_allow_resolved boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare report public.ap_service_error_reports; line uuid;
begin
 select * into report from public.ap_service_error_reports where id=p_case;
 if report.id is null then raise exception 'service_repair_case_unavailable'; end if;
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'service_error_restore_locked'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||report.customer_id::text,0));
 for line in select distinct material_line_id from public.ap_service_error_affected_members where case_id=p_case and member_kind='ACCEPTED_ERROR' order by material_line_id loop
  perform public.ap_service_error_lock(report.customer_id,line);
 end loop;
 perform 1 from public.ap_material_support_cases where id=p_case and customer_id=report.customer_id and (p_allow_resolved or state='OPEN') for update;
 if not found then raise exception 'service_repair_case_unavailable'; end if;
 if exists(select 1 from public.ap_service_retention_claims where customer_id=report.customer_id and state='PENDING') then raise exception 'service_retention_purge_committed'; end if;
 return report.customer_id;
end $$;
create function public.ap_service_repair_context(p_case uuid,p_line uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare originals jsonb:=public.ap_service_repair_originals(p_case,p_line); body jsonb;
begin
 -- Historical facts are not refreshed or silently replaced with a newer intake.
 -- Current retention/consent metadata still fences access to the old evidence.
 body:=jsonb_build_object('scope',public.ap_service_repair_scope(p_case),'originals',originals,
 'acceptances',(select jsonb_agg(to_jsonb(a) order by id) from public.ap_service_error_affected_members a where case_id=p_case and member_kind='ACCEPTED_ERROR'),
 'feedback',(select jsonb_agg(to_jsonb(f) order by id) from public.ap_service_repair_feedback f where case_id=p_case),
 'facts',(select jsonb_agg(to_jsonb(f) order by f.id) from public.ap_candidate_facts f where f.snapshot_id in(select (value->>'sourceSnapshotId')::uuid from jsonb_array_elements(originals))
  or f.id in(select i.contact_payload_id from public.ap_material_lines l join public.ap_material_purchases p on p.id=l.purchase_id join public.ap_material_checkout_intents i on i.id=p.checkout_intent_id where l.id=p_line)),
 'references',(select jsonb_agg(jsonb_build_object('permission',to_jsonb(p),'version',to_jsonb(v),'record',to_jsonb(r),'payload',jsonb_build_object('id',s.id,'hash',s.content_sha256,'state',s.retention_state,'context',s.encryption_context_hash)) order by p.id)
  from public.ap_reference_permissions p join public.ap_reference_record_versions v on v.id=p.reference_record_version_id join public.ap_reference_records r on r.id=v.reference_record_id join public.ap_sensitive_payloads s on s.id=v.encrypted_payload_id
  where p.id in(select l.reference_permission_id from public.ap_artifact_reference_permissions l where l.artifact_id in(select (value->>'artifactId')::uuid from jsonb_array_elements(originals)))));
 return encode(extensions.digest(body::text,'sha256'),'hex');
end $$;
create function public.ap_assert_service_repair_current(p_version uuid,p_lease uuid default null) returns public.ap_service_repair_versions language plpgsql security definer set search_path='' as $$
declare v public.ap_service_repair_versions; j public.ap_service_repair_jobs;
begin
 select * into v from public.ap_service_repair_versions where id=p_version;
 perform public.ap_lock_service_repair_case(v.case_id);
 select * into j from public.ap_service_repair_jobs where id=v.job_id for update;
 select * into v from public.ap_service_repair_versions where id=p_version for update;
 if v.id is distinct from j.active_version_id or v.invalidated_at is not null or v.release_id is not null
  or v.accepted_scope_sha256 is distinct from public.ap_service_repair_scope(v.case_id)->>'acceptedScopeSha256'
  or v.context_sha256 is distinct from public.ap_service_repair_context(v.case_id,v.material_line_id)
  or p_lease is not null and (j.lease_token is distinct from p_lease or j.lease_expires_at<=clock_timestamp()) then raise exception 'service_repair_version_stale'; end if;
 if v.encrypted_payload_id is not null and not exists(select 1 from public.ap_sensitive_payloads where id=v.encrypted_payload_id and customer_id=v.customer_id and retention_state='ACTIVE' and content_sha256=v.source_sha256)
  or v.claim_review_encrypted_payload_id is not null and not exists(select 1 from public.ap_sensitive_payloads where id=v.claim_review_encrypted_payload_id and customer_id=v.customer_id and retention_state='ACTIVE' and content_sha256=v.claim_review_sha256)
  then raise exception 'service_repair_payload_unavailable'; end if;
 return v;
end $$;
create function public.ap_inspect_service_repair(p_case_id uuid,p_material_line_id uuid,p_reviewer_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.ap_require_material_reviewer(p_reviewer_id); perform public.ap_lock_service_repair_case(p_case_id,true);
 if (select count(*) from public.ap_service_repair_feedback where case_id=p_case_id)>3000 then raise exception 'service_repair_feedback_bound_exceeded'; end if;
 return jsonb_build_object('scope',public.ap_service_repair_scope(p_case_id),'originals',public.ap_service_repair_originals(p_case_id,p_material_line_id),
  'acceptedRows',(select jsonb_agg(jsonb_build_object('id',a.id,'case_id',a.case_id,'decision_id',a.decision_id,'customer_id',a.customer_id,'material_line_id',a.material_line_id,
   'source_snapshot_id',a.source_snapshot_id,'artifact_id',a.artifact_id,'file_version_id',a.file_version_id,'release_id',a.release_id,'member_kind',a.member_kind) order by a.id)
    from public.ap_service_error_affected_members a where a.case_id=p_case_id and a.member_kind='ACCEPTED_ERROR'),
  'contextSha256',public.ap_service_repair_context(p_case_id,p_material_line_id),'job',(select to_jsonb(j) from public.ap_service_repair_jobs j where case_id=p_case_id and material_line_id=p_material_line_id),
  'version',(select to_jsonb(v) from public.ap_service_repair_jobs j join public.ap_service_repair_versions v on v.id=j.active_version_id where j.case_id=p_case_id and j.material_line_id=p_material_line_id),
  'latestRepairs',coalesce((select jsonb_agg(jsonb_build_object('originalFileVersionId',original_file_version_id,'fileVersionId',id,'releaseId',release_id,
   'artifactId',artifact_id,'artifactType',artifact_type,'checksumSha256',checksum_sha256,'renderSourceSha256',render_source_sha256,'repairVersionId',repair_version_id,
   'sourcePayloadId',encrypted_payload_id,'sourceSha256',source_sha256,'approvedAt',approved_at,'deliveredAt',committed_at) order by original_file_version_id)
   from(select distinct on(f.original_file_version_id) f.*,r.id release_id,r.committed_at,v.encrypted_payload_id,v.source_sha256,v.approved_at
    from public.ap_service_repair_files f join public.ap_service_repair_releases r on r.repair_version_id=f.repair_version_id join public.ap_service_repair_versions v on v.id=f.repair_version_id
    where r.case_id=p_case_id and r.material_line_id=p_material_line_id order by f.original_file_version_id,r.committed_at desc,r.id desc) latest),'[]'),
  'feedback',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at,f.id) from public.ap_service_repair_feedback f where f.case_id=p_case_id and f.material_line_id=p_material_line_id),'[]'));
end $$;
-- Exact historical request lookup reconciles a lost response without repeating
-- a mutation or requiring the original evidence to remain current.
create function public.ap_read_service_repair_version(p_request_id uuid,p_reviewer_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 return (select to_jsonb(v) from public.ap_service_repair_versions v where request_id=p_request_id);
end $$;
create function public.ap_open_service_repair(p_case_id uuid,p_material_line_id uuid,p_request_id uuid,p_expected_version_id uuid,p_scope_sha256 text,p_context_sha256 text,p_reviewer_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare customer uuid; j public.ap_service_repair_jobs; prior public.ap_service_repair_versions; id_value uuid:=gen_random_uuid();
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 -- Exact request reconciliation is a read, including after later expiry or Send.
 select * into prior from public.ap_service_repair_versions where request_id=p_request_id;
 if found then
  if prior.case_id=p_case_id and prior.material_line_id=p_material_line_id and prior.supersedes_id is not distinct from p_expected_version_id and prior.accepted_scope_sha256=p_scope_sha256 and prior.context_sha256=p_context_sha256 and prior.created_by=p_reviewer_id then return prior.id; end if;
  raise exception 'service_repair_request_conflict';
 end if;
 customer:=public.ap_lock_service_repair_case(p_case_id);
 if p_request_id is null or p_scope_sha256 is distinct from public.ap_service_repair_scope(p_case_id)->>'acceptedScopeSha256'
  or p_context_sha256 is distinct from public.ap_service_repair_context(p_case_id,p_material_line_id) then raise exception 'service_repair_context_changed'; end if;
 select * into j from public.ap_service_repair_jobs where case_id=p_case_id and material_line_id=p_material_line_id for update;
 if j.id is null then
  if p_expected_version_id is not null then raise exception 'service_repair_version_stale'; end if;
  insert into public.ap_service_repair_jobs(id,case_id,customer_id,material_line_id) values(gen_random_uuid(),p_case_id,customer,p_material_line_id) returning * into j;
 elsif j.active_version_id is distinct from p_expected_version_id then raise exception 'service_repair_version_stale'; end if;
 select * into prior from public.ap_service_repair_versions where id=j.active_version_id;
 if prior.id is not null then update public.ap_service_repair_versions set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where id=prior.id; end if;
 insert into public.ap_service_repair_versions(id,request_id,job_id,case_id,customer_id,material_line_id,version,supersedes_id,accepted_scope_sha256,originals,context_sha256,created_by)
 values(id_value,p_request_id,j.id,p_case_id,customer,p_material_line_id,coalesce(prior.version,0)+1,prior.id,p_scope_sha256,public.ap_service_repair_originals(p_case_id,p_material_line_id),p_context_sha256,p_reviewer_id);
 update public.ap_service_repair_jobs set active_version_id=id_value,lease_token=null,lease_owner=null,lease_expires_at=null where id=j.id;
 return id_value;
end $$;
create function public.ap_claim_service_repair(p_version_id uuid,p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.ap_service_repair_versions; j public.ap_service_repair_jobs;
begin
 v:=public.ap_assert_service_repair_current(p_version_id);
 select * into j from public.ap_service_repair_jobs where id=v.job_id for update;
 if p_owner is null or j.lease_expires_at>clock_timestamp() then raise exception 'service_repair_lease_unavailable'; end if;
 update public.ap_service_repair_jobs set lease_owner=p_owner,lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_expires_at=clock_timestamp()+interval '5 minutes' where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create function public.ap_attach_service_repair_source(p_version_id uuid,p_lease_token uuid,p_payload_id uuid,p_source_sha256 text) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.ap_service_repair_versions;
begin
 if p_lease_token is null then raise exception 'service_repair_lease_required'; end if;
 v:=public.ap_assert_service_repair_current(p_version_id,p_lease_token);
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_payload_id and customer_id=v.customer_id and retention_state='ACTIVE' and content_sha256=p_source_sha256) then raise exception 'service_repair_payload_unavailable'; end if;
 if v.encrypted_payload_id is not null then
  if v.encrypted_payload_id=p_payload_id and v.source_sha256=p_source_sha256 then return v.id; end if;
  raise exception 'service_repair_source_immutable'; end if;
 update public.ap_service_repair_versions set encrypted_payload_id=p_payload_id,source_sha256=p_source_sha256 where id=v.id;
 return v.id;
end $$;

create function public.ap_assert_service_repair_claims(p_version uuid,p_member jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v public.ap_service_repair_versions; original jsonb; claim jsonb; ref jsonb; fact public.ap_candidate_facts; field_value jsonb;
begin
 select * into v from public.ap_service_repair_versions where id=p_version;
 if jsonb_typeof(p_member) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p_member) k) is distinct from array['claims','originalFileVersionId','renderSourceSha256']::text[]
  or coalesce(p_member->>'renderSourceSha256','') !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_member->'claims') is distinct from 'array' or jsonb_array_length(p_member->'claims') not between 1 and 250
  or (select count(distinct c->>'claimId') from jsonb_array_elements(p_member->'claims') c)<>jsonb_array_length(p_member->'claims')
  or (select count(distinct c->>'placement') from jsonb_array_elements(p_member->'claims') c)<>jsonb_array_length(p_member->'claims') then raise exception 'service_repair_claims_invalid'; end if;
 select value into original from jsonb_array_elements(v.originals) where value->>'fileVersionId'=p_member->>'originalFileVersionId';
 if original is null then raise exception 'service_repair_member_not_accepted'; end if;
 for claim in select value from jsonb_array_elements(p_member->'claims') loop
  if jsonb_typeof(claim) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(claim) k) is distinct from
   (case when claim->>'kind'='REFERENCE_PERMISSION' then array['claimId','decision','factRefs','jobEvidenceIds','kind','placement','qualification','referenceBinding','referencePermissionIds','wordingSha256']::text[] else array['claimId','decision','factRefs','jobEvidenceIds','kind','placement','qualification','referencePermissionIds','wordingSha256']::text[] end)
   or coalesce(claim->>'claimId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or coalesce(claim->>'wordingSha256','') !~ '^[a-f0-9]{64}$' or claim->>'decision' is distinct from 'APPROVED'
   or coalesce(claim->>'placement','') !~ '^[A-Za-z][A-Za-z0-9_.]{0,179}$'
   or split_part(claim->>'placement','.',1) is distinct from (case original->>'artifactType' when 'RESUME' then 'resume' when 'COVER_LETTER' then 'coverLetter' else 'referenceSheet' end)
   or coalesce(claim->>'kind','') not in('CANDIDATE_FACT','JOB_EVIDENCE','MIXED','NARRATIVE','REFERENCE_PERMISSION')
   or coalesce(claim->>'qualification','') not in('EXACT','QUALIFIED_TRANSFER','NONFACTUAL')
   or jsonb_typeof(claim->'factRefs') is distinct from 'array' or jsonb_array_length(claim->'factRefs')>40
   or jsonb_typeof(claim->'jobEvidenceIds') is distinct from 'array' or jsonb_array_length(claim->'jobEvidenceIds')>40
   or jsonb_typeof(claim->'referencePermissionIds') is distinct from 'array' or jsonb_array_length(claim->'referencePermissionIds')>3
   then raise exception 'service_repair_claims_invalid'; end if;
  if claim->>'kind' in('CANDIDATE_FACT','MIXED') and jsonb_array_length(claim->'factRefs')=0
   or claim->>'kind' in('JOB_EVIDENCE','MIXED') and jsonb_array_length(claim->'jobEvidenceIds')=0
   or claim->>'kind'='NARRATIVE' and (claim->>'qualification'<>'NONFACTUAL' or claim->'factRefs'<>'[]'::jsonb or claim->'jobEvidenceIds'<>'[]'::jsonb or claim->'referencePermissionIds'<>'[]'::jsonb)
   or claim->>'kind'='REFERENCE_PERMISSION' and (original->>'artifactType'<>'REFERENCE_SHEET' or claim->>'qualification'<>'EXACT')
   or claim->>'kind'<>'REFERENCE_PERMISSION' and claim->'referencePermissionIds'<>'[]'::jsonb then raise exception 'service_repair_claim_source_invalid'; end if;
  perform public.ap_assert_material_draft_reference_claim((original->>'draftJobId')::uuid,claim);
  if exists(select 1 from jsonb_array_elements_text(claim->'jobEvidenceIds') e where not exists(select 1 from public.ap_requirement_nodes n join public.ap_material_line_revisions r on r.job_snapshot_id=n.job_snapshot_id
    where r.id=(original->>'revisionId')::uuid and n.id::text=e)) then raise exception 'service_repair_claim_source_invalid'; end if;
  for ref in select value from jsonb_array_elements(claim->'factRefs') loop
   if jsonb_typeof(ref) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(ref) k) is distinct from array['attributionFactId','factId','field','valueSha256']::text[]
    or coalesce(ref->>'factId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(ref->>'attributionFactId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(ref->>'field','') !~ '^[A-Za-z][A-Za-z0-9_]{0,59}(\.[0-9]{1,3})?$' or coalesce(ref->>'valueSha256','') !~ '^[a-f0-9]{64}$'
    then raise exception 'service_repair_claim_source_invalid'; end if;
   select f.* into fact from public.ap_candidate_facts f where f.id=(ref->>'factId')::uuid and f.customer_id=v.customer_id
    and f.verification in('CUSTOMER_CONFIRMED','HUMAN_VERIFIED') and f.created_at<=(original->>'approvedAt')::timestamptz
    and (f.snapshot_id=(original->>'sourceSnapshotId')::uuid or f.semantic_key='document_contact.confirmed' and exists(
     select 1 from public.ap_material_lines l join public.ap_material_purchases p on p.id=l.purchase_id join public.ap_material_checkout_intents i on i.id=p.checkout_intent_id
     where l.id=v.material_line_id and f.id=i.contact_payload_id and f.snapshot_id=i.source_snapshot_id and i.customer_id=v.customer_id)) for share of f;
   field_value:=fact.typed_value#>string_to_array(ref->>'field','.');
   if fact.id is null or field_value is null or jsonb_typeof(field_value) not in('string','number','boolean')
    or encode(extensions.digest(field_value::text,'sha256'),'hex') is distinct from ref->>'valueSha256'
    or (ref->>'attributionFactId')::uuid not in(fact.id,coalesce((fact.typed_value->>'employmentFactId')::uuid,fact.id))
    or fact.capability_status='NOT_DONE' or fact.capability_status is not null and fact.capability_status<>'CAN_DO_NOW' and claim->>'qualification'<>'QUALIFIED_TRANSFER'
    or exists(select 1 from jsonb_each(fact.typed_value) f where f.key in('held','hasExperience','canDo','supported','completed','earned','obtained','graduated','certified','licensed') and f.value='false'::jsonb)
    or exists(select 1 from jsonb_each_text(fact.typed_value) f where f.key in('status','capabilityStatus','completionStatus','credentialState') and
     (upper(replace(replace(f.value,' ','_'),'-','_')) in('NOT_DONE','NOT_HELD','FAIL','INCOMPLETE') or upper(replace(replace(f.value,' ','_'),'-','_')) in('UNSURE','UNKNOWN','BASIC_EXPOSURE','IN_PROGRESS','PENDING','PLANNED','DONE_BEFORE_NEEDS_REFRESHER') and claim->>'qualification'<>'QUALIFIED_TRANSFER'))
    then raise exception 'service_repair_claim_source_invalid'; end if;
   if fact.typed_value ? 'protectedPayloadId' and (ref->>'field'<>'contentSha256' or not exists(
    select 1 from public.ap_material_lines l join public.ap_material_purchases p on p.id=l.purchase_id join public.ap_material_checkout_intents i on i.id=p.checkout_intent_id
    join public.ap_sensitive_payloads s on s.id=i.contact_payload_id where l.id=v.material_line_id and fact.id=s.id and fact.snapshot_id=i.source_snapshot_id
     and fact.semantic_key='document_contact.confirmed' and fact.typed_value->>'protectedPayloadId'=s.id::text and fact.typed_value->>'contentSha256'=s.content_sha256 and s.retention_state='ACTIVE' and s.customer_id=v.customer_id))
    then raise exception 'service_repair_claim_source_invalid'; end if;
  end loop;
 end loop;
end $$;
-- source_sha256 identifies the whole encrypted repair envelope. Each member's
-- renderSourceSha256 identifies its actual corrected source bytes; they are not
-- interchangeable when accepted files came from different original versions.
create function public.ap_review_service_repair_wording(p_version_id uuid,p_source_sha256 text,p_payload_id uuid,p_review_sha256 text,p_members jsonb,p_reviewer_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare v public.ap_service_repair_versions; member jsonb;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id); v:=public.ap_assert_service_repair_current(p_version_id);
 if v.source_sha256 is null or v.source_sha256 is distinct from p_source_sha256 or v.member_set_sha256 is not null then raise exception 'service_repair_source_changed'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_payload_id and customer_id=v.customer_id and retention_state='ACTIVE' and content_sha256=p_review_sha256) then raise exception 'service_repair_payload_unavailable'; end if;
 if jsonb_typeof(p_members) is distinct from 'array' or jsonb_array_length(p_members)<>jsonb_array_length(v.originals) or octet_length(p_members::text)>600000
  or (select count(distinct value->>'originalFileVersionId') from jsonb_array_elements(p_members))<>jsonb_array_length(p_members) then raise exception 'service_repair_members_incomplete'; end if;
 for member in select value from jsonb_array_elements(p_members) loop perform public.ap_assert_service_repair_claims(v.id,member); end loop;
 if v.claim_review_sha256 is not null then
  if v.claim_review_encrypted_payload_id=p_payload_id and v.claim_review_sha256=p_review_sha256 and v.claim_review_metadata=p_members and v.claims_reviewed_by=p_reviewer_id then return p_review_sha256; end if;
  raise exception 'service_repair_review_immutable'; end if;
 update public.ap_service_repair_versions set claim_review_encrypted_payload_id=p_payload_id,claim_review_sha256=p_review_sha256,claim_review_metadata=p_members,claims_reviewed_by=p_reviewer_id,claims_reviewed_at=clock_timestamp() where id=v.id;
 return p_review_sha256;
end $$;
create function public.ap_service_repair_member_set(p_version uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('fileVersionId',id,'originalFileVersionId',original_file_version_id,'artifactId',artifact_id,'checksumSha256',checksum_sha256,'renderSourceSha256',render_source_sha256,'previewSha256',preview_sha256,'editableSha256',editable_sha256) order by original_file_version_id),'[]') from public.ap_service_repair_files where repair_version_id=p_version;
$$;
create function public.ap_register_service_repair_files(p_version_id uuid,p_lease_token uuid,p_source_sha256 text,p_registrations jsonb) returns text language plpgsql security definer set search_path='' as $$
declare v public.ap_service_repair_versions; entry jsonb; original jsonb; registration jsonb; reviewed jsonb; claim jsonb; config public.ap_commerce_configuration;
 rule public.ap_employer_submission_rules; prefix text; digest text; ext text; expected_pages boolean;
begin
 if p_lease_token is null then raise exception 'service_repair_lease_required'; end if;
 v:=public.ap_assert_service_repair_current(p_version_id,p_lease_token);
 if v.source_sha256 is distinct from p_source_sha256 or v.claim_review_sha256 is null then raise exception 'service_repair_wording_review_required'; end if;
 select * into config from public.ap_commerce_configuration where singleton;
 if not coalesce(config.materials_generation_approved,false) or nullif(btrim(config.materials_generation_approval_reference),'') is null then raise exception 'approved_material_generation_configuration_required'; end if;
 if jsonb_typeof(p_registrations) is distinct from 'array' or jsonb_array_length(p_registrations)<>jsonb_array_length(v.originals) or octet_length(p_registrations::text)>2000000
  or (select count(distinct value->>'originalFileVersionId') from jsonb_array_elements(p_registrations))<>jsonb_array_length(p_registrations)
  or (select count(distinct value#>>'{registration,p_file_version_id}') from jsonb_array_elements(p_registrations))<>jsonb_array_length(p_registrations) then raise exception 'service_repair_members_incomplete'; end if;
 if v.member_set_sha256 is not null then
  if exists(select 1 from jsonb_array_elements(p_registrations) e where not exists(select 1 from public.ap_service_repair_files f where f.repair_version_id=v.id and f.original_file_version_id=(e->>'originalFileVersionId')::uuid and f.registration=e->'registration')) then raise exception 'service_repair_files_immutable'; end if;
  return v.member_set_sha256;
 end if;
 prefix:=v.customer_id::text||'/materials/'||v.material_line_id::text||'/repairs/'||v.id::text||'/';
 for entry in select value from jsonb_array_elements(p_registrations) loop
  if (select array_agg(k order by k) from jsonb_object_keys(entry) k) is distinct from array['originalFileVersionId','registration']::text[] then raise exception 'service_repair_file_invalid'; end if;
  select value into original from jsonb_array_elements(v.originals) where value->>'fileVersionId'=entry->>'originalFileVersionId';
  if original is null then raise exception 'service_repair_member_not_accepted'; end if;
  registration:=entry->'registration';
  select value->'claims' into reviewed from jsonb_array_elements(v.claim_review_metadata) where value->>'originalFileVersionId'=entry->>'originalFileVersionId';
  select rule_row.* into rule from public.ap_material_line_revisions r join public.ap_employer_submission_rules rule_row on rule_row.id=r.employer_rule_snapshot_id where r.id=(original->>'revisionId')::uuid;
  if registration->>'p_artifact_id' is distinct from original->>'artifactId' or registration->>'p_material_line_id' is distinct from v.material_line_id::text
   or registration->>'p_artifact_type' is distinct from original->>'artifactType' or registration->>'p_source_line_revision_id' is distinct from original->>'revisionId'
   or registration->>'p_source_snapshot_id' is distinct from original->>'sourceSnapshotId' or registration->>'p_binding_sha256' is distinct from original->>'bindingSha256'
   or registration->>'p_job_snapshot_id' is distinct from rule.job_snapshot_id::text or registration->>'p_reference_regeneration_id' is not null or registration->>'p_reviewer_id' is not null
   or registration#>>'{p_claim_provenance,draftPair,versionId}' is distinct from v.id::text
   or registration#>>'{p_claim_provenance,draftPair,packetSha256}' is distinct from original->>'packetSha256'
   or registration#>>'{p_claim_provenance,draftPair,sourceSha256}' is distinct from
    (select value->>'renderSourceSha256' from jsonb_array_elements(v.claim_review_metadata) where value->>'originalFileVersionId'=entry->>'originalFileVersionId')
   or registration#>'{p_claim_provenance,serviceRepair}' is distinct from jsonb_build_object(
    'schemaVersion','applypack-service-repair-render-binding-v1','repairVersionId',v.id,'repairSourceSha256',v.source_sha256,
    'acceptedScopeSha256',v.accepted_scope_sha256,'originalFileVersionId',original->>'fileVersionId','originalSourceSha256',original->>'sourceSha256')
   or registration#>>'{p_claim_provenance,draftPair,claimReviewSha256}' is distinct from v.claim_review_sha256
   or registration#>>'{p_claim_provenance,schemaVersion}' is distinct from 'applypack-claim-provenance-v1'
   or exists(select 1 from public.ap_generated_file_versions where id=(registration->>'p_file_version_id')::uuid)
   then raise exception 'service_repair_file_binding_invalid'; end if;
  perform public.ap_assert_material_draft_reference_provenance((original->>'draftJobId')::uuid,(original->>'artifactType')::public.ap_artifact_type,registration->'p_claim_provenance');
  if jsonb_typeof(registration#>'{p_claim_provenance,sourceBinding}') is distinct from 'object'
   or (select array_agg(k order by k) from jsonb_object_keys(registration#>'{p_claim_provenance,sourceBinding}') k) is distinct from array['candidateFactIds','jobEvidenceIds','referencePermissionIds']::text[]
   or jsonb_typeof(registration#>'{p_claim_provenance,sourceBinding,candidateFactIds}') is distinct from 'array'
   or jsonb_typeof(registration#>'{p_claim_provenance,sourceBinding,jobEvidenceIds}') is distinct from 'array'
   or jsonb_typeof(registration#>'{p_claim_provenance,sourceBinding,referencePermissionIds}') is distinct from 'array'
   or jsonb_array_length(registration#>'{p_claim_provenance,sourceBinding,candidateFactIds}')>2000
   or jsonb_array_length(registration#>'{p_claim_provenance,sourceBinding,jobEvidenceIds}')>2000
   or jsonb_array_length(registration#>'{p_claim_provenance,sourceBinding,referencePermissionIds}')>3
   or exists(select 1 from jsonb_array_elements_text(registration#>'{p_claim_provenance,sourceBinding,candidateFactIds}') source_id(value) where not exists(
    select 1 from public.ap_candidate_facts f where f.id::text=source_id.value and f.customer_id=v.customer_id and f.created_at<=(original->>'approvedAt')::timestamptz
     and (f.snapshot_id=(original->>'sourceSnapshotId')::uuid or f.semantic_key='document_contact.confirmed' and exists(
      select 1 from public.ap_material_lines l join public.ap_material_purchases p on p.id=l.purchase_id join public.ap_material_checkout_intents i on i.id=p.checkout_intent_id
      where l.id=v.material_line_id and f.id=i.contact_payload_id and f.snapshot_id=i.source_snapshot_id and i.customer_id=v.customer_id))))
   or exists(select 1 from jsonb_array_elements_text(registration#>'{p_claim_provenance,sourceBinding,jobEvidenceIds}') source_id(value) where not exists(
    select 1 from public.ap_requirement_nodes n where n.id::text=source_id.value and n.job_snapshot_id=rule.job_snapshot_id))
   or (original->>'artifactType'<>'REFERENCE_SHEET' and registration#>'{p_claim_provenance,sourceBinding,referencePermissionIds}'<>'[]'::jsonb)
   then raise exception 'service_repair_file_binding_invalid'; end if;
  if jsonb_typeof(registration#>'{p_claim_provenance,claims}') is distinct from 'array' or jsonb_array_length(registration#>'{p_claim_provenance,claims}')<>jsonb_array_length(reviewed)
   or (select count(distinct c->>'placement') from jsonb_array_elements(registration#>'{p_claim_provenance,claims}') c)<>jsonb_array_length(reviewed)
   then raise exception 'service_repair_claim_coverage_invalid'; end if;
  for claim in select value from jsonb_array_elements(registration#>'{p_claim_provenance,claims}') loop
   if not (registration#>'{p_claim_provenance,sourceBinding,candidateFactIds}') @> (claim->'candidateFactIds')
    or not (registration#>'{p_claim_provenance,sourceBinding,jobEvidenceIds}') @> (claim->'jobEvidenceIds')
    or not (registration#>'{p_claim_provenance,sourceBinding,referencePermissionIds}') @> (claim->'referencePermissionIds')
    or not exists(select 1 from jsonb_array_elements(reviewed) r where r->>'placement'=claim->>'placement' and r->>'wordingSha256'=claim->>'visibleTextSha256' and r->>'kind'=claim->>'kind'
    and r->'referenceBinding' is not distinct from claim->'referenceBinding'
    and (select coalesce(jsonb_agg(id order by id),'[]') from (select distinct ref->>'factId' id from jsonb_array_elements(r->'factRefs') ref) ids)=(select coalesce(jsonb_agg(id order by id),'[]') from (select distinct value id from jsonb_array_elements_text(claim->'candidateFactIds')) ids)
    and (r->'jobEvidenceIds') @> (claim->'jobEvidenceIds') and (claim->'jobEvidenceIds') @> (r->'jobEvidenceIds')
    and (r->'referencePermissionIds') @> (claim->'referencePermissionIds') and (claim->'referencePermissionIds') @> (r->'referencePermissionIds'))
    then raise exception 'service_repair_wording_not_reviewed'; end if;
  end loop;
  if registration->>'p_storage_bucket' is distinct from 'customer-deliveries' or registration->>'p_render_preview_bucket' is distinct from 'operator-render-previews'
   or registration#>>'{p_claim_provenance,editableSource,storageBucket}' is distinct from 'operator-drafts'
   or coalesce(registration->>'p_storage_path','') not like prefix||'%' or coalesce(registration->>'p_render_preview_path','') not like prefix||'%'
   or coalesce(registration#>>'{p_claim_provenance,editableSource,storagePath}','') not like prefix||'%'
   or exists(select 1 from unnest(array[registration->>'p_storage_path',registration->>'p_render_preview_path',registration#>>'{p_claim_provenance,editableSource,storagePath}']) path where length(path)>1024 or path~'[\\%?#[:cntrl:]]' or exists(select 1 from unnest(string_to_array(path,'/')) segment where segment in('','.','..')))
   or registration->>'p_renderer_identity' is distinct from config.document_renderer_identity or registration->>'p_malware_scanner_identity' is distinct from 'NOT_SCANNED:'||config.document_safety_policy
   or config.document_font_family is distinct from 'Liberation Sans' or config.document_font_sha256 is distinct from '76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8'
   or registration->>'p_arial_font_sha256' is distinct from config.document_font_sha256 or registration->'p_arial_resolved' is distinct from 'true'::jsonb
   or registration#>'{p_claim_provenance,documentFontAttestation}' is distinct from jsonb_build_object('family','Liberation Sans','version','2.1.5','manifestSha256','d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb','styleSha256',jsonb_build_object('regular','76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8','bold','788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173','italic','e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0','boldItalic','698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee'))
   then raise exception 'service_repair_file_invalid'; end if;
  ext:=case registration->>'p_mime_type' when 'application/pdf' then 'PDF' when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'DOCX' end;
  if ext is null or not ext=any(rule.allowed_formats) or not ext=any(config.material_output_formats)
   or registration->>'p_mime_type' is distinct from (select mime_type from public.ap_generated_file_versions where id=(original->>'fileVersionId')::uuid)
   or registration#>'{p_claim_provenance,deliveryFormatDecision}' is distinct from (select claim_provenance->'deliveryFormatDecision' from public.ap_generated_artifacts where id=(original->>'artifactId')::uuid)
   or coalesce(registration->>'p_safe_filename','')!~'^[^/\\]{1,180}\.(docx|pdf)$' or lower(substring(registration->>'p_safe_filename' from '\.([A-Za-z0-9]+)$'))<>lower(ext)
   or registration->>'p_safe_filename'~'[\[\][:cntrl:]]' or registration->>'p_safe_filename'~*'(^|_)(final|updated|new|v2)(_|\.)'
   then raise exception 'generated_filename_or_format_invalid'; end if;
  expected_pages:=case when original->>'artifactType'='RESUME' then (registration->>'p_rendered_page_count')::integer=1 or (registration->>'p_rendered_page_count')::integer=2 and registration#>'{p_structural_checks,twoPageExceptionApproved}'='true'::jsonb else (registration->>'p_rendered_page_count')::integer=1 end;
  if expected_pages is not true or jsonb_typeof(registration->'p_rendered_page_sha256') is distinct from 'array' or jsonb_array_length(registration->'p_rendered_page_sha256')<>(registration->>'p_rendered_page_count')::integer
   or exists(select 1 from jsonb_array_elements_text(registration->'p_rendered_page_sha256') h where h!~'^[a-f0-9]{64}$')
   or jsonb_typeof(registration->'p_structural_checks') is distinct from 'object' or jsonb_typeof(registration->'p_provenance_checks') is distinct from 'object'
   or not (registration->'p_structural_checks') ?& array['noMacros','noHiddenText','noComments','noTrackedChanges','noCustomXml','noExternalRelationships','noLayoutTables','nativeBullets','linearText','noPlaceholders','noMetadataLeak','noPromptArtifacts','filenameValid','mimeValid','checksumValid','pageGeometryValid','textExtracted']
   or exists(select 1 from jsonb_each(registration->'p_structural_checks') e where e.key<>'twoPageExceptionApproved' and e.value is distinct from 'true'::jsonb)
   or not (registration->'p_provenance_checks') ?& array['factsBound','jobEvidenceBound','narrativeTyped','historicalTitlesPreserved','injectionReviewed','noUnsupportedClaims','sameCurrentBinding']
   or exists(select 1 from jsonb_each(registration->'p_provenance_checks') e where e.value is distinct from 'true'::jsonb) then raise exception 'service_repair_quality_failed'; end if;
  perform public.ap_assert_source_aware_document_qa((original->>'artifactType')::public.ap_artifact_type,registration->'p_claim_provenance',registration->>'p_generator_version',registration->>'p_checksum_sha256',registration->>'p_mime_type',registration->>'p_package_qa_sha256',registration->>'p_extracted_text_sha256',registration->>'p_render_preview_sha256',registration->'p_structural_checks');
  insert into public.ap_service_repair_files(id,repair_version_id,customer_id,material_line_id,artifact_id,original_file_version_id,source_snapshot_id,artifact_type,storage_bucket,storage_path,safe_filename,mime_type,size_bytes,checksum_sha256,render_source_sha256,preview_bucket,preview_path,preview_sha256,editable_bucket,editable_path,editable_sha256,registration)
  values((registration->>'p_file_version_id')::uuid,v.id,v.customer_id,v.material_line_id,(original->>'artifactId')::uuid,(original->>'fileVersionId')::uuid,(original->>'sourceSnapshotId')::uuid,(original->>'artifactType')::public.ap_artifact_type,
   registration->>'p_storage_bucket',registration->>'p_storage_path',registration->>'p_safe_filename',registration->>'p_mime_type',(registration->>'p_size_bytes')::integer,registration->>'p_checksum_sha256',registration#>>'{p_claim_provenance,draftPair,sourceSha256}',registration->>'p_render_preview_bucket',registration->>'p_render_preview_path',registration->>'p_render_preview_sha256',registration#>>'{p_claim_provenance,editableSource,storageBucket}',registration#>>'{p_claim_provenance,editableSource,storagePath}',registration#>>'{p_claim_provenance,editableSource,checksumSha256}',registration);
 end loop;
 digest:=encode(extensions.digest(public.ap_service_repair_member_set(v.id)::text,'sha256'),'hex');
 update public.ap_service_repair_versions set member_set_sha256=digest where id=v.id; return digest;
end $$;

create function public.ap_approve_service_repair(p_version_id uuid,p_source_sha256 text,p_member_set_sha256 text,p_checklist jsonb,p_reviewer_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare v public.ap_service_repair_versions; result text; member jsonb;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id); v:=public.ap_assert_service_repair_current(p_version_id);
 if v.source_sha256 is distinct from p_source_sha256 or v.member_set_sha256 is null or v.member_set_sha256 is distinct from p_member_set_sha256
  or jsonb_array_length(public.ap_service_repair_member_set(v.id))<>jsonb_array_length(v.originals) then raise exception 'service_repair_members_incomplete'; end if;
 if jsonb_typeof(p_checklist) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p_checklist) k) is distinct from
  array['acceptedErrorScopeReviewed','confirmedInputsReviewed','originalInstructionsReviewed','secureFilesConfirmed','unchangedFilesPreserved','visualReviewed','wordingReviewed']::text[]
  or exists(select 1 from jsonb_each(p_checklist) e where e.value is distinct from 'true'::jsonb) then raise exception 'service_repair_actual_review_required'; end if;
 for member in select value from jsonb_array_elements(v.claim_review_metadata) loop perform public.ap_assert_service_repair_claims(v.id,member); end loop;
 result:=encode(extensions.digest(jsonb_build_object('version',v.id,'scope',v.accepted_scope_sha256,'context',v.context_sha256,'source',v.source_sha256,'review',v.claim_review_sha256,'files',v.member_set_sha256,'checklist',p_checklist,'reviewer',p_reviewer_id)::text,'sha256'),'hex');
 if v.approval_sha256 is not null then if v.approval_sha256=result then return result; end if; raise exception 'service_repair_approval_immutable'; end if;
 update public.ap_service_repair_versions set approval_sha256=result,approved_by=p_reviewer_id,approved_at=clock_timestamp(),review_checklist=p_checklist where id=v.id;
 return result;
end $$;
create function public.ap_send_service_repair(p_version_id uuid,p_source_sha256 text,p_member_set_sha256 text,p_approval_sha256 text,p_release_id uuid,p_outbox_id uuid,p_reviewer_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.ap_service_repair_versions; release public.ap_service_repair_releases; order_value uuid; now_at timestamptz:=clock_timestamp(); member jsonb;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 select * into v from public.ap_service_repair_versions where id=p_version_id;
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||v.customer_id::text,0));
 select * into v from public.ap_service_repair_versions where id=p_version_id;
 if p_release_id is null or p_outbox_id is null or v.source_sha256 is distinct from p_source_sha256 or v.member_set_sha256 is distinct from p_member_set_sha256
  or v.approval_sha256 is null or v.approval_sha256 is distinct from p_approval_sha256 or v.approved_by is distinct from p_reviewer_id then raise exception 'service_repair_expected_approval_required'; end if;
 if v.release_id is not null then
  select * into release from public.ap_service_repair_releases where id=v.release_id;
  if release.id=p_release_id and release.outbox_id=p_outbox_id then return release.id; end if;
  raise exception 'service_repair_send_identity_conflict'; end if;
 v:=public.ap_assert_service_repair_current(v.id);
 for member in select value from jsonb_array_elements(v.claim_review_metadata) loop perform public.ap_assert_service_repair_claims(v.id,member); end loop;
 if encode(extensions.digest(public.ap_service_repair_member_set(v.id)::text,'sha256'),'hex') is distinct from v.member_set_sha256 then raise exception 'service_repair_files_changed'; end if;
 select delivered_order_id into order_value from public.ap_material_lines where id=v.material_line_id;
 insert into public.ap_outbox_messages(id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at)
 values(p_outbox_id,v.customer_id,order_value,'MATERIALS_DELIVERED',p_release_id::text,'service-repair:'||v.id::text,p_outbox_id::text,'QUEUED',now_at);
 insert into public.ap_service_repair_releases(id,repair_version_id,case_id,customer_id,material_line_id,order_id,outbox_id,accepted_scope_sha256,member_set_sha256,approval_sha256,approved_by,committed_at,access_expires_at)
 values(p_release_id,v.id,v.case_id,v.customer_id,v.material_line_id,order_value,p_outbox_id,v.accepted_scope_sha256,v.member_set_sha256,v.approval_sha256,p_reviewer_id,now_at,now_at+interval '720 hours');
 update public.ap_service_repair_versions set release_id=p_release_id where id=v.id;
 update public.ap_service_repair_jobs set lease_token=null,lease_owner=null,lease_expires_at=null where id=v.job_id;
 insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at) values('OUTBOX_SEND',p_outbox_id,'outbox-send:'||p_outbox_id::text,now_at);
 insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
 values(v.customer_id,p_reviewer_id,'SERVICE_REPAIR_RELEASED','SERVICE_REPAIR_RELEASE',p_release_id,jsonb_build_object('caseId',v.case_id,'versionId',v.id,'acceptedScopeSha256',v.accepted_scope_sha256,'memberSetSha256',v.member_set_sha256,'originalPaidDeadlineUnchanged',true),'service-repair-v1');
 return p_release_id;
end $$;

-- A successful Send is not an automatic support-case resolution. The owner
-- explicitly confirms the entire accepted union; a failed repair can reopen the
-- same case without granting a new customer request or creating paid capacity.
create function public.ap_set_service_repair_case_state(p_case_id uuid,p_request_id uuid,p_scope_sha256 text,p_resolved boolean,p_payload_id uuid,p_content_sha256 text,p_reviewer_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare customer uuid; prior public.ap_service_repair_case_events; scope jsonb; report public.ap_service_error_reports;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 select * into prior from public.ap_service_repair_case_events where id=p_request_id;
 if found then
  if prior.case_id=p_case_id and prior.kind=(case when p_resolved then 'RESOLVED' else 'REOPENED' end) and prior.accepted_scope_sha256=p_scope_sha256 and prior.sensitive_payload_id=p_payload_id and prior.content_sha256=p_content_sha256 and prior.reviewer_id=p_reviewer_id then return prior.id; end if;
  raise exception 'service_repair_request_conflict'; end if;
 customer:=public.ap_lock_service_repair_case(p_case_id,true); scope:=public.ap_service_repair_scope(p_case_id);
 select * into report from public.ap_service_error_reports where id=p_case_id;
 if p_request_id is null or p_resolved is null or scope->>'acceptedScopeSha256' is distinct from p_scope_sha256 then raise exception 'service_repair_context_changed'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_payload_id and customer_id=customer and retention_state='ACTIVE' and content_sha256=p_content_sha256) then raise exception 'service_repair_payload_unavailable'; end if;
 if p_resolved and (exists(select 1 from jsonb_array_elements(scope->'members') m where not exists(
   select 1 from public.ap_service_repair_files f join public.ap_service_repair_versions v on v.id=f.repair_version_id join public.ap_service_repair_jobs j on j.active_version_id=v.id
   join public.ap_service_repair_releases r on r.id=v.release_id where r.case_id=p_case_id and f.original_file_version_id=(m->>'fileVersionId')::uuid and v.invalidated_at is null and r.accepted_scope_sha256=p_scope_sha256))
  or exists(select 1 from public.ap_service_repair_jobs j join public.ap_service_repair_versions v on v.id=j.active_version_id where j.case_id=p_case_id and v.release_id is null)) then raise exception 'service_repair_accepted_scope_unfinished'; end if;
 insert into public.ap_service_repair_case_events(id,case_id,customer_id,material_line_id,kind,accepted_scope_sha256,sensitive_payload_id,content_sha256,reviewer_id)
 values(p_request_id,p_case_id,customer,report.material_line_id,case when p_resolved then 'RESOLVED' else 'REOPENED' end,p_scope_sha256,p_payload_id,p_content_sha256,p_reviewer_id);
 update public.ap_material_support_cases set state=case when p_resolved then 'RESOLVED' else 'OPEN' end,resolved_at=case when p_resolved then clock_timestamp() else null end where id=p_case_id;
 return p_request_id;
end $$;

-- Follow-up concerns identify the actual repaired bytes, never an invented
-- original file ID. This reopens the same investigation; it accepts no new scope
-- or customer facts and does not authorize regeneration or delivery.
create function public.ap_record_service_repair_feedback(p_customer_id uuid,p_case_id uuid,p_request_id uuid,p_release_id uuid,p_payload_id uuid,p_content_sha256 text,p_members jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.ap_service_repair_feedback; release public.ap_service_repair_releases; member jsonb; file public.ap_service_repair_files;
begin
 select * into prior from public.ap_service_repair_feedback where id=p_request_id;
 if found then
  if prior.customer_id=p_customer_id and prior.case_id=p_case_id and prior.repair_release_id=p_release_id and prior.sensitive_payload_id=p_payload_id
   and prior.content_sha256=p_content_sha256 and prior.members=p_members then return prior.id; end if;
  raise exception 'service_repair_request_conflict'; end if;
 if not exists(select 1 from public.ap_service_error_reports where id=p_case_id and customer_id=p_customer_id) then raise exception 'service_repair_case_unavailable'; end if;
 perform public.ap_lock_service_repair_case(p_case_id,true);
 select * into release from public.ap_service_repair_releases where id=p_release_id and case_id=p_case_id and customer_id=p_customer_id;
 if release.id is null or release.committed_at>clock_timestamp() or release.access_expires_at<=clock_timestamp() then raise exception 'service_repair_feedback_unavailable'; end if;
 if p_request_id is null or jsonb_typeof(p_members) is distinct from 'array' or jsonb_array_length(p_members) not between 1 and 3
  or (select count(distinct value->>'fileVersionId') from jsonb_array_elements(p_members))<>jsonb_array_length(p_members) then raise exception 'service_repair_feedback_invalid'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_payload_id and customer_id=p_customer_id and retention_state='ACTIVE' and content_sha256=p_content_sha256) then raise exception 'service_repair_payload_unavailable'; end if;
 if (select count(*) from public.ap_service_repair_feedback where case_id=p_case_id)>=3000 then raise exception 'service_repair_feedback_bound_exceeded'; end if;
 for member in select value from jsonb_array_elements(p_members) loop
  if jsonb_typeof(member) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(member) k) is distinct from array['artifactId','fileVersionId']::text[] then raise exception 'service_repair_feedback_invalid'; end if;
  select * into file from public.ap_service_repair_files where repair_version_id=release.repair_version_id and id::text=member->>'fileVersionId' and artifact_id::text=member->>'artifactId' and customer_id=p_customer_id;
  if file.id is null or file.storage_path is null or exists(select 1 from public.ap_retention_row_receipts where table_name='ap_service_repair_files' and row_id=file.id::text)
   or release.id is distinct from (select r.id from public.ap_service_repair_releases r join public.ap_service_repair_files f on f.repair_version_id=r.repair_version_id
    where f.original_file_version_id=file.original_file_version_id order by r.committed_at desc,r.id desc limit 1) then raise exception 'service_repair_feedback_invalid'; end if;
 end loop;
 insert into public.ap_service_repair_feedback(id,case_id,customer_id,material_line_id,repair_release_id,sensitive_payload_id,content_sha256,members)
 values(p_request_id,p_case_id,p_customer_id,release.material_line_id,p_release_id,p_payload_id,p_content_sha256,p_members);
 update public.ap_material_support_cases set state='OPEN',resolved_at=null where id=p_case_id;
 return p_request_id;
end $$;

-- Expose only released replacements. The portal overlays these exact original
-- file IDs; it does not replace an unrelated resume/letter/reference member.
create function public.ap_customer_service_repair_files(p_customer_id uuid,p_material_line_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.ap_material_lines l join public.ap_material_purchases p on p.id=l.purchase_id where l.id=p_material_line_id and p.customer_id=p_customer_id) then raise exception 'service_repair_line_unavailable'; end if;
 perform public.ap_assert_service_retention_access((select delivered_order_id from public.ap_material_lines where id=p_material_line_id),p_material_line_id,false);
 if public.ap_material_retention_deadline(p_material_line_id)<=clock_timestamp() then raise exception 'service_retention_access_expired'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('artifactId',artifact_id,'originalFileVersionId',original_file_version_id,'fileVersionId',id,'artifactType',artifact_type,'safeFilename',safe_filename,'checksumSha256',checksum_sha256,'releaseId',release_id,'deliveredAt',committed_at,'accessExpiresAt',access_expires_at) order by artifact_type) from (
  select distinct on(f.original_file_version_id) f.*,r.id release_id,r.committed_at,r.access_expires_at from public.ap_service_repair_files f join public.ap_service_repair_releases r on r.repair_version_id=f.repair_version_id
  where f.customer_id=p_customer_id and f.material_line_id=p_material_line_id and f.storage_path is not null order by f.original_file_version_id,r.committed_at desc,r.id desc
 ) current_files),'[]');
end $$;

alter function public.ap_material_retention_deadline(uuid) rename to ap_material_retention_deadline_before_099;
create function public.ap_material_retention_deadline(p_line_id uuid) returns timestamptz language sql stable security definer set search_path='' as $$
 select greatest(public.ap_material_retention_deadline_before_099(p_line_id),(select max(access_expires_at) from public.ap_service_repair_releases where material_line_id=p_line_id));
$$;
alter function public.ap_service_retention_deadlines(uuid) rename to ap_service_retention_deadlines_before_099;
create function public.ap_service_retention_deadlines(p_order_id uuid) returns table(action_expires_at timestamptz,access_expires_at timestamptz,family_expires_at timestamptz) language sql stable security definer set search_path='' as $$
 select old.action_expires_at,old.access_expires_at,greatest(old.family_expires_at,(select max(access_expires_at) from public.ap_service_repair_releases where order_id=p_order_id))
 from public.ap_service_retention_deadlines_before_099(p_order_id) old;
$$;
alter function public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz) rename to ap_authorize_material_download_before_099;
create function public.ap_authorize_material_download(p_customer_id uuid,p_artifact_id uuid,p_file_version_id uuid,p_reauthenticated_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare file public.ap_service_repair_files; release public.ap_service_repair_releases; config public.ap_commerce_configuration; expires timestamptz; now_at timestamptz:=clock_timestamp(); original_job uuid;
begin
 select * into file from public.ap_service_repair_files where id=p_file_version_id and artifact_id=p_artifact_id and customer_id=p_customer_id;
 if file.id is null then
  if exists(select 1 from public.ap_service_repair_files f join public.ap_service_repair_releases r on r.repair_version_id=f.repair_version_id where f.original_file_version_id=p_file_version_id and f.artifact_id=p_artifact_id and f.customer_id=p_customer_id) then raise exception 'material_download_unavailable'; end if;
  return public.ap_authorize_material_download_before_099(p_customer_id,p_artifact_id,p_file_version_id,p_reauthenticated_at);
 end if;
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'material_download_unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||p_customer_id::text,0));
 select * into config from public.ap_commerce_configuration where singleton;
 if config.download_ttl_seconds is distinct from 900 or config.reauthentication_window_seconds is distinct from 900 or p_reauthenticated_at is null or p_reauthenticated_at>now_at or p_reauthenticated_at<now_at-interval '15 minutes' then raise exception 'fresh_reauthentication_required'; end if;
 select r.* into release from public.ap_service_repair_releases r join public.ap_service_repair_files f on f.repair_version_id=r.repair_version_id where f.original_file_version_id=file.original_file_version_id order by r.committed_at desc,r.id desc limit 1;
 if release.repair_version_id is distinct from file.repair_version_id or file.storage_path is null
  or exists(select 1 from public.ap_retention_row_receipts where table_name='ap_service_repair_files' and row_id=file.id::text)
  or exists(select 1 from public.ap_service_retention_claims where customer_id=p_customer_id and state='PENDING')
  or exists(select 1 from public.ap_artifact_reference_permissions link join public.ap_reference_permissions permission on permission.id=link.reference_permission_id where link.artifact_id=file.artifact_id and (permission.revoked_at is not null or permission.contact_version_changed_at is not null))
  then raise exception 'material_download_unavailable'; end if;
 if file.artifact_type='REFERENCE_SHEET' then
  select (o->>'draftJobId')::uuid into original_job from public.ap_service_repair_versions v cross join lateral jsonb_array_elements(v.originals) o
   where v.id=file.repair_version_id and o->>'fileVersionId'=file.original_file_version_id::text;
  perform public.ap_assert_material_draft_reference_provenance(original_job,file.artifact_type,file.registration->'p_claim_provenance');
 end if;
 expires:=least(now_at+interval '15 minutes',public.ap_material_retention_deadline(file.material_line_id));
 perform public.ap_assert_service_retention_access(release.order_id,file.material_line_id,false);
 if expires<=now_at then raise exception 'service_retention_access_expired'; end if;
 insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
 values(p_customer_id,'SERVICE_REPAIR_DOWNLOAD_AUTHORIZED','SERVICE_REPAIR_FILE',file.id,jsonb_build_object('artifactId',file.artifact_id,'checksumSha256',file.checksum_sha256,'expiresAt',expires),'service-repair-v1');
 return jsonb_build_object('bucket',file.storage_bucket,'path',file.storage_path,'filename',file.safe_filename,'checksumSha256',file.checksum_sha256,'mimeType',file.mime_type,'version',(select version from public.ap_service_repair_versions where id=file.repair_version_id),'expiresAt',expires);
end $$;

-- Enumerate every repair output, including drafts and superseded repair files.
-- Open cases retain necessary data; completed families follow the same deadline
-- and shared-owner veto as other private content, never an arbitrary blob TTL.
alter function public.ap_retention_object_references() rename to ap_retention_object_references_before_099;
create function public.ap_retention_object_references() returns table(bucket text,path text,customer_ids uuid[],prospective boolean) language sql stable security definer set search_path='' as $$
 select * from public.ap_retention_object_references_before_099()
 union all select paths.bucket,paths.path,public.ap_retention_row_customers('ap_service_repair_files',to_jsonb(f)),exists(select 1 from public.ap_order_retention_contracts c where c.customer_id=f.customer_id)
 from public.ap_service_repair_files f cross join lateral(values(f.storage_bucket,f.storage_path),(f.preview_bucket,f.preview_path),(f.editable_bucket,f.editable_path)) paths(bucket,path)
 where not exists(select 1 from public.ap_retention_row_receipts receipt where receipt.table_name='ap_service_repair_files' and receipt.row_id=f.id::text);
$$;
alter function public.ap_retention_row_object_paths(jsonb) rename to ap_retention_row_object_paths_before_099;
create function public.ap_retention_row_object_paths(p_row jsonb) returns table(bucket text,path text) language sql immutable set search_path='' as $$
 select * from public.ap_retention_row_object_paths_before_099(p_row)
 union select p_row->>'preview_bucket',p_row->>'preview_path' where p_row->>'preview_path' is not null
 union select p_row->>'editable_bucket',p_row->>'editable_path' where p_row->>'editable_path' is not null;
$$;
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_export_service_retention_overlay()'::regprocedure);
 anchor:=$a$'sourceWatermark',greatest($a$;
 if position(anchor in definition)=0 then raise exception 'service_repair_watermark_anchor_missing'; end if;
 execute replace(definition,anchor,anchor||$a$coalesce((select max(committed_at) from public.ap_service_repair_releases),'1970-01-01Z'::timestamptz),coalesce((select max(created_at) from public.ap_service_repair_case_events),'1970-01-01Z'::timestamptz),coalesce((select max(created_at) from public.ap_service_repair_feedback),'1970-01-01Z'::timestamptz),$a$);
end $$;

insert into public.ap_retention_private_tables(table_name,primary_key,redaction_patch) values
 ('ap_service_repair_jobs','id','{}'),('ap_service_repair_versions','id','{}'),
 ('ap_service_repair_files','id','{"storage_path":null,"preview_path":null,"editable_path":null,"safe_filename":null,"registration":{}}'),
 ('ap_service_repair_releases','id','{}'),('ap_service_repair_case_events','id','{}'),('ap_service_repair_feedback','id','{}');
do $$ declare name text; f record; begin
 foreach name in array array['ap_service_repair_jobs','ap_service_repair_versions','ap_service_repair_files','ap_service_repair_releases','ap_service_repair_case_events','ap_service_repair_feedback'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  execute format('grant select on public.%I to service_role',name);
  execute format('create trigger ap_service_retention_write before insert or update on public.%I for each row execute function public.ap_guard_service_retention_write()',name);
  if name in('ap_service_repair_files','ap_service_repair_releases','ap_service_repair_case_events','ap_service_repair_feedback') then execute format('create trigger ap_service_repair_immutable before update or delete on public.%I for each row execute function public.ap_guard_service_error_history()',name); end if;
  insert into public.ap_archive_fence_relations values('public',name);
  execute format('create trigger ap_archive_source_mutation before insert or update or delete or truncate on public.%I for each statement execute function public.ap_guard_archive_source_mutation()',name);
 end loop;
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
  (p.proname like 'ap_%service_repair%' or p.proname in('ap_material_retention_deadline','ap_material_retention_deadline_before_099','ap_service_retention_deadlines','ap_service_retention_deadlines_before_099','ap_retention_object_references','ap_retention_object_references_before_099','ap_retention_row_object_paths','ap_retention_row_object_paths_before_099','ap_authorize_material_download','ap_authorize_material_download_before_099')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('alter function %s set lock_timeout=''5s''',f.signature);
  if f.proname in('ap_inspect_service_repair','ap_read_service_repair_version','ap_record_service_repair_feedback','ap_open_service_repair','ap_claim_service_repair','ap_attach_service_repair_source','ap_review_service_repair_wording','ap_register_service_repair_files','ap_approve_service_repair','ap_send_service_repair','ap_set_service_repair_case_state','ap_customer_service_repair_files','ap_authorize_material_download') then execute format('grant execute on function %s to service_role',f.signature); end if;
 end loop;
end $$;

-- Pin only the reviewed changed helpers and their explicit new dependencies.
update public.ap_archive_fence_function_contracts set definition_sha256=encode(extensions.digest(pg_get_functiondef(signature::regprocedure),'sha256'),'hex')
 where signature in('public.ap_service_retention_deadlines(uuid)','public.ap_retention_object_references()','public.ap_export_service_retention_overlay()');
insert into public.ap_archive_fence_function_contracts select signature,encode(extensions.digest(pg_get_functiondef(signature::regprocedure),'sha256'),'hex') from unnest(array[
 'public.ap_service_retention_deadlines_before_099(uuid)','public.ap_material_retention_deadline(uuid)','public.ap_material_retention_deadline_before_099(uuid)',
 'public.ap_retention_object_references_before_099()','public.ap_retention_row_object_paths(jsonb)','public.ap_retention_row_object_paths_before_099(jsonb)']) signature;
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_archive_fence_coverage_current()'::regprocedure);
 if position('count(*)=11' in definition)=0 then raise exception 'service_repair_archive_contract_anchor_missing'; end if;
 definition:=replace(definition,'count(*)=11','count(*)=17');
 anchor:=$a$'public.ap_service_retention_object_policies()','public.ap_export_service_retention_overlay()'$a$;
 if position(anchor in definition)=0 then raise exception 'service_repair_archive_roster_anchor_missing'; end if;
 definition:=replace(definition,anchor,anchor||$a$,'public.ap_service_retention_deadlines_before_099(uuid)','public.ap_material_retention_deadline(uuid)','public.ap_material_retention_deadline_before_099(uuid)','public.ap_retention_object_references_before_099()','public.ap_retention_row_object_paths(jsonb)','public.ap_retention_row_object_paths_before_099(jsonb)'$a$);
 execute definition;
end $$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at) values('202610250099','SCOPED_SERVICE_ERROR_REPAIRS',0,clock_timestamp());
create function public.ap_service_repair_schema_installed() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250099' and checkpoint='SCOPED_SERVICE_ERROR_REPAIRS')
 and public.ap_archive_fence_coverage_current()
 and (select count(*)=6 from public.ap_retention_private_tables where table_name in('ap_service_repair_jobs','ap_service_repair_versions','ap_service_repair_files','ap_service_repair_releases','ap_service_repair_case_events','ap_service_repair_feedback'))
 and to_regprocedure('public.ap_send_service_repair(uuid,text,text,text,uuid,uuid,uuid)') is not null
 and not has_function_privilege('authenticated','public.ap_open_service_repair(uuid,uuid,uuid,uuid,text,text,uuid)','EXECUTE')
 and not has_table_privilege('service_role','public.ap_service_repair_files','INSERT,UPDATE,DELETE,TRUNCATE');
$$;
revoke all on function public.ap_service_repair_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_service_repair_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=22 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250098''' in definition)=0
  or position('(''202610250098'',''PROTECTED_ARCHIVE_LIFECYCLE'')' in definition)=0 or position('''202610250097'',''202610250098''' in definition)=0
  or position('public.ap_protected_archive_schema_installed()' in definition)=0 then raise exception 'service_repair_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=22 as installed','select count(*)=23 as installed');
 definition:=replace(definition,'(''202610250098'',''PROTECTED_ARCHIVE_LIFECYCLE'')','(''202610250098'',''PROTECTED_ARCHIVE_LIFECYCLE''),(''202610250099'',''SCOPED_SERVICE_ERROR_REPAIRS'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250098''','''requiredSchemaVersion'', ''202610250099''');
 definition:=replace(definition,'''202610250097'',''202610250098''','''202610250097'',''202610250098'',''202610250099''');
 definition:=replace(definition,'public.ap_protected_archive_schema_installed()','public.ap_protected_archive_schema_installed() and public.ap_service_repair_schema_installed()');
 execute definition;
end $$;
commit;
