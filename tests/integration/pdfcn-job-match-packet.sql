begin;

create or replace function pg_temp.assert_true(condition boolean, message text) returns void language plpgsql as $$ begin if not condition then raise exception '%', message; end if; end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','packet-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('a1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','packet-operator@example.invalid','',now(),'{}','{}',now(),now()),
  ('a1000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-owner@example.invalid','',now(),'{}','{}',now(),now());
insert into public.profiles(id,email,display_name,role) values
  ('a1000000-0000-4000-8000-000000000001','packet-owner@example.invalid','Synthetic Owner','customer'),
  ('a1000000-0000-4000-8000-000000000002','packet-operator@example.invalid','Synthetic Operator','operator'),
  ('a1000000-0000-4000-8000-000000000003','other-owner@example.invalid','Other Owner','customer')
on conflict(id) do update set display_name=excluded.display_name,role=excluded.role;
insert into public.intakes(id,customer_id,email,direction,dealbreakers,location_preference,schedule_preference,experience_summary,resume_path,status,source_scan_status) values
  ('a5000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','packet-owner@example.invalid','Operations','None','Remote','Weekdays','Confirmed','owner/resume.pdf','ready_for_payment','clean'),
  ('a5000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','other-owner@example.invalid','Support','None','Remote','Weekdays','Confirmed','other/resume.pdf','ready_for_payment','clean');
insert into public.ap_intake_snapshots(id,intake_id,customer_id,parent_snapshot_id,version,snapshot_kind,access_email_normalized,payer_receipt_email,document_contact_email,desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,schedules,travel,benefits,dealbreakers,salary_target_cents,salary_hard_minimum_cents,salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at) values
  ('a6000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',null,1,'INITIAL','packet-owner@example.invalid',null,'packet-owner@example.invalid','[]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',6000000,5000000,false,'YEAR','BASE','PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',repeat('5',64),'applypack-c14n-v1','applypack-foundation-v1',now()),
  ('a6000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003',null,1,'INITIAL','other-owner@example.invalid',null,'other-owner@example.invalid','[]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','DC','["FULL_TIME"]','[]','{}','{}','[]',6000000,5000000,false,'YEAR','BASE','PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',repeat('6',64),'applypack-c14n-v1','applypack-foundation-v1',now());
insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,catalog_version,schema_version) values
  ('c1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','documentation','capability','{"status":"CAN_DO_NOW"}','CUSTOMER_ASSERTION','a6000000-0000-4000-8000-000000000001','packet-capability','intake control','CUSTOMER_CONFIRMED','v1','v1'),
  ('c1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000002','documentation','capability','{"status":"CAN_DO_NOW"}','CUSTOMER_ASSERTION','a6000000-0000-4000-8000-000000000002','other-capability','intake control','CUSTOMER_CONFIRMED','v1','v1'),
  ('c1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','rejected','string','{"value":"rejected"}','CUSTOMER_ASSERTION','a6000000-0000-4000-8000-000000000001','rejected-control','intake control','CUSTOMER_REJECTED','v1','v1'),
  ('c1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','superseded','string','{"value":"old"}','CUSTOMER_ASSERTION','a6000000-0000-4000-8000-000000000001','superseded-control','intake control','CUSTOMER_CONFIRMED','v1','v1');
update public.ap_candidate_facts set superseded_at=now() where id='c1000000-0000-4000-8000-000000000004';
insert into public.orders(id,customer_id,intake_id,product_kind,amount_cents,status,processing_previous_status,processing_started_at) values
  ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','job_search',2000,'delivery_processing','in_fulfillment',now());

