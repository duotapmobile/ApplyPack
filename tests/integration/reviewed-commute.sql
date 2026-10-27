-- Fictional data only. Full forward schema is applied by test-database-native.ps1.
begin;
create function pg_temp.assert_commute(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'commute assertion: %',message; end if; end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('90000000-0000-4000-8000-000000000003','authenticated','authenticated','commute-reviewer@example.invalid','{}','{}',now(),now());
update public.profiles set role='admin' where id='90000000-0000-4000-8000-000000000003';
select * from public.ap_create_anonymous_draft('90000000-0000-4000-8000-000000000004',repeat('a',64),now()+interval '1 day');
insert into public.ap_intake_snapshots(id,draft_id,version,snapshot_kind,access_email_normalized,desired_activities,avoided_activities,optional_titles,optional_industries,blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,schedules,travel,benefits,dealbreakers,salary_minimum_flexible,salary_overlap_policy,salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at)
values('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000004',1,'INITIAL','commute@example.invalid','[]','[]','[]','[]','[]','ADJACENT_OPPORTUNITIES',false,'["ONSITE"]','VA','["FULL_TIME"]','[]','{"zipCode":"23220","commuteDistanceMiles":25}','{}','[]',false,'EXCLUDE','EXCLUDE','EXCLUDE','EXCLUDE','{}','NEITHER','{}',repeat('a',64),'applypack-c14n-v1','applypack-intake-v3',now());
insert into public.ap_job_snapshots(id,origin,discovery_source,canonical_application_url,application_host_type,canonical_employer_listing_url,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_on,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256,source_authorization_id,first_seen_at,canonical_employer_domain,employer_identity_result,application_path_result,listing_activity_result,legitimacy_result,requirement_completeness,compensation_completeness,canonicalization_version,legacy_compatibility)
select '90000000-0000-4000-8000-000000000002','APPLYPACK_FOUND','manual-reviewed','https://commute.example.invalid/apply/1','EMPLOYER_HOSTED','https://commute.example.invalid/jobs/1','https://commute.example.invalid/jobs/1','Fictional Employer','Support specialist',repeat('b',64),'{"text":"Onsite at 100 Example Street"}',now(),current_date,false,now(),'{"modes":["ONSITE"]}','listing-requirements-v5',repeat('b',64),a.id,now(),'commute.example.invalid','PASS','PASS','PASS','PASS',100,0,'applypack-c14n-v1',false from public.ap_source_authorizations a where a.source_id='manual-reviewed' and a.authorization_version='source-auth-v1';
insert into public.ap_requirement_nodes(id,job_snapshot_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,human_correction_history)
values('90000000-0000-4000-8000-000000000005','90000000-0000-4000-8000-000000000002',0,'CRITERION','WORK_MODE','90000000-0000-4000-8000-000000000005','onsite-location','INFORMATIONAL','line:1',1,'listing-requirements-v5','{"kind":"WORK_MODE","modes":["ONSITE"]}','Onsite at 100 Example Street','listing-requirements-v5','[]');

create function pg_temp.commute_decision() returns jsonb language sql as $$
select jsonb_build_object('disposition','RESOLVED_PASS','result','PASS','resolutionIssue','NONE','unknownTreatment','BLOCK',
 'customerCriterionKey','customer:commute:25-miles','reviewerId','90000000-0000-4000-8000-000000000003',
 'rulesVersion','matching-rules-v3','sourceEvidenceNodeIds',jsonb_build_array('90000000-0000-4000-8000-000000000005'),
 'candidateFactIds','[]'::jsonb,'evidenceChanges',jsonb_build_array('Checked fictional route fixture.'),'resolvedAt',now(),
 'commuteEvidence',jsonb_build_object('version','reviewed-commute-v1','snapshotId','90000000-0000-4000-8000-000000000001',
 'snapshotHash',repeat('a',64),'jobSnapshotId','90000000-0000-4000-8000-000000000002','jobHash',repeat('b',64),
 'originZip','23220','maximumMiles',25,'destinationNodeId','90000000-0000-4000-8000-000000000005',
 'destinationSourceLocator','line:1','destinationSourceExcerpt','Onsite at 100 Example Street','destination','100 Example Street',
 'destinationPrecision','STREET_ADDRESS','method','DRIVE','oneWayMiles',12.4,'oneWayMinutes',28,
 'routeSourceUrl','https://maps.example.invalid/fictional-route','routeNotes','Fictional checked route from confirmed ZIP area.',
 'checkedAt',now()-interval '10 minutes','reviewedAt',now()-interval '5 minutes',
 'reviewedOriginArea',true,'reviewedExactWorksite',true,'reviewerId','90000000-0000-4000-8000-000000000003'))
$$;
create function pg_temp.commute_result(d jsonb,at_time timestamptz default now()) returns text language sql as $$
select public.ap_reviewed_commute_result('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002',d,'90000000-0000-4000-8000-000000000003',at_time)
$$;
select pg_temp.assert_commute(pg_temp.commute_result(pg_temp.commute_decision())='PASS','exact checked route passes');
select pg_temp.assert_commute(pg_temp.commute_result(jsonb_set(pg_temp.commute_decision(),'{commuteEvidence,oneWayMiles}','26'))='FAIL','over-limit route fails');
select pg_temp.assert_commute(pg_temp.commute_result(pg_temp.commute_decision(),now()+interval '24 hours')='UNKNOWN','expired route blocked');
select pg_temp.assert_commute(pg_temp.commute_result(pg_temp.commute_decision(),now()-interval '1 hour')='UNKNOWN','future route blocked');
select pg_temp.assert_commute(pg_temp.commute_result(pg_temp.commute_decision()-'commuteEvidence')='UNKNOWN','generic PASS blocked');
do $$ declare k text; d jsonb; begin
 foreach k in array array['snapshotId','snapshotHash','jobSnapshotId','jobHash','originZip','maximumMiles','reviewerId','destinationNodeId','destinationSourceExcerpt','destinationSourceLocator','destination','method','routeSourceUrl','checkedAt'] loop
  d:=jsonb_set(pg_temp.commute_decision(),array['commuteEvidence',k],'"wrong"');
  perform pg_temp.assert_commute(pg_temp.commute_result(d)='UNKNOWN','wrong binding rejected: '||k);
 end loop;
 foreach k in array array['method','oneWayMiles','oneWayMinutes','destinationPrecision','destination','routeSourceUrl','routeNotes','reviewedAt','checkedAt','reviewedOriginArea','reviewedExactWorksite'] loop
  d:=pg_temp.commute_decision() #- array['commuteEvidence',k];
  perform pg_temp.assert_commute(pg_temp.commute_result(d)='UNKNOWN','missing field rejected: '||k);
 end loop;
end $$;

-- Exercise the actual guarded write path; the reviewed destination is accepted.
insert into public.ap_human_review_records(id,draft_id,reviewer_id,snapshot_id,job_snapshot_id,review_kind,review_subject_key,rationale,catalog_version,decision)
values('90000000-0000-4000-8000-000000000006','90000000-0000-4000-8000-000000000004','90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002','CUSTOMER_CRITERION','customer:commute:25-miles','Checked fictional route and exact employer worksite.','matching-rules-v3',pg_temp.commute_decision());
do $$ begin
 begin
  insert into public.ap_human_review_records(draft_id,reviewer_id,snapshot_id,job_snapshot_id,review_kind,review_subject_key,rationale,catalog_version,decision)
  values('90000000-0000-4000-8000-000000000004','90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002','CUSTOMER_CRITERION','customer:commute:25-miles','A generic commute pass must not be accepted.','matching-rules-v3',pg_temp.commute_decision()-'commuteEvidence');
  raise exception 'generic commute review accepted';
 exception when raise_exception then if sqlerrm<>'checked_bound_commute_route_required' then raise; end if; end;
end $$;

-- Check the composite evaluation gate directly without bypassing any production triggers.
do $$ declare e public.ap_match_evaluations; begin
 e.snapshot_id:='90000000-0000-4000-8000-000000000001'; e.job_snapshot_id:='90000000-0000-4000-8000-000000000002'; e.legacy_compatibility:=false;
 e.active_root_keys:=array['customer:commute:25-miles']; e.root_results:='[{"rootKey":"customer:commute:25-miles","result":"PASS"}]';
 e.version_bundle:='{"commute":"reviewed-commute-v1","commuteReviewId":"90000000-0000-4000-8000-000000000006"}';
 perform pg_temp.assert_commute(public.ap_commute_evaluation_current(e),'current exact review authorizes evaluation');
 e.version_bundle:='{"commute":"reviewed-commute-v1"}';
 perform pg_temp.assert_commute(not public.ap_commute_evaluation_current(e),'unbound review does not authorize evaluation');
 e.version_bundle:='{"commute":"reviewed-commute-v1","commuteReviewId":"90000000-0000-4000-8000-000000000006"}';
 e.root_results:='[{"rootKey":"customer:commute:25-miles","result":"UNKNOWN"}]';
 perform pg_temp.assert_commute(not public.ap_commute_evaluation_current(e),'unknown root does not authorize evaluation');
end $$;
select pg_temp.assert_commute(not has_function_privilege('authenticated','public.ap_current_commute_evaluation_ids(uuid[])','execute'),'customer cannot read private review status');
select pg_temp.assert_commute(position('evaluation_row.root_result<>''PASS''' in pg_get_functiondef('public.ap_record_job_release_review(uuid,uuid,uuid,public.ap_staff_review_decision,text)'::regprocedure))>0,'allowed-unknown release policy was not silently widened');
select pg_temp.assert_commute(position('public.ap_commute_evaluation_current(evaluation)' in pg_get_functiondef('public.ap_persist_derived_feasibility_assessment(uuid,text,text)'::regprocedure))>0,'SQL feasibility checks commute freshness');
select pg_temp.assert_commute((select count(*)=7 from pg_trigger where tgname in ('ap_reviewed_commute_guard','ap_commute_evaluation_guard','ap_commute_selection_guard','ap_commute_release_review_guard','ap_commute_delivery_guard','ap_commute_invitation_guard','ap_commute_quote_guard')),'downstream commute guards installed');
select pg_temp.assert_commute(public.ap_matching_evidence_schema_installed(),'090 schema evidence installed');
select pg_temp.assert_commute(public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' in ('202610250090','202610250091','202610250092','202610250093','202610250094','202610250095','202610250096','202610250097','202610250098','202610250099','202610250100','202610250101','202610260102','202610260103','202610270104','202610270105'),'090 through 092 readiness floor');
alter table public.ap_quotes disable trigger ap_commute_quote_guard;
select pg_temp.assert_commute(not public.ap_matching_evidence_schema_installed(),'disabled commute guard closes readiness');
alter table public.ap_quotes enable trigger ap_commute_quote_guard;
select pg_temp.assert_commute(public.ap_matching_evidence_schema_installed(),'re-enabled guard restores schema evidence');

-- Disconnected narrow release-policy proposal: actual immutable salary policy, not guessed consent.
insert into public.ap_intake_snapshots select (jsonb_populate_record(null::public.ap_intake_snapshots,
  to_jsonb(s)||jsonb_build_object('id','90000000-0000-4000-8000-000000000007','version',2,'content_sha256',repeat('c',64),'salary_unpublished_policy','ALLOW_WITH_WARNING'))).*
from public.ap_intake_snapshots s where id='90000000-0000-4000-8000-000000000001';
do $$ declare e public.ap_match_evaluations; changed public.ap_match_evaluations; key text; issue text; begin
 e.snapshot_id:='90000000-0000-4000-8000-000000000007'; e.root_result:='UNKNOWN'; e.eligibility:='ELIGIBLE_WITH_ALLOWED_UNKNOWNS';
 e.salary_status:='UNPUBLISHED'; e.salary_disposition:='ALLOWED_WITH_WARNING'; e.unknown_treatments:=array['ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING']::public.ap_unknown_treatment[];
 e.active_root_keys:=array['universal:salary','requirement'];
 e.warnings:='[{"code":"EMPLOYER_UNKNOWN","messageKey":"Employer compensation is unpublished."}]';
 e.root_results:=jsonb_build_array(jsonb_build_object('rootKey','universal:salary','result','UNKNOWN','resolutionIssue','EMPLOYER_OMITTED',
   'unknownTreatment','ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING','consentVersion','applypack-intake-v3:'||repeat('c',64),'warning','Employer compensation is unpublished.'),
   jsonb_build_object('rootKey','requirement','result','PASS'));
 perform pg_temp.assert_commute(public.ap_release_salary_root_policy_current(e),'explicit unpublished salary consent qualifies');
 changed:=e; changed.snapshot_id:='90000000-0000-4000-8000-000000000001';
 perform pg_temp.assert_commute(not public.ap_release_salary_root_policy_current(changed),'excluded policy and wrong consent blocked');
 foreach key in array array['customer:commute:25-miles','customer:benefit:health-insurance','universal:listing-legitimacy','universal:listing-activity','universal:application-path','universal:source-authorization'] loop
   changed:=e; changed.active_root_keys[1]:=key; changed.root_results:=jsonb_set(e.root_results,'{0,rootKey}',to_jsonb(key));
   perform pg_temp.assert_commute(not public.ap_release_salary_root_policy_current(changed),'other unknown stays blocked: '||key);
 end loop;
 foreach issue in array array['CANDIDATE_MISSING','PARSER_UNCERTAIN','EVIDENCE_CONFLICT','NONE'] loop
   changed:=e; changed.root_results:=jsonb_set(e.root_results,'{0,resolutionIssue}',to_jsonb(issue));
   perform pg_temp.assert_commute(not public.ap_release_salary_root_policy_current(changed),'non-omission blocked: '||issue);
 end loop;
 changed:=e; changed.root_results:=jsonb_set(e.root_results,'{0,consentVersion}','"stale"');
 perform pg_temp.assert_commute(not public.ap_release_salary_root_policy_current(changed),'stale consent blocked');
 changed:=e; changed.root_results:=jsonb_set(e.root_results,'{0,warning}','" "');
 perform pg_temp.assert_commute(not public.ap_release_salary_root_policy_current(changed),'empty warning blocked');
 changed:=e; changed.warnings:='[]';
 perform pg_temp.assert_commute(not public.ap_release_salary_root_policy_current(changed),'missing customer-facing warning blocked');
 changed:=e; changed.root_results:=jsonb_set(e.root_results,'{0,unwaivable}','true');
 perform pg_temp.assert_commute(not public.ap_release_salary_root_policy_current(changed),'unwaivable blocked');
 changed:=e; changed.root_results:=jsonb_set(e.root_results,'{1,result}','"FAIL"');
 perform pg_temp.assert_commute(not public.ap_release_salary_root_policy_current(changed),'hard failure blocked');
 changed:=e; changed.salary_status:='PUBLISHED_NONCOMPARABLE';
 perform pg_temp.assert_commute(not public.ap_release_salary_root_policy_current(changed),'noncomparable salary stays blocked');
 changed:=e; changed.root_result:='PASS'; changed.eligibility:='ELIGIBLE'; changed.unknown_treatments:='{}';
 changed.root_results:=jsonb_set(e.root_results,'{0,result}','"PASS"');
 perform pg_temp.assert_commute(public.ap_release_salary_root_policy_current(changed),'resolved PASS still qualifies');
 changed.root_results:=changed.root_results||jsonb_build_array(changed.root_results->0);
 perform pg_temp.assert_commute(not public.ap_release_salary_root_policy_current(changed),'duplicate roots blocked');
end $$;
rollback;
