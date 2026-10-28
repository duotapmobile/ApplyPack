begin;
\ir employer-rule-review-fixture.sql

select pg_temp.assert_true(public.ap_employer_rule_review_schema_installed(),'104 installation contract failed');
select pg_temp.assert_true(public.ap_archive_fence_coverage_current(),'104 archive fence incomplete');
select pg_temp.assert_true(public.ap_archive_snapshot_schema_supported('202610260103') and public.ap_archive_snapshot_schema_supported('202610270104') and public.ap_archive_snapshot_schema_supported(public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'),'archive history not append-only');
create temp table employer_paid_before(kind text,body jsonb);
insert into employer_paid_before select 'rule',to_jsonb(r) from public.ap_employer_submission_rules r where id=current_setting('employer_test.rule')::uuid;
insert into employer_paid_before select 'revision',to_jsonb(r) from public.ap_material_line_revisions r where line_id=current_setting('employer_test.line')::uuid;
insert into employer_paid_before select 'line',to_jsonb(l) from public.ap_material_lines l where id=current_setting('employer_test.line')::uuid;
insert into employer_paid_before select 'snapshot',to_jsonb(s) from public.ap_job_snapshots s where id=current_setting('employer_test.job')::uuid;
insert into employer_paid_before select 'selection',to_jsonb(s) from public.job_matches s where id='b1040005-0000-4000-8000-000000000001';
create temp table employer_request(job uuid,actor uuid,request uuid,basis jsonb,rules jsonb,citations jsonb,result jsonb);

savepoint active_paid_context;
do $$ declare j public.ap_material_draft_jobs; basis jsonb; before_context text; before_requirements jsonb; prepared jsonb;
 actor uuid:=current_setting('employer_test.actor')::uuid; job uuid:=current_setting('employer_test.job')::uuid; begin
 select * into j from public.ap_material_draft_jobs where material_line_id=current_setting('employer_test.line')::uuid;
 basis:=public.ap_material_draft_rule_evidence(j.id)->'basis';
 perform public.ap_record_material_draft_listing_check(j.id,null,'b104f004-0000-4000-8000-000000000099','BEFORE_GENERATION',basis->>'ruleSha256','ACTIVE',actor);
 basis:=public.ap_material_draft_rule_evidence(j.id)->'basis';
 perform public.ap_revalidate_material_draft_rule(j.id,null,'b104f006-0000-4000-8000-000000000099',basis,
 '{"applicationAccessReviewed":true,"liveListingOpened":true,"submissionInstructionsCompared":true,"unchangedRuleConfirmed":true}',actor);
 before_context:=public.ap_material_draft_context_sha256(j.id);
 select jsonb_agg(to_jsonb(n) order by n.id) into before_requirements from public.ap_requirement_nodes n where job_snapshot_id=job;
 prepared:=public.ap_prepare_employer_rule_source_evidence(job,actor);
 perform pg_temp.assert_true(public.ap_material_draft_context_sha256(j.id)=before_context,'PREPARE changed active paid context');
 perform pg_temp.assert_true(public.ap_employer_rule_matching_requirements(job)=before_requirements,'source filter changed historical qualification rows');
 perform pg_temp.reject(format($sql$insert into public.ap_requirement_nodes select (jsonb_populate_record(null::public.ap_requirement_nodes,to_jsonb(n)||jsonb_build_object(
  'id',gen_random_uuid(),'classification_method','masquerading-required-source','requirement_strength','REQUIRED','position',2147483645))).*
  from public.ap_requirement_nodes n where id=%L; select public.ap_employer_rule_matching_requirements(%L)$sql$,prepared->>'sourceEvidenceId',job),'employer_rule_source_evidence_invalid');
 perform pg_temp.reject(format($sql$update public.ap_requirement_nodes set criterion_version='employer-instruction-source-v1' where job_snapshot_id=%L and node_kind='ALL_OF';
  select public.ap_employer_rule_matching_requirements(%L)$sql$,job,job),'employer_rule_source_evidence_invalid');
 perform pg_temp.reject(format('update public.ap_requirement_nodes set parent_id=%L where job_snapshot_id=%L and id<>%L',prepared->>'sourceEvidenceId',job,prepared->>'sourceEvidenceId'),'employer_rule_source_evidence_cannot_parent_matching');
end $$;
rollback to active_paid_context;

do $$ declare job uuid:=current_setting('employer_test.job')::uuid; actor uuid:=current_setting('employer_test.actor')::uuid;
 prepared jsonb; view jsonb; rules jsonb; citations jsonb; result jsonb; evidence uuid; request uuid:='b104f003-0000-4000-8000-000000000001';
 draft public.ap_material_draft_jobs; old_checked timestamptz;
begin
 view:=public.ap_employer_rule_review_basis(job,actor);
 perform pg_temp.assert_true(view->'sourceEvidenceId'='null'::jsonb,'GET invented source evidence');
 perform pg_temp.reject(format('select public.ap_prepare_employer_rule_source_evidence(%L,%L)',job,current_setting('employer_test.customer')),'authorized_material_reviewer_required');
 prepared:=public.ap_prepare_employer_rule_source_evidence(job,actor); evidence:=(prepared->>'sourceEvidenceId')::uuid;
 perform pg_temp.assert_true(prepared->>'created'='true','explicit preparation did not insert evidence');
 perform pg_temp.assert_true(public.ap_prepare_employer_rule_source_evidence(job,actor)->>'created'='false','preparation retry duplicated evidence');
 perform pg_temp.assert_true((select source_excerpt=(select captured_listing->>'text' from public.ap_job_snapshots where id=job)
 and parent_id is null and requirement_strength='INFORMATIONAL' and criterion_type='LISTING_APPLICATION_PATH'
 from public.ap_requirement_nodes where id=evidence),'source preparation invented or connected matching criteria');
 perform pg_temp.reject(format('update public.ap_requirement_nodes set source_excerpt=''invented'' where id=%L',evidence),'employer_rule_source_evidence_immutable');
 perform pg_temp.reject(format('delete from public.ap_requirement_nodes where id=%L',evidence),'employer_rule_source_evidence_immutable');
 select public.ap_employer_rule_fields(r),r.checked_at into rules,old_checked from public.ap_employer_submission_rules r where id=current_setting('employer_test.rule')::uuid;
 rules:=rules||jsonb_build_object('sourceEvidenceIds',jsonb_build_array(evidence),'parserVersion','ordinary-reviewed-v1');
 citations:=pg_temp.employer_citations(evidence,rules);
 view:=public.ap_employer_rule_review_basis(job,actor);
 perform pg_temp.assert_true(old_checked<clock_timestamp()-interval '1 hour','paid historical rule was not stale');
 select * into draft from public.ap_material_draft_jobs where material_line_id=current_setting('employer_test.line')::uuid;
 perform public.ap_record_material_draft_listing_check(draft.id,null,'b104f004-0000-4000-8000-000000000001','BEFORE_GENERATION',
 (public.ap_material_draft_rule_evidence(draft.id)#>>'{basis,ruleSha256}'),'ACTIVE',actor);
 perform pg_temp.reject(format('select public.ap_material_draft_context_sha256(%L)',draft.id),'material_draft_evidence_stale');
 result:=public.ap_confirm_employer_submission_rules(job,actor,request,view->'basis',rules,pg_temp.employer_checklist(),citations);
 perform pg_temp.assert_true(result->>'replayed'='false' and result->>'current'='true','fresh review did not return current receipt');
 perform pg_temp.assert_true(result#>>'{receipt,rule_id}'=current_setting('employer_test.rule'),'equivalent paid rule identity changed');
 perform pg_temp.assert_true(public.ap_employer_rule_precheckout_checked_at(current_setting('employer_test.rule')::uuid)>clock_timestamp()-interval '1 minute','review did not renew PREPURCHASE evidence');
 perform pg_temp.reject(format('select public.ap_material_draft_context_sha256(%L)',draft.id),'material_draft_evidence_stale');
 perform pg_temp.assert_true(public.ap_material_draft_rule_evidence(draft.id)->'revalidation'='null'::jsonb,'ordinary review bypassed paid092 revalidation');
 perform pg_temp.assert_true((select confirmed_rules=rules and review_evidence=citations and checked_at=(result#>>'{receipt,checked_at}')::timestamptz
 from public.ap_employer_rule_review_receipts where request_id=request),'receipt did not preserve exact rules/citations');
 insert into employer_request values(job,actor,request,view->'basis',rules,citations,result);
end $$;

-- All original paid records, deadline, delivered selection and snapshot survive.
select pg_temp.assert_true((select body from employer_paid_before where kind='rule')=to_jsonb(r),'review rewrote paid rule/source evidence') from public.ap_employer_submission_rules r where id=current_setting('employer_test.rule')::uuid;
select pg_temp.assert_true((select body from employer_paid_before where kind='revision')=to_jsonb(r),'review rewrote paid revision') from public.ap_material_line_revisions r where line_id=current_setting('employer_test.line')::uuid;
select pg_temp.assert_true((select body from employer_paid_before where kind='line')=to_jsonb(r),'review changed paid deadline or fulfillment') from public.ap_material_lines r where id=current_setting('employer_test.line')::uuid;
select pg_temp.assert_true((select body from employer_paid_before where kind='snapshot')=to_jsonb(r),'preparation rewrote captured snapshot') from public.ap_job_snapshots r where id=current_setting('employer_test.job')::uuid;
select pg_temp.assert_true((select body from employer_paid_before where kind='selection')=to_jsonb(r),'preparation changed delivered selection') from public.job_matches r where id='b1040005-0000-4000-8000-000000000001';

do $$ declare r employer_request; replay jsonb; malformed jsonb; changed jsonb; field text; begin
 select * into r from employer_request;
 replay:=public.ap_confirm_employer_submission_rules(r.job,r.actor,r.request,r.basis,r.rules,pg_temp.employer_checklist(),r.citations);
 perform pg_temp.assert_true(replay->>'replayed'='true' and replay->'receipt'=r.result->'receipt','lost-response replay changed immutable receipt');
 perform pg_temp.assert_true(public.ap_employer_rule_review_receipt(r.request,r.actor)->'receipt'=r.result->'receipt','CHECK did not return original receipt');
 perform pg_temp.assert_true((select count(*)=1 from public.ap_employer_rule_review_receipts where request_id=r.request),'retry duplicated receipt');
 perform pg_temp.assert_true(not public.ap_employer_rule_receipt_current(jsonb_populate_record(null::public.ap_employer_rule_review_receipts,
  (r.result->'receipt')||jsonb_build_object('checked_at',clock_timestamp()-interval '2 hours'))),'stale receipt renewed eligibility');
 perform pg_temp.assert_true(not public.ap_employer_rule_receipt_current(jsonb_populate_record(null::public.ap_employer_rule_review_receipts,
  (r.result->'receipt')||jsonb_build_object('checked_at',clock_timestamp()+interval '1 hour'))),'future receipt renewed eligibility');
 perform pg_temp.reject(format('update public.ap_employer_rule_review_receipts set checked_at=clock_timestamp() where request_id=%L',r.request),'immutable_record');
 perform pg_temp.reject(format('delete from public.ap_employer_rule_review_receipts where request_id=%L',r.request),'immutable_record');
 perform pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',r.job,r.actor,r.request,r.basis,
 r.rules||'{"parserVersion":"changed-parser"}',pg_temp.employer_checklist(),r.citations),'employer_rule_review_receipt_conflict');
 perform pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',r.job,r.actor,gen_random_uuid(),
 r.basis||jsonb_build_object('jobContentSha256',repeat('f',64)),r.rules,pg_temp.employer_checklist(),r.citations),'employer_rule_review_basis_changed');
 perform pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',r.job,r.actor,gen_random_uuid(),r.basis,
 r.rules,pg_temp.employer_checklist()||'{"questionsReviewed":false}',r.citations),'employer_rule_review_incomplete');
 foreach field in array array['resumeRequirement','coverLetterRequirement','submissionChannel','referenceTiming','allowedFormats','sourceEvidenceIds','applicationQuestions'] loop
 perform pg_temp.reject(format('select public.ap_normalize_employer_review_rules(%L)',r.rules||jsonb_build_object(field,null)),'employer_rule_fields_invalid'); end loop;
 perform pg_temp.reject(format('select public.ap_normalize_employer_review_rules(%L)',r.rules||jsonb_build_object('checkedAt',clock_timestamp())),'employer_rule_fields_invalid');
 malformed:=jsonb_set(r.citations,'{citations,0,quoteSha256}',to_jsonb(repeat('f',64)));
 perform pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',r.job,r.actor,gen_random_uuid(),r.basis,r.rules,pg_temp.employer_checklist(),malformed),'employer_rule_citation_quote_mismatch');
 malformed:=r.citations||'{"citations":[]}';
 perform pg_temp.reject(format('select public.ap_validate_employer_rule_citations(%L,%L,%L)',r.job,r.rules,malformed),'employer_rule_citations_incomplete');
 malformed:=jsonb_set(r.citations,'{citations,0,startByte}','-1');
 perform pg_temp.reject(format('select public.ap_validate_employer_rule_citations(%L,%L,%L)',r.job,r.rules,malformed),'employer_rule_citations_invalid');
 malformed:=jsonb_set(r.citations,'{citations,0,field}','"unsupported"');
 perform pg_temp.reject(format('select public.ap_validate_employer_rule_citations(%L,%L,%L)',r.job,r.rules,malformed),'employer_rule_citations_invalid');
 malformed:=r.citations||jsonb_build_object('sourceEvidenceId',gen_random_uuid());
 perform pg_temp.reject(format('select public.ap_validate_employer_rule_citations(%L,%L,%L)',r.job,r.rules,malformed),'employer_rule_citation_source_mismatch');
 changed:=r.rules||'{"resumePageLimit":2}';
 perform pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',r.job,r.actor,gen_random_uuid(),r.basis,changed,pg_temp.employer_checklist(),r.citations),'employer_rule_paid_binding_requires_explicit_change');
 perform pg_temp.reject(format('select public.ap_store_employer_rule_review(%L,%L,%L,clock_timestamp(),null,false)',r.job,r.actor,changed),'employer_rule_guarded_confirmation_required');