do $$
declare i integer; job_id uuid; match_id uuid; matches jsonb := '[]'::jsonb; staged boolean;
begin
  for i in 1..10 loop
    job_id := ('b1000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid;
    match_id := ('b2000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid;
    insert into public.jobs(
      id,company,title,source_url,source_job_url,official_application_url,source_name,location_text,
      salary_text,checked_at,listing_status,is_active,work_mode,employment_type,benefits_status,
      schedule_type,remote_scope,review_status
    ) values (
      job_id,'Synthetic Employer '||i,'Synthetic Role '||i,'https://employer.example/jobs/'||i,
      'https://employer.example/jobs/'||i,'https://employer.example/jobs/'||i||'/apply',
      'Employer career site','Remote - United States','$24-$30 per hour',now(),'open',true,'remote_us_nationwide',
      'w2_full_time','provided','Weekdays','United States','pending'
    );
    matches := matches || jsonb_build_array(jsonb_build_object(
      'job_match_id',match_id,'job_id',job_id,'position',i,'fit_summary','Approved fit summary for synthetic role '||i,
      'matching_experience',jsonb_build_array('Confirmed documentation experience'),
      'primary_outcome','Deliver accurate customer documentation',
      'core_responsibilities',jsonb_build_array('Prepare accurate records'),
      'requirements',jsonb_build_array('Clear communication'),
      'hidden_job_functions','[]'::jsonb,'concerns','[]'::jsonb,
      'match_category','DIRECT','ranking_score',80,'ranking_reason_codes','[]'::jsonb,
      'criteria_checks','{"dutiesAligned":true,"experienceConfirmed":true,"levelAcceptable":true,"scheduleAcceptable":true,"locationAcceptable":true,"compensationAcceptable":true,"nonNegotiablesSatisfied":true}'::jsonb,
      'packet_strong_connections',jsonb_build_array(jsonb_build_object('claimId','job-match:'||match_id::text||':strong:0','kind','DIRECT','statement','Approved direct connection','evidenceIds',jsonb_build_array('candidate-fact:c1000000-0000-4000-8000-000000000001','job:'||job_id::text||':description'))),
      'packet_things_to_consider',jsonb_build_array(jsonb_build_object('claimId','job-match:'||match_id::text||':consideration:0','kind','GAP','statement','Approved platform gap','evidenceIds',jsonb_build_array('job:'||job_id::text||':requirements'))),
      'packet_unknown_warnings',jsonb_build_array(jsonb_build_object('claimId','job-match:'||match_id::text||':unknown:0','field','Travel requirements','status','NOT_STATED','evidenceIds',jsonb_build_array('job:'||job_id::text||':schedule_type')))
    ));
  end loop;
  staged := public.stage_search_delivery(
    'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002',matches,
    '{"criteriaCompared":true,"allListingsRechecked":true,"exactlyTenApplicationWorthy":true,"noPadding":true,"humanReleaseApproved":true}'::jsonb,
    now(),now()+interval '30 days'
  );
  if not staged then raise exception 'staging returned false'; end if;
end $$;
-- Unknown-warning completeness treats schedule and timezone as alternatives. Both
-- unknown values require an explicit warning; a known value in either field does not.
update public.jobs set schedule_type='unknown',timezone_requirement='unknown'
  where id='b1000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(not public.packet_unknown_warnings_are_complete(
  '[{"field":"Travel requirements","status":"NOT_STATED"}]','b1000000-0000-4000-8000-000000000001'
),'two unknown schedule fields bypassed the warning gate');
update public.jobs set timezone_requirement='Eastern Time' where id='b1000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(public.packet_unknown_warnings_are_complete(
  '[{"field":"Travel requirements","status":"NOT_STATED"}]','b1000000-0000-4000-8000-000000000001'
),'known timezone was masked by unknown schedule');
update public.jobs set schedule_type='Weekdays',timezone_requirement=null where id='b1000000-0000-4000-8000-000000000001';
-- Grounding references must resolve to current, approved customer facts and the exact selected job.
select pg_temp.assert_true(public.packet_claims_have_valid_provenance(
  '[{"claimId":"job-match:b2000000-0000-4000-8000-000000000001:strong:0","evidenceIds":["candidate-fact:c1000000-0000-4000-8000-000000000001","job:b1000000-0000-4000-8000-000000000001:description"]}]',
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','strong',true
),'valid evidence provenance was rejected');
select pg_temp.assert_true(not public.packet_claims_have_valid_provenance(
  '[{"claimId":"job-match:b2000000-0000-4000-8000-000000000001:strong:0","evidenceIds":["candidate-fact:c1000000-0000-4000-8000-000000000002","job:b1000000-0000-4000-8000-000000000001:description"]}]',
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','strong',true
),'cross-customer fact was accepted');
select pg_temp.assert_true(not public.packet_claims_have_valid_provenance(
  '[{"claimId":"job-match:b2000000-0000-4000-8000-000000000001:strong:0","evidenceIds":["candidate-fact:c1000000-0000-4000-8000-000000000003","job:b1000000-0000-4000-8000-000000000001:description"]}]',
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','strong',true
),'rejected fact was accepted');
select pg_temp.assert_true(not public.packet_claims_have_valid_provenance(
  '[{"claimId":"job-match:b2000000-0000-4000-8000-000000000001:strong:0","evidenceIds":["candidate-fact:c1000000-0000-4000-8000-000000000004","job:b1000000-0000-4000-8000-000000000001:description"]}]',
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','strong',true
),'superseded fact was accepted');
select pg_temp.assert_true(not public.packet_claims_have_valid_provenance(
  '[{"claimId":"job-match:b2000000-0000-4000-8000-000000000001:strong:0","evidenceIds":["candidate-fact:c1000000-0000-4000-8000-000000000099","job:b1000000-0000-4000-8000-000000000001:description"]}]',
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','strong',true
),'dangling fact was accepted');
select pg_temp.assert_true(not public.packet_claims_have_valid_provenance(
  '[{"claimId":"job-match:b2000000-0000-4000-8000-000000000001:strong:0","evidenceIds":["candidate-fact:c1000000-0000-4000-8000-000000000001","job:b1000000-0000-4000-8000-000000000002:description"]}]',
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','strong',true
),'wrong-job evidence was accepted');


