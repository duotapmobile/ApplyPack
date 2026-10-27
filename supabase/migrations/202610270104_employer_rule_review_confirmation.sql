begin;
-- pg_get_functiondef qualifies composite argument types according to the
-- caller's search path. Hash definitions under the same empty path used by
-- the archive coverage verifier, including the two new composite helpers.
set local search_path='';

-- Public employer instructions and staff review evidence only. This table has
-- no customer intake, document, access email, or customer-retention payload.
create table public.ap_employer_rule_review_receipts (
 request_id uuid primary key,
 job_snapshot_id uuid not null references public.ap_job_snapshots(id),
 reviewer_id uuid not null references public.profiles(id),
 expected_basis jsonb not null check(jsonb_typeof(expected_basis)='object' and octet_length(expected_basis::text)<4000),
 confirmed_rules jsonb not null check(jsonb_typeof(confirmed_rules)='object' and octet_length(confirmed_rules::text)<=140000),
 confirmed_rules_sha256 text not null check(confirmed_rules_sha256 ~ '^[0-9a-f]{64}$'),
 review_checklist jsonb not null check(jsonb_typeof(review_checklist)='object' and octet_length(review_checklist::text)<1000),
 review_evidence jsonb not null check(jsonb_typeof(review_evidence)='object' and octet_length(review_evidence::text)<16000),
 rule_id uuid not null references public.ap_employer_submission_rules(id),
 rule_content_sha256 text not null check(rule_content_sha256 ~ '^[0-9a-f]{64}$'),
 checked_at timestamptz not null,
 receipt_sha256 text not null check(receipt_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 check(confirmed_rules_sha256=encode(extensions.digest(confirmed_rules::text,'sha256'),'hex'))
);
create index ap_employer_rule_review_current on public.ap_employer_rule_review_receipts(rule_id,checked_at desc,request_id);
alter table public.ap_employer_rule_review_receipts enable row level security;
revoke all on public.ap_employer_rule_review_receipts from public,anon,authenticated,service_role;
grant select on public.ap_employer_rule_review_receipts to service_role;
create trigger ap_employer_rule_review_immutable before update or delete on public.ap_employer_rule_review_receipts
 for each row execute function public.ap_prevent_immutable_mutation();

create function public.ap_normalize_employer_review_rules(p_rules jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare names text[]; value jsonb; result jsonb:=p_rules; name text;
begin
 if jsonb_typeof(p_rules) is distinct from 'object' or octet_length(p_rules::text)>140000 then raise exception 'employer_rule_fields_invalid'; end if;
 select array_agg(key order by key) into names from jsonb_object_keys(p_rules) key;
 if names is distinct from array['allowedFormats','applicationQuestions','coverLetterFilenameInstruction','coverLetterPageLimit','coverLetterRequirement',
  'hardBlockReason','injectionScanState','parserVersion','portfolioInstruction','referenceCount','referenceFilenameInstruction','referenceTiming',
  'resumeFilenameInstruction','resumePageLimit','resumeRequirement','sourceEvidenceIds','submissionChannel','workSampleInstruction']::text[]
  or p_rules->>'resumeRequirement' not in('REQUIRED','OPTIONAL','PROHIBITED')
  or p_rules->>'coverLetterRequirement' not in('REQUIRED','OPTIONAL','PROHIBITED')
  or p_rules->>'referenceTiming' not in('OPTIONAL_NOW','REQUIRED_NOW','PROHIBITED_NOW','LATER_OR_UNKNOWN')
  or p_rules->>'submissionChannel' not in('HTTPS_UPLOAD','EMAIL','OTHER_SUPPORTED','UNSUPPORTED')
  or p_rules->>'injectionScanState' is distinct from 'CLEAR'
  or jsonb_typeof(p_rules->'parserVersion') is distinct from 'string' or length(btrim(p_rules->>'parserVersion')) not between 3 and 100
  or p_rules->'resumePageLimit' not in('null'::jsonb,'1'::jsonb,'2'::jsonb)
  or p_rules->'coverLetterPageLimit' not in('null'::jsonb,'1'::jsonb)
  or (p_rules->'referenceCount'<>'null'::jsonb and (jsonb_typeof(p_rules->'referenceCount')<>'number' or (p_rules->>'referenceCount')!~'^[1-9][0-9]?$'))
  or jsonb_typeof(p_rules->'sourceEvidenceIds') is distinct from 'array'
  or jsonb_typeof(p_rules->'allowedFormats') is distinct from 'array'
  or jsonb_typeof(p_rules->'applicationQuestions') is distinct from 'array'
 then raise exception 'employer_rule_fields_invalid'; end if;
 if jsonb_array_length(p_rules->'sourceEvidenceIds') not between 1 and 100
  or jsonb_array_length(p_rules->'allowedFormats') not between 1 and 2
  or jsonb_array_length(p_rules->'applicationQuestions')>100 or octet_length((p_rules->'applicationQuestions')::text)>128000
  or exists(select 1 from jsonb_array_elements(p_rules->'applicationQuestions') item where jsonb_typeof(item)<>'object')
  or exists(select 1 from jsonb_array_elements(p_rules->'sourceEvidenceIds') item where jsonb_typeof(item)<>'string' or item#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  or exists(select 1 from jsonb_array_elements(p_rules->'allowedFormats') item where item not in('"DOCX"'::jsonb,'"PDF"'::jsonb))
  or (select count(*)<>count(distinct item) from jsonb_array_elements(p_rules->'sourceEvidenceIds') item)
  or (select count(*)<>count(distinct item) from jsonb_array_elements(p_rules->'allowedFormats') item)
 then raise exception 'employer_rule_fields_invalid'; end if;
 foreach name in array array['resumeRequirement','coverLetterRequirement','referenceTiming','submissionChannel'] loop
  if jsonb_typeof(p_rules->name) is distinct from 'string' then raise exception 'employer_rule_fields_invalid'; end if;
 end loop;
 foreach name in array array['resumeFilenameInstruction','coverLetterFilenameInstruction','referenceFilenameInstruction','portfolioInstruction','workSampleInstruction','hardBlockReason'] loop
  value:=p_rules->name;
  if value<>'null'::jsonb and (jsonb_typeof(value)<>'string' or length(value#>>'{}')>case when name in('portfolioInstruction','workSampleInstruction') then 1000 when name='hardBlockReason' then 500 else 180 end)
   then raise exception 'employer_rule_fields_invalid'; end if;
  result:=jsonb_set(result,array[name],coalesce(to_jsonb(nullif(btrim(value#>>'{}'),'')),'null'::jsonb));
 end loop;
 if (result->>'resumeRequirement'='PROHIBITED' or result->>'coverLetterRequirement'='PROHIBITED') and result->'hardBlockReason'='null'::jsonb
  then raise exception 'employer_rule_block_reason_required'; end if;
 result:=jsonb_set(result,'{parserVersion}',to_jsonb(btrim(result->>'parserVersion')));
 result:=jsonb_set(result,'{sourceEvidenceIds}',(select jsonb_agg(item order by item) from jsonb_array_elements(result->'sourceEvidenceIds') item));
 return jsonb_set(result,'{allowedFormats}',(select jsonb_agg(item order by item) from jsonb_array_elements(result->'allowedFormats') item));
end $$;

create function public.ap_employer_rule_fields(p_rule public.ap_employer_submission_rules) returns jsonb
language sql immutable set search_path='' as $$
 select public.ap_normalize_employer_review_rules(jsonb_build_object(
  'sourceEvidenceIds',p_rule.source_evidence_ids,'resumeRequirement',p_rule.resume_requirement,'coverLetterRequirement',p_rule.cover_letter_requirement,
  'allowedFormats',p_rule.allowed_formats,'resumePageLimit',p_rule.resume_page_limit,'coverLetterPageLimit',p_rule.cover_letter_page_limit,
  'resumeFilenameInstruction',p_rule.resume_filename_instruction,'coverLetterFilenameInstruction',p_rule.cover_letter_filename_instruction,
  'referenceFilenameInstruction',p_rule.reference_filename_instruction,'referenceTiming',p_rule.reference_timing,'referenceCount',p_rule.reference_count,
  'submissionChannel',p_rule.submission_channel,'portfolioInstruction',p_rule.portfolio_instruction,'workSampleInstruction',p_rule.work_sample_instruction,
  'applicationQuestions',p_rule.application_questions,'parserVersion',p_rule.parser_version,'injectionScanState',p_rule.injection_scan_state,'hardBlockReason',p_rule.hard_block_reason));
$$;

-- Take the table's write intention before row locks: paid092 evidence readers
-- take SHARE on this table before reading the row. The opposite order deadlocks.
create function public.ap_lock_employer_rule_review(p_job_snapshot_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_job_snapshot_id is null then raise exception 'employer_rule_job_required'; end if;
 perform pg_catalog.pg_advisory_xact_lock_shared(6384910250098);
 if public.ap_archive_fence_active() then raise exception using errcode='40001',message='archive_maintenance_retry_required'; end if;
 lock table public.ap_employer_submission_rules in row exclusive mode;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('applypack-employer-rule-review:'||p_job_snapshot_id::text,0));
end $$;

create function public.ap_employer_rule_basis_value(p_job_snapshot_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.ap_job_snapshots; rule public.ap_employer_submission_rules; authority jsonb; nodes jsonb;
begin
 select * into job from public.ap_job_snapshots where id=p_job_snapshot_id;
 select * into rule from public.ap_employer_submission_rules where job_snapshot_id=p_job_snapshot_id and is_current;
 select jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text) into authority from public.ap_current_source_verifications(p_job_snapshot_id) v;
 select jsonb_agg(to_jsonb(n) order by n.id) into nodes from public.ap_requirement_nodes n where n.job_snapshot_id=p_job_snapshot_id;
 if job.id is null or authority is null or nodes is null or job.retrieved_at>clock_timestamp()
  or job.live_verified_at>clock_timestamp() then raise exception 'employer_rule_current_source_required'; end if;
 -- Question captures are inside the immutable captured_listing/job row. Bind
 -- their current run and READ_APPLICATION_QUESTIONS authority too, not only the
 -- verification IDs that establish permission to display a listing.
 select jsonb_build_object('verifications',authority,'authorization',to_jsonb(a),'head',to_jsonb(h),'run',to_jsonb(r)) into authority
 from public.ap_source_authorizations a join public.ap_source_authorization_heads h on h.source_id=a.source_id
 left join public.job_source_runs r on r.id=job.source_run_id where a.id=job.source_authorization_id;
 if authority is null then raise exception 'employer_rule_current_source_required'; end if;
 return jsonb_build_object('contractVersion','applypack-employer-rule-review-v1','jobSnapshotId',job.id,'jobContentSha256',job.content_sha256,
  'jobRecordSha256',encode(extensions.digest(to_jsonb(job)::text,'sha256'),'hex'),
  'sourceAuthoritySha256',encode(extensions.digest(authority::text,'sha256'),'hex'),
  'sourceEvidenceSha256',encode(extensions.digest(nodes::text,'sha256'),'hex'),
  'currentRuleId',rule.id,'currentRuleRecordSha256',case when rule.id is null then null else encode(extensions.digest(to_jsonb(rule)::text,'sha256'),'hex') end);
end $$;

create function public.ap_employer_rule_receipt_current(p_receipt public.ap_employer_rule_review_receipts) returns boolean
language plpgsql security definer set search_path='' as $$
declare basis jsonb; rule public.ap_employer_submission_rules;
begin
 if p_receipt.request_id is null or p_receipt.checked_at>clock_timestamp() or p_receipt.checked_at<clock_timestamp()-interval '1 hour' then return false; end if;
 basis:=public.ap_employer_rule_basis_value(p_receipt.job_snapshot_id);
 select * into rule from public.ap_employer_submission_rules where id=p_receipt.rule_id and is_current;
 return coalesce(rule.job_snapshot_id=p_receipt.job_snapshot_id and rule.content_sha256=p_receipt.rule_content_sha256
  and (basis-array['currentRuleId','currentRuleRecordSha256'])=(p_receipt.expected_basis-array['currentRuleId','currentRuleRecordSha256']),false);
exception when raise_exception then return false;
end $$;

-- Freshness here is only for a NEW checkout. Existing paid packets continue to
-- use the original rule and the line-specific092 revalidation contract.
create function public.ap_employer_rule_precheckout_checked_at(p_rule_id uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare rule public.ap_employer_submission_rules; receipt public.ap_employer_rule_review_receipts;
begin
 select * into rule from public.ap_employer_submission_rules where id=p_rule_id and is_current;
 if not found then return null; end if;
 for receipt in select * from public.ap_employer_rule_review_receipts where rule_id=rule.id and checked_at<=clock_timestamp()
  and checked_at>clock_timestamp()-interval '1 hour' order by checked_at desc,request_id desc loop
  if public.ap_employer_rule_receipt_current(receipt) then return greatest(rule.checked_at,receipt.checked_at); end if;
 end loop;
 return rule.checked_at;
end $$;

create function public.ap_employer_rule_review_basis(p_job_snapshot_id uuid,p_reviewer_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare basis jsonb; rule public.ap_employer_submission_rules; evidence_id uuid;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 basis:=public.ap_employer_rule_basis_value(p_job_snapshot_id);
 select * into rule from public.ap_employer_submission_rules where id=(basis->>'currentRuleId')::uuid;
 select n.id into evidence_id from public.ap_requirement_nodes n where n.job_snapshot_id=p_job_snapshot_id
  and n.classification_method='employer-instruction-source-v1';
 return jsonb_build_object('basis',basis,'currentRule',case when rule.id is null then null else to_jsonb(rule) end,
  'sourceEvidenceId',evidence_id,
  'effectivePrepurchaseCheckedAt',case when rule.id is null then null else public.ap_employer_rule_precheckout_checked_at(rule.id) end);
end $$;

create function public.ap_guard_employer_rule_source_evidence() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op<>'INSERT' and old.classification_method='employer-instruction-source-v1' then raise exception 'employer_rule_source_evidence_immutable'; end if;
 if tg_op='DELETE' then return old; end if;
 if new.parent_id is not null and exists(select 1 from public.ap_requirement_nodes where id=new.parent_id and classification_method='employer-instruction-source-v1')
  then raise exception 'employer_rule_source_evidence_cannot_parent_matching'; end if;
 return new;
end $$;
create trigger ap_employer_rule_source_evidence_immutable before insert or update or delete on public.ap_requirement_nodes
 for each row execute function public.ap_guard_employer_rule_source_evidence();
create unique index ap_employer_rule_source_evidence_one_per_job on public.ap_requirement_nodes(job_snapshot_id)
 where classification_method='employer-instruction-source-v1';

-- Explicit preparation, never a GET side effect or a new source observation.
-- The disconnected informational node does not enter the matching hard tree.
create function public.ap_prepare_employer_rule_source_evidence(p_job_snapshot_id uuid,p_reviewer_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.ap_job_snapshots; existing public.ap_requirement_nodes; evidence_id uuid; digest text; typed jsonb; body text; created boolean:=false;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 perform public.ap_lock_employer_rule_review(p_job_snapshot_id);
 -- Write intention precedes the source locks; confirmation only takes SHARE
 -- here and never attempts to upgrade that lock to insert missing evidence.
 lock table public.ap_requirement_nodes in row exclusive mode;
 lock table public.ap_job_snapshots,public.ap_job_snapshot_invalidations,public.jobs,public.job_sources,public.job_source_runs,
  public.ap_source_authorizations,public.ap_source_authorization_heads,public.job_source_references,public.job_source_run_listings,
  public.job_source_listing_projections,public.ap_source_verifications,public.ap_manual_source_observations in share mode;
 perform public.ap_employer_rule_basis_value(p_job_snapshot_id);
 select * into job from public.ap_job_snapshots where id=p_job_snapshot_id;
 body:=job.captured_listing->>'text';
 if jsonb_typeof(job.captured_listing->'text') is distinct from 'string' or length(btrim(body))=0 or length(body)>100000
  or job.application_host_type not in('EMPLOYER_HOSTED','APPROVED_THIRD_PARTY') then raise exception 'employer_rule_saved_text_required'; end if;
 digest:=encode(extensions.digest('employer-instruction-source-v1:'||job.id::text||':'||job.content_sha256,'sha256'),'hex');
 evidence_id:=(substr(digest,1,8)||'-'||substr(digest,9,4)||'-5'||substr(digest,14,3)||'-a'||substr(digest,18,3)||'-'||substr(digest,21,12))::uuid;
 typed:=jsonb_build_object('stableCriterionId',evidence_id,'semanticKey','employer-instruction-source:'||job.id::text,'strength','INFORMATIONAL',
  'sourceLocator','captured_listing.text','parserCertainty',1,'version','employer-instruction-source-v1','kind','LISTING_APPLICATION_PATH',
  'identity','saved-listing:'||job.id::text,'activeStatus','ACTIVE','sourceAuthorized',true,'applicationPath','ACTIONABLE','hostType',job.application_host_type);
 select * into existing from public.ap_requirement_nodes where id=evidence_id;
 if existing.id is not null then
  if existing.job_snapshot_id<>job.id or existing.parent_id is not null or existing.position<>2147483646 or existing.node_kind<>'CRITERION'
   or existing.criterion_type<>'LISTING_APPLICATION_PATH' or existing.stable_criterion_id<>evidence_id
   or existing.semantic_key is distinct from typed->>'semanticKey' or existing.requirement_strength<>'INFORMATIONAL'
   or existing.source_locator<>'captured_listing.text' or existing.parser_certainty<>1 or existing.criterion_version<>'employer-instruction-source-v1'
   or existing.classification_method<>'employer-instruction-source-v1' or existing.importance is distinct from 1 or existing.human_correction_history is distinct from '[]'::jsonb
   or existing.source_excerpt is distinct from body or existing.typed_value is distinct from typed
   or exists(select 1 from public.ap_requirement_nodes where parent_id=existing.id)
   then raise exception 'employer_rule_source_evidence_conflict'; end if;
 else
  insert into public.ap_requirement_nodes(id,job_snapshot_id,parent_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,
   source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,importance,human_correction_history)
  values(evidence_id,job.id,null,2147483646,'CRITERION','LISTING_APPLICATION_PATH',evidence_id,typed->>'semanticKey','INFORMATIONAL',
   'captured_listing.text',1,'employer-instruction-source-v1',typed,body,'employer-instruction-source-v1',1,'[]');
  created:=true;
 end if;
 return jsonb_build_object('sourceEvidenceId',evidence_id,'created',created,'basis',public.ap_employer_rule_basis_value(job.id));
end $$;

-- Preserve the exact091 paid context for every historical node. Only the
-- validated104 public-instruction attachment is excluded from qualifications.
create function public.ap_employer_rule_matching_requirements(p_job_snapshot_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.ap_job_snapshots; node public.ap_requirement_nodes; digest text; evidence_id uuid; typed jsonb; body text;
 result jsonb; source_count integer:=0;
begin
 select * into job from public.ap_job_snapshots where id=p_job_snapshot_id;
 body:=job.captured_listing->>'text';
 digest:=encode(extensions.digest('employer-instruction-source-v1:'||job.id::text||':'||job.content_sha256,'sha256'),'hex');
 evidence_id:=(substr(digest,1,8)||'-'||substr(digest,9,4)||'-5'||substr(digest,14,3)||'-a'||substr(digest,18,3)||'-'||substr(digest,21,12))::uuid;
 typed:=jsonb_build_object('stableCriterionId',evidence_id,'semanticKey','employer-instruction-source:'||job.id::text,'strength','INFORMATIONAL',
  'sourceLocator','captured_listing.text','parserCertainty',1,'version','employer-instruction-source-v1','kind','LISTING_APPLICATION_PATH',
  'identity','saved-listing:'||job.id::text,'activeStatus','ACTIVE','sourceAuthorized',true,'applicationPath','ACTIONABLE','hostType',job.application_host_type);
 for node in select * from public.ap_requirement_nodes where job_snapshot_id=p_job_snapshot_id order by id loop
  if node.criterion_version='employer-instruction-source-v1' or node.classification_method='employer-instruction-source-v1'
   or node.typed_value->>'version'='employer-instruction-source-v1' or node.semantic_key like 'employer-instruction-source:%'
   or node.typed_value->>'semanticKey' like 'employer-instruction-source:%' then
   source_count:=source_count+1;
   if source_count<>1 or job.id is null or jsonb_typeof(job.captured_listing->'text') is distinct from 'string'
    or length(btrim(body))=0 or length(body)>100000 or job.application_host_type not in('EMPLOYER_HOSTED','APPROVED_THIRD_PARTY')
    or node.id is distinct from evidence_id or node.parent_id is not null or node.position<>2147483646 or node.node_kind<>'CRITERION'
    or node.criterion_type is distinct from 'LISTING_APPLICATION_PATH'::public.ap_criterion_type or node.stable_criterion_id is distinct from evidence_id
    or node.semantic_key is distinct from typed->>'semanticKey' or node.requirement_strength is distinct from 'INFORMATIONAL'
    or node.source_locator is distinct from 'captured_listing.text' or node.parser_certainty is distinct from 1
    or node.criterion_version is distinct from 'employer-instruction-source-v1' or node.classification_method is distinct from 'employer-instruction-source-v1'
    or node.importance is distinct from 1 or node.human_correction_history is distinct from '[]'::jsonb
    or node.source_excerpt is distinct from body or node.typed_value is distinct from typed
    or exists(select 1 from public.ap_requirement_nodes child where child.parent_id=node.id)
    then raise exception 'employer_rule_source_evidence_invalid'; end if;
  else
   result:=coalesce(result,'[]'::jsonb)||jsonb_build_array(to_jsonb(node));
  end if;
 end loop;
 return result;
end $$;

create function public.ap_store_employer_rule_review(p_job_snapshot_id uuid,p_reviewer_id uuid,p_rules jsonb,p_checked_at timestamptz,p_expected_rule_id uuid,p_guarded boolean,p_legacy_content_sha256 text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.ap_employer_submission_rules; value jsonb; rule_id uuid:=gen_random_uuid(); content_hash text;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 perform public.ap_lock_employer_rule_review(p_job_snapshot_id);
 value:=public.ap_normalize_employer_review_rules(p_rules);
 if p_checked_at is null or p_checked_at>clock_timestamp() or not exists(select 1 from public.ap_job_snapshots where id=p_job_snapshot_id)
  or exists(select 1 from jsonb_array_elements_text(value->'sourceEvidenceIds') evidence_id where not exists(
   select 1 from public.ap_requirement_nodes n where n.id=evidence_id::uuid and n.job_snapshot_id=p_job_snapshot_id))
  then raise exception 'submission_rules_not_confirmable'; end if;
 select * into prior from public.ap_employer_submission_rules where job_snapshot_id=p_job_snapshot_id and is_current for update;
 -- Parser metadata alone does not change employer instructions or invalidate a
 -- paid revision. The immutable receipt still binds the exact parser input.
 if prior.id is not null and (public.ap_employer_rule_fields(prior)-array['parserVersion','sourceEvidenceIds'])=(value-array['parserVersion','sourceEvidenceIds']) then return prior.id; end if;
 if prior.id is not null and not p_guarded then raise exception 'employer_rule_guarded_confirmation_required'; end if;
 if p_guarded and prior.id is distinct from p_expected_rule_id then raise exception 'employer_rule_review_basis_changed'; end if;
 if prior.id is not null and (exists(select 1 from public.ap_material_line_revisions where employer_rule_snapshot_id=prior.id)
  or exists(select 1 from public.ap_material_checkout_items where submission_rule_id=prior.id))
  then raise exception 'employer_rule_paid_binding_requires_explicit_change'; end if;
 content_hash:=coalesce(p_legacy_content_sha256,encode(extensions.digest((value-array['parserVersion','sourceEvidenceIds'])::text,'sha256'),'hex'));
 update public.ap_employer_submission_rules set is_current=false,superseded_at=clock_timestamp() where id=prior.id;
 insert into public.ap_employer_submission_rules(id,job_snapshot_id,content_sha256,source_evidence_ids,resume_requirement,cover_letter_requirement,
  allowed_formats,resume_page_limit,cover_letter_page_limit,resume_filename_instruction,cover_letter_filename_instruction,reference_filename_instruction,
  reference_timing,reference_count,submission_channel,portfolio_instruction,work_sample_instruction,application_questions,parser_version,injection_scan_state,
  hard_block_reason,human_confirmed_by,human_confirmed_at,checked_at)
 values(rule_id,p_job_snapshot_id,content_hash,array(select id::uuid from jsonb_array_elements_text(value->'sourceEvidenceIds') id),
  value->>'resumeRequirement',value->>'coverLetterRequirement',array(select item from jsonb_array_elements_text(value->'allowedFormats') item),
  (value->>'resumePageLimit')::integer,(value->>'coverLetterPageLimit')::integer,value->>'resumeFilenameInstruction',value->>'coverLetterFilenameInstruction',
  value->>'referenceFilenameInstruction',value->>'referenceTiming',(value->>'referenceCount')::integer,value->>'submissionChannel',value->>'portfolioInstruction',
  value->>'workSampleInstruction',value->'applicationQuestions',value->>'parserVersion',value->>'injectionScanState',value->>'hardBlockReason',
  p_reviewer_id,clock_timestamp(),p_checked_at);
 insert into public.ap_audit_events(actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
 values(p_reviewer_id,'EMPLOYER_SUBMISSION_RULES_CONFIRMED','JOB_SNAPSHOT',p_job_snapshot_id,
  jsonb_build_object('ruleId',rule_id,'contentSha256',content_hash),'employer-rule-review-v1');
 return rule_id;
end $$;

-- Preserve the historical signature, but remove its ability to overwrite a
-- newer ordinary review. It can create once or return exactly equal content.
create or replace function public.ap_upsert_employer_submission_rules(
 p_reviewer_id uuid,p_job_snapshot_id uuid,p_content_sha256 text,p_source_evidence_ids uuid[],
 p_resume_requirement text,p_cover_letter_requirement text,p_allowed_formats text[],p_resume_page_limit integer,p_cover_letter_page_limit integer,
 p_resume_filename_instruction text,p_cover_letter_filename_instruction text,p_reference_filename_instruction text,
 p_reference_timing text,p_reference_count integer,p_submission_channel text,p_portfolio_instruction text,p_work_sample_instruction text,
 p_application_questions jsonb,p_parser_version text,p_injection_scan_state text,p_hard_block_reason text,p_checked_at timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'submission_rules_not_confirmable'; end if;
 return public.ap_store_employer_rule_review(p_job_snapshot_id,p_reviewer_id,jsonb_build_object(
  'sourceEvidenceIds',p_source_evidence_ids,'resumeRequirement',p_resume_requirement,'coverLetterRequirement',p_cover_letter_requirement,
  'allowedFormats',p_allowed_formats,'resumePageLimit',p_resume_page_limit,'coverLetterPageLimit',p_cover_letter_page_limit,
  'resumeFilenameInstruction',p_resume_filename_instruction,'coverLetterFilenameInstruction',p_cover_letter_filename_instruction,
  'referenceFilenameInstruction',p_reference_filename_instruction,'referenceTiming',p_reference_timing,'referenceCount',p_reference_count,
  'submissionChannel',p_submission_channel,'portfolioInstruction',p_portfolio_instruction,'workSampleInstruction',p_work_sample_instruction,
  'applicationQuestions',p_application_questions,'parserVersion',p_parser_version,'injectionScanState',p_injection_scan_state,'hardBlockReason',p_hard_block_reason),
  p_checked_at,null,false,p_content_sha256);
end $$;

create function public.ap_validate_employer_rule_citations(p_job_snapshot_id uuid,p_rules jsonb,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare node public.ap_requirement_nodes; job public.ap_job_snapshots; citation jsonb; field text; required_fields text[]; found_fields text[];
 body bytea; excerpt bytea; start_byte integer; end_byte integer;
begin
 if jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>=16000 then raise exception 'employer_rule_citations_invalid'; end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p_evidence) key) is distinct from
  array['citations','sourceEvidenceId','sourceTextSha256','version']::text[]
  or p_evidence->>'version' is distinct from 'applypack-employer-rule-citations-v1'
  or coalesce(p_evidence->>'sourceEvidenceId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_evidence->'citations') is distinct from 'array' then raise exception 'employer_rule_citations_invalid'; end if;
 select * into node from public.ap_requirement_nodes where id=(p_evidence->>'sourceEvidenceId')::uuid and job_snapshot_id=p_job_snapshot_id;
 select * into job from public.ap_job_snapshots where id=p_job_snapshot_id;
 if node.id is null or node.classification_method is distinct from 'employer-instruction-source-v1'
  or node.source_excerpt is distinct from job.captured_listing->>'text' or p_rules->'sourceEvidenceIds'<>jsonb_build_array(node.id)
  then raise exception 'employer_rule_citation_source_mismatch'; end if;
 body:=convert_to(node.source_excerpt,'UTF8');
 if p_evidence->>'sourceTextSha256' is distinct from encode(extensions.digest(body,'sha256'),'hex') then raise exception 'employer_rule_citation_source_mismatch'; end if;
 select array_agg(key order by key) into required_fields from jsonb_each(p_rules) item
 where key=any(array['resumeRequirement','coverLetterRequirement','allowedFormats','submissionChannel','resumePageLimit','coverLetterPageLimit',
  'resumeFilenameInstruction','coverLetterFilenameInstruction','referenceFilenameInstruction','referenceTiming','referenceCount','portfolioInstruction','workSampleInstruction'])
  and item.value<>'null'::jsonb and not(key='referenceTiming' and item.value='"LATER_OR_UNKNOWN"'::jsonb);
 if jsonb_array_length(p_evidence->'citations')<>cardinality(required_fields) then raise exception 'employer_rule_citations_incomplete'; end if;
 found_fields:=array[]::text[];
 for citation in select value from jsonb_array_elements(p_evidence->'citations') loop
  if jsonb_typeof(citation)<>'object' or (select array_agg(key order by key) from jsonb_object_keys(citation) key) is distinct from
   array['endByte','field','quoteSha256','startByte']::text[] or jsonb_typeof(citation->'field')<>'string'
   or coalesce(citation->>'startByte','')!~'^(0|[1-9][0-9]{0,5})$' or coalesce(citation->>'endByte','')!~'^[1-9][0-9]{0,5}$'
   or jsonb_typeof(citation->'startByte')<>'number' or jsonb_typeof(citation->'endByte')<>'number'
   then raise exception 'employer_rule_citations_invalid'; end if;
  field:=citation->>'field'; start_byte:=(citation->>'startByte')::integer; end_byte:=(citation->>'endByte')::integer;
  if not(field=any(required_fields)) or field=any(found_fields) or start_byte>=end_byte or end_byte>octet_length(body) or end_byte-start_byte>8000
   then raise exception 'employer_rule_citations_invalid'; end if;
  excerpt:=substring(body from start_byte+1 for end_byte-start_byte);
  if length(btrim(convert_from(excerpt,'UTF8')))<3 or citation->>'quoteSha256' is distinct from encode(extensions.digest(excerpt,'sha256'),'hex')
   then raise exception 'employer_rule_citation_quote_mismatch'; end if;
  found_fields:=array_append(found_fields,field);
 end loop;
 return jsonb_set(p_evidence,'{citations}',(select jsonb_agg(value order by value->>'field') from jsonb_array_elements(p_evidence->'citations')));
end $$;

create function public.ap_confirm_employer_submission_rules(p_job_snapshot_id uuid,p_reviewer_id uuid,p_request_id uuid,p_expected_basis jsonb,p_confirmed_rules jsonb,p_review_checklist jsonb,p_review_evidence jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt public.ap_employer_rule_review_receipts; basis jsonb; value jsonb; value_hash text; rule public.ap_employer_submission_rules; rule_id uuid;
 checked timestamptz; body jsonb; citations jsonb;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 if p_request_id is null or p_job_snapshot_id is null or jsonb_typeof(p_expected_basis) is distinct from 'object' or octet_length(p_expected_basis::text)>=4000
  or jsonb_typeof(p_review_checklist) is distinct from 'object' then raise exception 'employer_rule_review_incomplete'; end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p_review_checklist) key) is distinct from
  array['applicationOpened','listingOpened','noUnsupportedDefaults','questionsReviewed','requirementsConfirmed','sourceCompared']::text[]
  or exists(select 1 from jsonb_each(p_review_checklist) item where item.value is distinct from 'true'::jsonb)
  then raise exception 'employer_rule_review_incomplete'; end if;
 value:=public.ap_normalize_employer_review_rules(p_confirmed_rules);
 value_hash:=encode(extensions.digest(value::text,'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('applypack-employer-rule-request:'||p_request_id::text,0));
 select * into receipt from public.ap_employer_rule_review_receipts where request_id=p_request_id;
 if receipt.request_id is not null then
  if row(receipt.job_snapshot_id,receipt.reviewer_id,receipt.expected_basis,receipt.confirmed_rules_sha256,receipt.review_checklist,receipt.review_evidence)
   is distinct from row(p_job_snapshot_id,p_reviewer_id,p_expected_basis,value_hash,p_review_checklist,p_review_evidence) then raise exception 'employer_rule_review_receipt_conflict'; end if;
  return jsonb_build_object('receipt',to_jsonb(receipt),'replayed',true,'current',public.ap_employer_rule_receipt_current(receipt));
 end if;
 perform public.ap_lock_employer_rule_review(p_job_snapshot_id);
 lock table public.ap_job_snapshots,public.ap_job_snapshot_invalidations,public.ap_requirement_nodes,public.jobs,public.job_sources,public.job_source_runs,
  public.ap_source_authorizations,public.ap_source_authorization_heads,public.job_source_references,public.job_source_run_listings,
  public.job_source_listing_projections,public.ap_source_verifications,public.ap_manual_source_observations in share mode;
 perform 1 from public.ap_employer_submission_rules where job_snapshot_id=p_job_snapshot_id and is_current for update;
 basis:=public.ap_employer_rule_basis_value(p_job_snapshot_id);
 if basis is distinct from p_expected_basis then raise exception 'employer_rule_review_basis_changed'; end if;
 citations:=public.ap_validate_employer_rule_citations(p_job_snapshot_id,value,p_review_evidence);
 if citations is distinct from p_review_evidence then raise exception 'employer_rule_citations_not_canonical'; end if;
 checked:=clock_timestamp();
 rule_id:=public.ap_store_employer_rule_review(p_job_snapshot_id,p_reviewer_id,value,checked,(basis->>'currentRuleId')::uuid,true);
 select * into rule from public.ap_employer_submission_rules where id=rule_id;
 body:=jsonb_build_object('requestId',p_request_id,'jobSnapshotId',p_job_snapshot_id,'reviewerId',p_reviewer_id,'expectedBasis',basis,
  'confirmedRulesSha256',value_hash,'reviewChecklist',p_review_checklist,'reviewEvidence',citations,'ruleId',rule.id,'ruleContentSha256',rule.content_sha256,'checkedAt',checked);
 insert into public.ap_employer_rule_review_receipts(request_id,job_snapshot_id,reviewer_id,expected_basis,confirmed_rules,confirmed_rules_sha256,
  review_checklist,review_evidence,rule_id,rule_content_sha256,checked_at,receipt_sha256)
 values(p_request_id,p_job_snapshot_id,p_reviewer_id,basis,value,value_hash,p_review_checklist,citations,rule.id,rule.content_sha256,checked,
  encode(extensions.digest(body::text,'sha256'),'hex')) returning * into receipt;
 return jsonb_build_object('receipt',to_jsonb(receipt),'replayed',false,'current',public.ap_employer_rule_receipt_current(receipt));
end $$;

create function public.ap_employer_rule_review_receipt(p_request_id uuid,p_reviewer_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt public.ap_employer_rule_review_receipts;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 select * into receipt from public.ap_employer_rule_review_receipts where request_id=p_request_id and reviewer_id=p_reviewer_id;
 if receipt.request_id is null then return null; end if;
 return jsonb_build_object('receipt',to_jsonb(receipt),'replayed',true,'current',public.ap_employer_rule_receipt_current(receipt));
end $$;

do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_begin_material_checkout(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text,text,boolean,boolean,boolean)'::regprocedure);
 anchor:='rule_row.checked_at<now_at-make_interval(secs=>config.materials_rule_ttl_seconds)';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'employer_rule_precheckout_anchor_missing'; end if;
 definition:=replace(definition,anchor,'public.ap_employer_rule_precheckout_checked_at(rule_row.id)<now_at-make_interval(secs=>config.materials_rule_ttl_seconds)');
 execute definition;
end $$;

do $$ declare definition text; aggregate_anchor text; count_anchor text; begin
 definition:=pg_get_functiondef('public.ap_material_draft_context_sha256(uuid)'::regprocedure);
 aggregate_anchor:='(select jsonb_agg(to_jsonb(n) order by n.id) from public.ap_requirement_nodes n where job_snapshot_id=r.job_snapshot_id)';
 count_anchor:='(select count(*) from public.ap_requirement_nodes where job_snapshot_id=r.job_snapshot_id)>500';
 if (length(definition)-length(replace(definition,aggregate_anchor,'')))/length(aggregate_anchor)<>1
  or (length(definition)-length(replace(definition,count_anchor,'')))/length(count_anchor)<>1 then raise exception 'employer_rule_paid_context_anchor_missing'; end if;
 definition:=replace(definition,aggregate_anchor,'public.ap_employer_rule_matching_requirements(r.job_snapshot_id)');
 definition:=replace(definition,count_anchor,'coalesce(jsonb_array_length(public.ap_employer_rule_matching_requirements(r.job_snapshot_id)),0)>500');
 execute definition;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in('ap_normalize_employer_review_rules','ap_employer_rule_fields','ap_lock_employer_rule_review','ap_employer_rule_basis_value',
   'ap_employer_rule_receipt_current','ap_employer_rule_precheckout_checked_at','ap_store_employer_rule_review',
   'ap_employer_rule_review_basis','ap_confirm_employer_submission_rules','ap_employer_rule_review_receipt',
   'ap_guard_employer_rule_source_evidence','ap_prepare_employer_rule_source_evidence','ap_validate_employer_rule_citations','ap_employer_rule_matching_requirements') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('alter function %s set lock_timeout = %L',f.signature,'5s');
 end loop;
end $$;
grant execute on function public.ap_employer_rule_review_basis(uuid,uuid),public.ap_confirm_employer_submission_rules(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb),
 public.ap_employer_rule_review_receipt(uuid,uuid),public.ap_prepare_employer_rule_source_evidence(uuid,uuid) to service_role;

do $$ declare relation name; begin
 foreach relation in array array['ap_employer_rule_review_receipts','ap_requirement_nodes','ap_employer_submission_rules']::name[] loop
  insert into public.ap_archive_fence_relations values('public',relation) on conflict do nothing;
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||relation) and tgname='ap_archive_source_mutation') then
   execute format('create trigger ap_archive_source_mutation before insert or update or delete or truncate on public.%I for each statement execute function public.ap_guard_archive_source_mutation()',relation);
  end if;
 end loop;
end $$;
insert into public.ap_archive_fence_function_contracts
 select signature,encode(extensions.digest(pg_get_functiondef(signature::regprocedure),'sha256'),'hex') from unnest(array[
  'public.ap_normalize_employer_review_rules(jsonb)','public.ap_employer_rule_fields(public.ap_employer_submission_rules)',
  'public.ap_lock_employer_rule_review(uuid)','public.ap_employer_rule_basis_value(uuid)',
  'public.ap_employer_rule_receipt_current(public.ap_employer_rule_review_receipts)','public.ap_employer_rule_precheckout_checked_at(uuid)',
  'public.ap_employer_rule_review_basis(uuid,uuid)','public.ap_store_employer_rule_review(uuid,uuid,jsonb,timestamp with time zone,uuid,boolean,text)',
  'public.ap_confirm_employer_submission_rules(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)','public.ap_employer_rule_review_receipt(uuid,uuid)',
  'public.ap_validate_employer_rule_citations(uuid,jsonb,jsonb)',
  'public.ap_employer_rule_matching_requirements(uuid)','public.ap_material_draft_context_sha256(uuid)',
  'public.ap_guard_employer_rule_source_evidence()','public.ap_prepare_employer_rule_source_evidence(uuid,uuid)',
  'public.ap_upsert_employer_submission_rules(uuid,uuid,text,uuid[],text,text,text[],integer,integer,text,text,text,text,integer,text,text,text,jsonb,text,text,text,timestamp with time zone)',
  'public.ap_begin_material_checkout(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text,text,boolean,boolean,boolean)']) signature;
do $$ declare definition text; signatures text; begin
 definition:=pg_get_functiondef('public.ap_archive_fence_coverage_current()'::regprocedure);
 if position('count(*)=28' in definition)=0 then raise exception 'employer_rule_archive_roster_anchor_missing'; end if;
 select string_agg(quote_literal(signature),',' order by signature) into signatures from public.ap_archive_fence_function_contracts
 where signature like 'public.ap_%employer%rule%' or signature in('public.ap_material_draft_context_sha256(uuid)','public.ap_begin_material_checkout(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text,text,boolean,boolean,boolean)');
 definition:=replace(definition,'count(*)=28','count(*)=45');
 definition:=replace(definition,'''public.ap_retention_snapshot_customers(uuid)''','''public.ap_retention_snapshot_customers(uuid)'','||signatures);
 definition:=replace(definition,'''ap_unpaid_source_cleanup''','''ap_unpaid_source_cleanup'',''ap_employer_rule_review_receipts'',''ap_requirement_nodes'',''ap_employer_submission_rules''');
 execute definition;
end $$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610270104','EMPLOYER_RULE_REVIEW_CONFIRMATION',0,clock_timestamp());
create function public.ap_employer_rule_review_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610270104' and checkpoint='EMPLOYER_RULE_REVIEW_CONFIRMATION')
 and exists(select 1 from pg_class where oid=to_regclass('public.ap_employer_rule_review_receipts') and relrowsecurity)
 and exists(select 1 from pg_trigger where tgrelid='public.ap_employer_rule_review_receipts'::regclass and tgname='ap_employer_rule_review_immutable' and tgenabled='O')
 and exists(select 1 from pg_trigger where tgrelid='public.ap_requirement_nodes'::regclass and tgname='ap_employer_rule_source_evidence_immutable' and tgenabled='O'
  and tgfoid='public.ap_guard_employer_rule_source_evidence()'::regprocedure)
 and exists(select 1 from pg_index where indexrelid=to_regclass('public.ap_employer_rule_source_evidence_one_per_job') and indisunique and indisvalid)
 and public.ap_archive_fence_coverage_current()
 and not has_table_privilege('authenticated','public.ap_employer_rule_review_receipts','SELECT')
 and not has_table_privilege('service_role','public.ap_employer_rule_review_receipts','INSERT')
 and not exists(select 1 from unnest(array['ap_employer_rule_review_basis(uuid,uuid)','ap_confirm_employer_submission_rules(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)',
  'ap_employer_rule_review_receipt(uuid,uuid)','ap_prepare_employer_rule_source_evidence(uuid,uuid)']) signature where to_regprocedure('public.'||signature) is null
  or not has_function_privilege('service_role','public.'||signature,'EXECUTE') or has_function_privilege('authenticated','public.'||signature,'EXECUTE')
  or has_function_privilege('anon','public.'||signature,'EXECUTE'));
$$;
revoke all on function public.ap_employer_rule_review_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_employer_rule_review_schema_installed() to service_role;

-- Preserve every historical archive schema; append only this forward version.
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_archive_snapshot_schema_supported(text)'::regprocedure);
 anchor:='''202610260102'',''202610260103''';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'employer_rule_archive_schema_anchor_missing'; end if;
 execute replace(definition,anchor,anchor||',''202610270104''');
end $$;

do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=27 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610260103''' in definition)=0
  or position('(''202610260103'',''MATERIAL_CLARIFICATION_RESUME'')' in definition)=0
  or position('''202610260102'',''202610260103''' in definition)=0
  or position('public.ap_material_clarification_resume_schema_installed()' in definition)=0 then raise exception 'employer_rule_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=27 as installed','select count(*)=28 as installed');
 definition:=replace(definition,'(''202610260103'',''MATERIAL_CLARIFICATION_RESUME'')','(''202610260103'',''MATERIAL_CLARIFICATION_RESUME''),(''202610270104'',''EMPLOYER_RULE_REVIEW_CONFIRMATION'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610260103''','''requiredSchemaVersion'', ''202610270104''');
 definition:=replace(definition,'''202610260102'',''202610260103''','''202610260102'',''202610260103'',''202610270104''');
 definition:=replace(definition,'public.ap_material_clarification_resume_schema_installed()','public.ap_material_clarification_resume_schema_installed() and public.ap_employer_rule_review_schema_installed()');
 execute definition;
end $$;
commit;