end $$;

savepoint other_reviewer;
update public.profiles set role='operator' where id='b1040000-0000-4000-8000-000000000002';
select pg_temp.assert_true(public.ap_employer_rule_review_receipt(request,'b1040000-0000-4000-8000-000000000002') is null,'CHECK leaked another reviewer request') from employer_request;
select pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',job,'b1040000-0000-4000-8000-000000000002',request,basis,rules,pg_temp.employer_checklist(),citations),'employer_rule_review_receipt_conflict') from employer_request;
rollback to other_reviewer;

savepoint permission_lost;
update public.job_sources set is_active=false where id='b104-manual-reviewed';
select pg_temp.reject(format('select public.ap_employer_rule_review_basis(%L,%L)',job,actor),'employer_rule_current_source_required') from employer_request;
select pg_temp.assert_true(public.ap_employer_rule_review_receipt(request,actor)->>'current'='false','revoked source retained fresh eligibility') from employer_request;
select pg_temp.assert_true(public.ap_confirm_employer_submission_rules(job,actor,request,basis,rules,pg_temp.employer_checklist(),citations)->'receipt'=result->'receipt','revoked-source replay rewrote historical receipt') from employer_request;
select pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',job,actor,gen_random_uuid(),basis,rules,pg_temp.employer_checklist(),citations),'employer_rule_current_source_required') from employer_request;
rollback to permission_lost;