select pg_temp.assert_true((select status='delivery_processing' and delivered_at is null from public.orders where id='a2000000-0000-4000-8000-000000000001'),'staging released the order before packet approval');
select pg_temp.assert_true((select count(*)=10 and count(delivered_at)=0 from public.job_matches where search_order_id='a2000000-0000-4000-8000-000000000001'),'staged matches became customer-visible');

insert into public.job_match_packet_artifacts(
  id,order_id,customer_id,content_identity,content_snapshot_sha256,content_snapshot,content_revision,
  schema_version,template_version,renderer_version,pdfcn_upstream_commit,takumi_version,requested_by,
  retention_due_at,status,storage_bucket,storage_path,customer_filename,checksum_sha256,size_bytes,rendered_at
) select
  'a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  repeat('1',64),repeat('2',64),jsonb_build_object('jobs',jsonb_agg(jsonb_build_object('jobId',m.id,'directApplicationUrl',j.official_application_url) order by m.position)),1,
  'applypack.job-match-packet.v1','applypack-job-match-packet.v1','pdfcn-test',
  '590a1f9421a7561ed94bc3dec5eae46360b28c69','0.11.0','a1000000-0000-4000-8000-000000000002',
  now()+interval '30 days','PREVIEW_READY','customer-deliveries','synthetic/packet.pdf',
  'Synthetic_Owner_ApplyPack_Job_Matches.pdf',repeat('3',64),100,now()
from public.job_matches m join public.jobs j on j.id=m.job_id where m.search_order_id='a2000000-0000-4000-8000-000000000001';

