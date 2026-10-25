begin;

-- An actual owner review may confirm that the exact employer instructions are
-- unchanged. It adds evidence; it never rewrites their original checked_at or
-- silently carries document approval into a new evidence packet.
create table public.ap_material_rule_revalidations (
 id uuid primary key,
 customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id),
 job_id uuid not null references public.ap_material_draft_jobs(id),
 line_revision_id uuid not null references public.ap_material_line_revisions(id),
 reviewed_version_id uuid references public.ap_material_draft_versions(id),
 reviewed_lease_generation bigint not null check(reviewed_lease_generation>=0),
 review_method text not null default 'OWNER_REOPENED_PUBLIC_APPLICATION' check(review_method='OWNER_REOPENED_PUBLIC_APPLICATION'),
 basis jsonb not null check(jsonb_typeof(basis)='object' and octet_length(basis::text)<4000),
 review_checklist jsonb not null check(jsonb_typeof(review_checklist)='object' and octet_length(review_checklist::text)<1000),
 checked_by uuid not null references public.profiles(id),
 checked_at timestamptz not null,
 receipt_sha256 text not null check(receipt_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
create index ap_material_rule_revalidation_current on public.ap_material_rule_revalidations(job_id,checked_at desc,id desc);
alter table public.ap_material_rule_revalidations enable row level security;
revoke all on public.ap_material_rule_revalidations from public,anon,authenticated,service_role;
grant select on public.ap_material_rule_revalidations to service_role;
insert into public.ap_retention_private_tables(table_name,primary_key,redaction_patch)
values('ap_material_rule_revalidations','id','{}');
create trigger ap_service_retention_write before insert or update on public.ap_material_rule_revalidations
 for each row execute function public.ap_guard_service_retention_write();
create trigger ap_material_rule_revalidation_immutable before update or delete on public.ap_material_rule_revalidations
 for each row execute function public.ap_prevent_immutable_mutation();

-- This read is deliberately available when the rule's age alone has expired.
-- All ownership, payment, restore, deadline and current-source checks still run.
create function public.ap_material_draft_rule_evidence(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; revision public.ap_material_line_revisions;
 rule public.ap_employer_submission_rules; job public.ap_job_snapshots;
 receipt public.ap_material_rule_revalidations; source_evidence jsonb; expected_basis jsonb; effective timestamptz; now_at timestamptz:=clock_timestamp();
begin
 j:=public.ap_lock_material_draft_job(p_job_id);
 lock table public.ap_employer_submission_rules,public.ap_job_snapshots,public.ap_job_snapshot_invalidations,
  public.ap_requirement_nodes,public.jobs,public.job_sources,public.job_source_runs,
  public.ap_source_authorizations,public.ap_source_authorization_heads,public.job_source_references,
  public.job_source_run_listings,public.job_source_listing_projections,public.ap_source_verifications,
  public.ap_manual_source_observations in share mode;
 select * into revision from public.ap_material_line_revisions where id=j.line_revision_id;
 select * into rule from public.ap_employer_submission_rules where id=revision.employer_rule_snapshot_id for share;
 select * into job from public.ap_job_snapshots where id=revision.job_snapshot_id for share;
 select jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text) into source_evidence from public.ap_current_source_verifications(revision.job_snapshot_id) v;
 if rule.id is null or job.id is null or rule.job_snapshot_id is distinct from job.id
  or not rule.is_current or rule.superseded_at is not null or rule.injection_scan_state is distinct from 'CLEAR'
  or rule.hard_block_reason is not null or rule.checked_at>now_at or rule.human_confirmed_at>now_at
  or exists(select 1 from public.ap_job_snapshots where supersedes_job_snapshot_id=job.id)
  or exists(select 1 from public.ap_job_snapshot_invalidations where job_snapshot_id=job.id)
  or source_evidence is null or jsonb_array_length(source_evidence)=0 then raise exception 'material_rule_current_source_required'; end if;
 expected_basis:=jsonb_build_object('lineRevisionId',revision.id,'sourceSnapshotId',revision.source_snapshot_id,
  'jobSnapshotId',job.id,'jobContentSha256',job.content_sha256,'ruleId',rule.id,'ruleSha256',rule.content_sha256,
  'ruleRecordSha256',encode(extensions.digest(to_jsonb(rule)::text,'sha256'),'hex'),
  'sourceAuthoritySha256',encode(extensions.digest(source_evidence::text,'sha256'),'hex'));
 select * into receipt from public.ap_material_rule_revalidations r
  where r.job_id=j.id and r.material_line_id=j.material_line_id and r.line_revision_id=revision.id and r.customer_id=j.customer_id
   and r.basis=expected_basis and r.checked_at<=now_at and r.checked_at>now_at-interval '1 hour'
   and (r.reviewed_version_id is null or exists(select 1 from public.ap_material_draft_versions v where v.id=r.reviewed_version_id and v.job_id=j.id))
  order by r.checked_at desc,r.id desc limit 1 for share;
 effective:=greatest(rule.checked_at,receipt.checked_at);
 return jsonb_build_object('contractVersion','applypack-material-rule-revalidation-v1','jobId',j.id,
  'activeVersionId',j.active_version_id,'leaseGeneration',j.lease_generation,'basis',expected_basis,
  'originalCheckedAt',rule.checked_at,'effectiveCheckedAt',effective,
  'revalidation',case when receipt.id is null then null else to_jsonb(receipt) end);
end $$;

-- The HTTP owner action must enforce fresh administrator MFA. This RPC checks
-- actual staff identity and exact displayed evidence, and holds no network call.
create function public.ap_revalidate_material_draft_rule(p_job_id uuid,p_expected_version_id uuid,p_receipt_id uuid,p_expected_basis jsonb,p_review_checklist jsonb,p_reviewer_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions; evidence jsonb;
 receipt public.ap_material_rule_revalidations; checked timestamptz:=clock_timestamp(); body jsonb;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 if p_receipt_id is null or jsonb_typeof(p_expected_basis) is distinct from 'object' or octet_length(p_expected_basis::text)>=4000
  or jsonb_typeof(p_review_checklist) is distinct from 'object'
  or (select array_agg(key order by key) from jsonb_object_keys(p_review_checklist) key) is distinct from
   array['applicationAccessReviewed','liveListingOpened','submissionInstructionsCompared','unchangedRuleConfirmed']::text[]
  or exists(select 1 from jsonb_each(p_review_checklist) entry where entry.value is distinct from 'true'::jsonb)
  then raise exception 'material_rule_review_incomplete'; end if;
 j:=public.ap_lock_material_draft_job(p_job_id);
 evidence:=public.ap_material_draft_rule_evidence(j.id);
 if evidence->'basis' is distinct from p_expected_basis then raise exception 'material_rule_review_basis_changed'; end if;
 select * into receipt from public.ap_material_rule_revalidations where id=p_receipt_id;
 if receipt.id is not null then
  if row(receipt.job_id,receipt.reviewed_version_id,receipt.checked_by,receipt.basis,receipt.review_checklist)
   is not distinct from row(j.id,p_expected_version_id,p_reviewer_id,p_expected_basis,p_review_checklist)
   then return jsonb_build_object('receipt',to_jsonb(receipt),'replayed',true); end if;
  raise exception 'material_rule_review_receipt_conflict';
 end if;
 if j.active_version_id is distinct from p_expected_version_id then raise exception 'material_rule_review_version_changed'; end if;
 if j.active_version_id is null and j.state not in('EVIDENCE_PENDING','PREPARING','OWNER_EXCEPTION') then raise exception 'material_rule_review_version_changed'; end if;
 if j.active_version_id is not null then
  select * into v from public.ap_material_draft_versions where id=j.active_version_id for update;
  if v.id is null or v.invalidated_at is not null or v.release_id is not null then raise exception 'material_rule_review_version_changed'; end if;
 end if;
 if exists(select 1 from public.ap_material_draft_attempts where job_id=j.id and state in('DISPATCHED','RESULT_UNKNOWN'))
  then raise exception 'material_draft_result_unresolved'; end if;
 body:=jsonb_build_object('id',p_receipt_id,'customerId',j.customer_id,'materialLineId',j.material_line_id,'jobId',j.id,
  'lineRevisionId',j.line_revision_id,'reviewedVersionId',j.active_version_id,'reviewedLeaseGeneration',j.lease_generation,
  'basis',p_expected_basis,'reviewChecklist',p_review_checklist,'reviewMethod','OWNER_REOPENED_PUBLIC_APPLICATION','checkedBy',p_reviewer_id,'checkedAt',checked);
 insert into public.ap_material_rule_revalidations(id,customer_id,material_line_id,job_id,line_revision_id,reviewed_version_id,reviewed_lease_generation,
  basis,review_checklist,checked_by,checked_at,receipt_sha256)
 values(p_receipt_id,j.customer_id,j.material_line_id,j.id,j.line_revision_id,j.active_version_id,j.lease_generation,
  p_expected_basis,p_review_checklist,p_reviewer_id,checked,encode(extensions.digest(body::text,'sha256'),'hex')) returning * into receipt;
 update public.ap_artifact_quality_reviews q set invalidated_at=coalesce(q.invalidated_at,checked)
  where q.file_version_id in(select m.file_version_id from public.ap_material_draft_members m where m.draft_version_id=j.active_version_id);
 -- The old immutable approval remains evidence of its earlier review. Its
 -- context is now different, and only explicit packet refresh may replace it.
 update public.ap_material_draft_jobs set state=case when active_version_id is null then 'EVIDENCE_PENDING' else 'OWNER_EXCEPTION' end,
  error_code=case when active_version_id is null then null else 'EVIDENCE_STALE' end,
  lease_token=null,lease_owner=null,lease_expires_at=null,lease_generation=lease_generation+1,updated_at=checked where id=j.id;
 if j.active_version_id is not null then update public.ap_material_lines set fulfillment='HUMAN_REVIEW' where id=j.material_line_id; end if;
 insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
 values(j.customer_id,p_reviewer_id,'MATERIAL_RULE_UNCHANGED_REVIEWED','MATERIAL_LINE',j.material_line_id,
  jsonb_build_object('receiptId',receipt.id,'receiptSha256',receipt.receipt_sha256,'draftVersionId',j.active_version_id,'packetRefreshRequired',j.active_version_id is not null),'material-rule-revalidation-v1');
 return jsonb_build_object('receipt',to_jsonb(receipt),'replayed',false);
end $$;

-- Receipt freshness is a distinct source in the context. An ordinary listing
-- check cannot create or renew it, and any new receipt changes packet identity.
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_material_draft_context_sha256(uuid)'::regprocedure);
 anchor:='public.ap_human_review_records,public.ap_employer_submission_rules,public.ap_material_listing_checks,';
 if position(anchor in definition)=0 then raise exception 'material_rule_context_lock_anchor_missing'; end if;
 definition:=replace(definition,anchor,anchor||'public.ap_material_rule_revalidations,');
 anchor:='or rule.checked_at<clock_timestamp()-interval ''1 hour''';
 if position(anchor in definition)=0 then raise exception 'material_rule_context_freshness_anchor_missing'; end if;
 definition:=replace(definition,anchor,'or (public.ap_material_draft_rule_evidence(j.id)->>''effectiveCheckedAt'')::timestamptz<clock_timestamp()-interval ''1 hour''');
 anchor:='''snapshot'',to_jsonb(s),''rule'',to_jsonb(rule),''generationCheck'',to_jsonb(listing),';
 if position(anchor in definition)=0 then raise exception 'material_rule_context_receipt_anchor_missing'; end if;
 definition:=replace(definition,anchor,anchor||chr(10)||'  ''ruleRevalidation'',public.ap_material_draft_rule_evidence(j.id)->''revalidation'',');
 execute definition;
end $$;

-- A paid job needs a real BEFORE_GENERATION check before its first packet can
-- exist. Permit the exact null-version compare-and-swap only at that stage;
-- BEFORE_RELEASE and all later checks still require their displayed version.
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_record_material_draft_listing_check(uuid,uuid,uuid,text,text,text,uuid)'::regprocedure);
 anchor:='j.active_version_id is distinct from p_expected_version_id or p_expected_version_id is null';
 if position(anchor in definition)=0 then raise exception 'material_initial_listing_guard_anchor_missing'; end if;
 definition:=replace(definition,anchor,
  'j.active_version_id is distinct from p_expected_version_id or (p_expected_version_id is null and (p_phase is distinct from ''BEFORE_GENERATION'' or j.state not in(''EVIDENCE_PENDING'',''PREPARING'',''OWNER_EXCEPTION'')))');
 execute definition;
end $$;

revoke all on function public.ap_material_draft_rule_evidence(uuid) from public,anon,authenticated;
revoke all on function public.ap_revalidate_material_draft_rule(uuid,uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ap_material_draft_rule_evidence(uuid) to service_role;
grant execute on function public.ap_revalidate_material_draft_rule(uuid,uuid,uuid,jsonb,jsonb,uuid) to service_role;
alter function public.ap_material_draft_rule_evidence(uuid) set lock_timeout='5s';
alter function public.ap_revalidate_material_draft_rule(uuid,uuid,uuid,jsonb,jsonb,uuid) set lock_timeout='5s';

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610250092','MATERIAL_RULE_REVALIDATION',0,clock_timestamp());
create function public.ap_material_rule_revalidation_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
 and exists(select 1 from pg_class where oid=to_regclass('public.ap_material_rule_revalidations') and relrowsecurity)
 and to_regprocedure('public.ap_material_draft_rule_evidence(uuid)') is not null
 and to_regprocedure('public.ap_revalidate_material_draft_rule(uuid,uuid,uuid,jsonb,jsonb,uuid)') is not null
 and exists(select 1 from public.ap_retention_private_tables where table_name='ap_material_rule_revalidations' and primary_key='id' and redaction_patch='{}')
 and not exists(select 1 from unnest(array['ap_service_retention_write','ap_material_rule_revalidation_immutable']) name
  where not exists(select 1 from pg_trigger t where t.tgrelid='public.ap_material_rule_revalidations'::regclass and t.tgname=name and not t.tgisinternal and t.tgenabled='O'));
$$;
revoke all on function public.ap_material_rule_revalidation_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_material_rule_revalidation_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=15 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250091''' in definition)=0
  or position('(''202610250091'',''MATERIAL_DRAFT_PAIR_WORKFLOW'')' in definition)=0 or position('''202610250090'',''202610250091''' in definition)=0
  then raise exception 'material_rule_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=15 as installed','select count(*)=16 as installed');
 definition:=replace(definition,'(''202610250091'',''MATERIAL_DRAFT_PAIR_WORKFLOW'')','(''202610250091'',''MATERIAL_DRAFT_PAIR_WORKFLOW''),(''202610250092'',''MATERIAL_RULE_REVALIDATION'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250091''','''requiredSchemaVersion'', ''202610250092''');
 definition:=replace(definition,'''202610250090'',''202610250091''','''202610250090'',''202610250091'',''202610250092''');
 definition:=replace(definition,'public.ap_material_draft_pair_schema_installed()','public.ap_material_draft_pair_schema_installed() and public.ap_material_rule_revalidation_schema_installed()');
 execute definition;
end $$;
commit;