-- New unbound rules may change only with a fresh basis; original receipts remain readable.
do $$ declare job uuid:=pg_temp.new_employer_job(2); actor uuid:=current_setting('employer_test.actor')::uuid; prepared jsonb; rules jsonb; citations jsonb; basis jsonb;
 first jsonb; second jsonb; request uuid:=gen_random_uuid(); begin
 prepared:=public.ap_prepare_employer_rule_source_evidence(job,actor); basis:=prepared->'basis';
 select r.rules||jsonb_build_object('sourceEvidenceIds',jsonb_build_array(prepared->>'sourceEvidenceId')) into rules from employer_request r;
 citations:=pg_temp.employer_citations((prepared->>'sourceEvidenceId')::uuid,rules);
 first:=public.ap_confirm_employer_submission_rules(job,actor,request,basis,rules,pg_temp.employer_checklist(),citations);
 perform pg_temp.assert_true(first->>'current'='true','new rule confirmation failed');
 perform pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',job,actor,gen_random_uuid(),basis,rules,pg_temp.employer_checklist(),citations),'employer_rule_review_basis_changed');
 basis:=public.ap_employer_rule_review_basis(job,actor)->'basis';
 second:=public.ap_confirm_employer_submission_rules(job,actor,gen_random_uuid(),basis,rules||'{"resumePageLimit":2}',pg_temp.employer_checklist(),citations);
 perform pg_temp.assert_true(first#>>'{receipt,rule_id}'<>second#>>'{receipt,rule_id}','changed unbound rule did not create successor');
 perform pg_temp.assert_true(public.ap_employer_rule_review_receipt(request,actor)->>'current'='false','superseded receipt still current');
 perform pg_temp.assert_true(public.ap_employer_rule_review_receipt(request,actor)->'receipt'=first->'receipt','CHECK rebuilt original review from changed source');
end $$;

savepoint archive_review;
insert into public.ap_archive_retention_runs(id,release_sha) values('b104f005-0000-4000-8000-000000000001',repeat('a',40));
select pg_temp.reject(format('select public.ap_prepare_employer_rule_source_evidence(%L,%L)',job,actor),'archive_maintenance_retry_required') from employer_request;
select pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',job,actor,gen_random_uuid(),basis,rules,pg_temp.employer_checklist(),citations),'archive_maintenance_retry_required') from employer_request;
rollback to archive_review;
select pg_temp.assert_true(not has_function_privilege('service_role','public.ap_store_employer_rule_review(uuid,uuid,jsonb,timestamptz,uuid,boolean,text)','EXECUTE'),'private store callable');
select pg_temp.assert_true(not has_table_privilege('service_role','public.ap_employer_rule_review_receipts','INSERT'),'direct receipt insert granted');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.ap_confirm_employer_submission_rules(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE'),'customer can confirm rules');
rollback;
select 'employer rule review confirmation passed';