-- Final approval revalidates the live listing, not merely the staged snapshot.
do $$ begin
  begin
    update public.jobs set checked_at=now()-interval '25 hours' where id='b1000000-0000-4000-8000-000000000001';
    perform public.approve_job_match_packet_artifact('a3000000-0000-4000-8000-000000000001',repeat('3',64),'a1000000-0000-4000-8000-000000000002',now());
    raise exception 'stale listing unexpectedly approved';
  exception when others then if sqlerrm='stale listing unexpectedly approved' then raise; end if; end;
  begin
    update public.jobs set listing_status='closed' where id='b1000000-0000-4000-8000-000000000001';
    perform public.approve_job_match_packet_artifact('a3000000-0000-4000-8000-000000000001',repeat('3',64),'a1000000-0000-4000-8000-000000000002',now());
    raise exception 'closed listing unexpectedly approved';
  exception when others then if sqlerrm='closed listing unexpectedly approved' then raise; end if; end;
  begin
    update public.jobs set is_active=false where id='b1000000-0000-4000-8000-000000000001';
    perform public.approve_job_match_packet_artifact('a3000000-0000-4000-8000-000000000001',repeat('3',64),'a1000000-0000-4000-8000-000000000002',now());
    raise exception 'inactive listing unexpectedly approved';
  exception when others then if sqlerrm='inactive listing unexpectedly approved' then raise; end if; end;
  begin
    update public.jobs set rejection_reason='operator_rejected' where id='b1000000-0000-4000-8000-000000000001';
    perform public.approve_job_match_packet_artifact('a3000000-0000-4000-8000-000000000001',repeat('3',64),'a1000000-0000-4000-8000-000000000002',now());
    raise exception 'rejected listing unexpectedly approved';
  exception when others then if sqlerrm='rejected listing unexpectedly approved' then raise; end if; end;
  begin
    update public.jobs set official_application_url='https://employer.example/jobs/1/changed' where id='b1000000-0000-4000-8000-000000000001';
    perform public.approve_job_match_packet_artifact('a3000000-0000-4000-8000-000000000001',repeat('3',64),'a1000000-0000-4000-8000-000000000002',now());
    raise exception 'changed application URL unexpectedly approved';
  exception when others then if sqlerrm='changed application URL unexpectedly approved' then raise; end if; end;
end $$;
select pg_temp.assert_true((select status='PREVIEW_READY' from public.job_match_packet_artifacts where id='a3000000-0000-4000-8000-000000000001'),'failed approval mutated preview status');

select pg_temp.assert_true(public.approve_job_match_packet_artifact(
  'a3000000-0000-4000-8000-000000000001',repeat('3',64),'a1000000-0000-4000-8000-000000000002',now()
)='a3000000-0000-4000-8000-000000000001','packet approval failed');
select pg_temp.assert_true((select status='delivered' and job_match_packet_artifact_id='a3000000-0000-4000-8000-000000000001' from public.orders where id='a2000000-0000-4000-8000-000000000001'),'approved artifact was not atomically bound to delivery');
select pg_temp.assert_true((select count(*)=10 and count(delivered_at)=10 from public.job_matches where search_order_id='a2000000-0000-4000-8000-000000000001'),'exactly ten jobs were not released with approval');
select pg_temp.assert_true((select count(*)=1 from public.audit_logs where action='packet_approved' and entity_id='a3000000-0000-4000-8000-000000000001'),'atomic approval audit missing');

-- A failed regeneration cannot hide or supersede the current approved artifact.
insert into public.job_match_packet_artifacts(
  id,order_id,customer_id,content_identity,content_snapshot_sha256,content_snapshot,content_revision,
  schema_version,template_version,renderer_version,pdfcn_upstream_commit,takumi_version,requested_by,retention_due_at
) values (
  'a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  repeat('4',64),repeat('5',64),'{"jobs":[]}',1,'applypack.job-match-packet.v1','applypack-job-match-packet.v1',
  'pdfcn-test','590a1f9421a7561ed94bc3dec5eae46360b28c69','0.11.0','a1000000-0000-4000-8000-000000000002',now()+interval '30 days'
);
update public.job_match_packet_artifacts set status='FAILED',failure_code='wasm_runtime_failed' where id='a3000000-0000-4000-8000-000000000002';
select pg_temp.assert_true((select job_match_packet_artifact_id='a3000000-0000-4000-8000-000000000001' from public.orders where id='a2000000-0000-4000-8000-000000000001'),'failed regeneration changed final artifact');

-- A concurrent preview for revision 1 must become unapprovable after a correction.
insert into public.job_match_packet_artifacts(
  id,order_id,customer_id,content_identity,content_snapshot_sha256,content_snapshot,content_revision,
  schema_version,template_version,renderer_version,pdfcn_upstream_commit,takumi_version,requested_by,
  retention_due_at,status,storage_bucket,storage_path,customer_filename,checksum_sha256,size_bytes,rendered_at
) select
  'a3000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  repeat('6',64),repeat('7',64),jsonb_build_object('jobs',jsonb_agg(jsonb_build_object('jobId',m.id,'directApplicationUrl',j.official_application_url) order by m.position)),1,
  'applypack.job-match-packet.v1','applypack-job-match-packet.v1','pdfcn-test',
  '590a1f9421a7561ed94bc3dec5eae46360b28c69','0.11.0','a1000000-0000-4000-8000-000000000002',
  now()+interval '30 days','PREVIEW_READY','customer-deliveries','synthetic/stale-preview.pdf',
  'Synthetic_Owner_ApplyPack_Job_Matches.pdf',repeat('8',64),100,now()
from public.job_matches m join public.jobs j on j.id=m.job_id where m.search_order_id='a2000000-0000-4000-8000-000000000001';

-- Replacement uses the existing match identity but replaces every packet field and
-- supersedes the now-stale customer artifact.
insert into public.jobs(
  id,company,title,source_url,source_job_url,official_application_url,source_name,location_text,
  salary_text,checked_at,listing_status,is_active,work_mode,employment_type,benefits_status,schedule_type,remote_scope,review_status
) values (
  'b1000000-0000-4000-8000-000000000099','Replacement Employer','Replacement Role',
  'https://replacement.example/jobs/99','https://replacement.example/jobs/99','https://replacement.example/jobs/99/apply',
  'Employer career site','Remote','$30 per hour',now(),'open',true,'remote_us_nationwide','w2_full_time','provided','Weekdays','United States','pending'
);
insert into public.conflict_reviews(id,job_match_id,customer_id,explanation,criteria_version,status) values
  ('a4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Synthetic replacement request',1,'submitted');
select pg_temp.assert_true(public.resolve_conflict_review(
  'a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','accepted',
  'Approved replacement after current-source verification.','b1000000-0000-4000-8000-000000000099',
  jsonb_build_object(
    'fit_summary','Replacement-only fit summary','matching_experience',jsonb_build_array('Replacement evidence'),
    'primary_outcome','Replacement-only outcome','core_responsibilities',jsonb_build_array('Replacement responsibility'),
    'requirements',jsonb_build_array('Replacement requirement'),'hidden_job_functions','[]'::jsonb,'concerns','[]'::jsonb,
    'criteria_checks','{"dutiesAligned":true,"experienceConfirmed":true,"levelAcceptable":true,"scheduleAcceptable":true,"locationAcceptable":true,"compensationAcceptable":true,"nonNegotiablesSatisfied":true}'::jsonb,
    'ranking_score',90,'ranking_reason_codes','[]'::jsonb,'match_category','TRANSFERABLE',
    'packet_strong_connections',jsonb_build_array(jsonb_build_object('claimId','job-match:b2000000-0000-4000-8000-000000000001:strong:0','kind','TRANSFERABLE','statement','Replacement-only connection','evidenceIds',jsonb_build_array('candidate-fact:c1000000-0000-4000-8000-000000000001','job:b1000000-0000-4000-8000-000000000099:description'))),
    'packet_things_to_consider',jsonb_build_array(jsonb_build_object('claimId','job-match:b2000000-0000-4000-8000-000000000001:consideration:0','kind','GAP','statement','Replacement-only gap','evidenceIds',jsonb_build_array('job:b1000000-0000-4000-8000-000000000099:requirements'))),
    'packet_unknown_warnings',jsonb_build_array(jsonb_build_object('claimId','job-match:b2000000-0000-4000-8000-000000000001:unknown:0','field','Travel requirements','status','NOT_STATED','evidenceIds',jsonb_build_array('job:b1000000-0000-4000-8000-000000000099:schedule_type')))
  ),now()
),'replacement resolution failed');
select pg_temp.assert_true((select job_id='b1000000-0000-4000-8000-000000000099' and match_category='TRANSFERABLE'
  and packet_strong_connections->0->>'statement'='Replacement-only connection'
  and packet_things_to_consider->0->>'statement'='Replacement-only gap'
  and packet_unknown_warnings->0->>'field'='Travel requirements'
  from public.job_matches where id='b2000000-0000-4000-8000-000000000001'),'old packet evidence survived replacement');
select pg_temp.assert_true((select job_match_packet_artifact_id is null from public.orders where id='a2000000-0000-4000-8000-000000000001'),'replacement left stale final artifact bound');
select pg_temp.assert_true((select status='SUPERSEDED' from public.job_match_packet_artifacts where id='a3000000-0000-4000-8000-000000000001'),'replacement did not supersede stale packet');
select pg_temp.assert_true((select status='delivery_processing' and processing_previous_status='delivered' and job_match_packet_content_revision=2 from public.orders where id='a2000000-0000-4000-8000-000000000001'),'correction did not atomically advance the content revision');
select pg_temp.assert_true((select count(*)=10 and count(delivered_at)=0 from public.job_matches where search_order_id='a2000000-0000-4000-8000-000000000001'),'correction left jobs customer-visible');
select pg_temp.assert_true(not exists(select 1 from public.audit_logs where action='conflict_accepted' and details::text like '%Replacement-only%'),'customer packet text leaked into the audit log');
do $$ begin
  begin
    perform public.approve_job_match_packet_artifact(
      'a3000000-0000-4000-8000-000000000003',repeat('8',64),'a1000000-0000-4000-8000-000000000002',now()
    );
    raise exception 'stale revision artifact unexpectedly approved';
  exception when others then if sqlerrm='stale revision artifact unexpectedly approved' then raise; end if; end;
end $$;
select pg_temp.assert_true((select status='PREVIEW_READY' and content_revision=1 from public.job_match_packet_artifacts where id='a3000000-0000-4000-8000-000000000003'),'stale preview was mutated during rejected approval');


do $$ begin
  begin
    update public.job_match_packet_artifacts set content_snapshot='{"changed":true}' where id='a3000000-0000-4000-8000-000000000001';
    raise exception 'immutable content update unexpectedly succeeded';
  exception when others then
    if sqlerrm='immutable content update unexpectedly succeeded' then raise; end if;
  end;
end $$;

select pg_temp.assert_true(public.expire_job_match_packet_artifact('a3000000-0000-4000-8000-000000000001',now()+interval '31 days'),'due superseded packet did not expire');
select pg_temp.assert_true((select status='EXPIRED' from public.job_match_packet_artifacts where id='a3000000-0000-4000-8000-000000000001'),'expired packet remained accessible');
select pg_temp.assert_true((select count(*)=1 from public.audit_logs where action='packet_expired' and entity_id='a3000000-0000-4000-8000-000000000001'),'packet expiration audit missing');

select pg_temp.assert_true(not has_table_privilege('authenticated','public.job_match_packet_artifacts','select'),'customer received direct packet-table access');
select pg_temp.assert_true(not has_function_privilege('service_role','public.complete_search_delivery(uuid,uuid,jsonb,jsonb,timestamptz,timestamptz)','execute'),'legacy one-step release remains callable');

rollback;
