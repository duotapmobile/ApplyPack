begin;

create function pg_temp.assert_true(value boolean, failure_message text)
returns void language plpgsql as $$
begin
  if value is not true then raise exception '%', failure_message; end if;
end;
$$;

create function pg_temp.chunk4_release_members()
returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
    'position',g,
    'evaluationId',('b4500000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
    'jobId',('b4000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
    'fitSummary','A reviewed evidence-based fit summary for this current role.',
    'matchingExperience',jsonb_build_array('Operations coordination'),
    'primaryOutcome','Coordinate accurate operations and customer support.',
    'coreResponsibilities',jsonb_build_array('Coordinate operations'),
    'requirements',jsonb_build_array('Reviewed current listing evidence'),
    'warnings','[]'::jsonb,
    'criteriaChecks',jsonb_build_object('applicationWorthy',true),
    'rankingReasonCodes',jsonb_build_array('CURRENT_VERIFIED_LISTING'),
    'releaseExplanation',jsonb_build_object(
      'whatJobInvolves','Coordinate current operations and support customers.',
      'whyMadeList','The reviewed criteria and current listing evidence passed.',
      'howExperienceConnects','The candidate evidence supports operations coordination.',
      'whatMayBeNew','The employer-specific workflow may be new.',
      'whatToKnow','Confirm the current employer listing before applying.'
    )
  ) order by g) from generate_series(1,10) g
$$;

create function pg_temp.assert_chunk4_release_rejected(expected_error text, members jsonb)
returns void language plpgsql as $$
begin
  begin
    perform public.ap_commit_exact_ten_release(
      'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',
      'a4a00000-0000-4000-8000-000000000001',members,
      '{"criteriaCompared":true,"allListingsRechecked":true,"exactlyTenApplicationWorthy":true,"noPadding":true,"humanReleaseApproved":true}'::jsonb,
      'The reviewer checked every exact release condition and source.',
      'a4b00000-0000-4000-8000-000000000001','a4900000-0000-4000-8000-000000000010'
    );
  exception when raise_exception then
    if sqlerrm=expected_error then return; end if;
    raise;
  end;
  raise exception 'release_was_not_rejected:%',expected_error;
end;
$$;

select pg_temp.assert_true(
  exists(select 1 from public.ap_migration_checkpoints where migration_id='202609060030' and checkpoint='CHUNK4_COMMERCE_RELEASE_V1'),
  'chunk4 checkpoint missing'
);
select pg_temp.assert_true(to_regprocedure('public.ap_begin_search_checkout(uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)') is not null, 'atomic checkout function missing');
select pg_temp.assert_true(to_regprocedure('public.ap_apply_verified_search_payment(text,text,text,timestamptz,timestamptz,text,text,text,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)') is not null, 'atomic verified-payment function missing');
select pg_temp.assert_true(to_regprocedure('public.ap_commit_exact_ten_release(uuid,uuid,uuid,jsonb,jsonb,text,uuid,uuid)') is not null, 'exact-ten release function missing');
select pg_temp.assert_true(to_regprocedure('public.ap_renew_scheduled_job_lease(uuid,text)') is not null, 'scheduled lease renewal missing');
select pg_temp.assert_true(to_regprocedure('public.ap_renew_outbox_lease(uuid,text)') is not null, 'outbox lease renewal missing');
select pg_temp.assert_true(to_regprocedure('public.ap_queue_material_line_refund(uuid,uuid,uuid,text)') is not null, 'material-line refund function missing');
select pg_temp.assert_true(not has_table_privilege('anon','public.ap_order_access_capabilities','select'), 'anonymous access capabilities exposed');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ap_order_access_capabilities','select'), 'customer access capabilities exposed');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ap_staff_queue','select'), 'staff queue exposed to customers');

update public.ap_commerce_configuration set
  tax_configuration_approved=true,
  tax_approval_reference='rollback-only-tax-approval',
  pricing_version='search-price-v1',
  tax_version='tax-inclusive-v1',
  terms_version='terms-v1',
  privacy_version='privacy-v1',
  canonical_site_url='https://applypack.work',
  access_callback_url='https://applypack.work/auth/callback',
  provider_idempotent_email_approved=true,
  provider_email_approval_reference='rollback-only-integration-fixture',
  payment_provider='stripe',
  payment_api_version='2026-08-27.basil',
  immediate_payment_methods=array['card'],
  release_verification_ttl_seconds=3600
where singleton;
select pg_temp.assert_true((select count(*)=1 from public.ap_commerce_configuration where singleton and checkout_enabled), 'commerce singleton unavailable');

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('14000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chunk4-customer@example.invalid','',now(),'{}','{}',now(),now()),
  ('14000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chunk4-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('14000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chunk4-reviewer@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='operator' where id='14000000-0000-4000-8000-000000000003';

select * from public.ap_create_anonymous_draft(
  '34000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day'
);
select * from public.ap_register_anonymous_document(
  '34000000-0000-4000-8000-000000000001',repeat('a',64),1,
  '44000000-0000-4000-8000-000000000001','RESUME','resume.pdf',
  'anonymous/34000000-0000-4000-8000-000000000001/resume/v1.pdf',128,
  'application/pdf','application/pdf',repeat('1',64)
);
update public.ap_document_versions set processing_state='SCANNING'
where id='44000000-0000-4000-8000-000000000001';
update public.ap_document_versions set processing_state='EXTRACTING'
where id='44000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(public.ap_apply_document_pipeline_result(
  '44000000-0000-4000-8000-000000000001',1,'READY','CLEAN','SUCCEEDED','CLEAR','CLEAR',
  'fixture-parser','{"pageLimit":20}','fixture-model-policy',null
), 'ready resume pipeline fixture failed');

insert into public.ap_sensitive_payloads(
  id,draft_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,
  content_sha256,kms_key_identity,kms_key_version,encryption_context_hash
) values(
  '5a000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001',
  decode('0102','hex'),'AES-256-GCM',decode(repeat('11',32),'hex'),decode(repeat('22',12),'hex'),
  decode(repeat('33',16),'hex'),repeat('2',64),'fixture-kms','1',repeat('3',64)
);

insert into public.ap_intake_snapshots(
  id,draft_id,version,snapshot_kind,access_email_normalized,payer_receipt_email,document_contact_email,
  desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,
  blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,
  schedules,travel,benefits,dealbreakers,salary_target_cents,salary_hard_minimum_cents,
  salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,
  salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,
  targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at
) values(
  '54000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001',1,'INITIAL',
  'chunk4-customer@example.invalid',null,'chunk4-customer@example.invalid',
  '["COORDINATING_PROJECTS"]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,
  '["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',7000000,6000000,false,'YEAR','BASE',
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',
  repeat('4',64),'applypack-c14n-v1','applypack-intake-v3',clock_timestamp()-interval '2 minutes'
);
update public.ap_anonymous_drafts set
  state='COMPLETE',finalized_snapshot_id='54000000-0000-4000-8000-000000000001',
  access_email_normalized='chunk4-customer@example.invalid',current_step=3
where id='34000000-0000-4000-8000-000000000001';

insert into public.ap_inventory_versions(
  id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256
) values(
  '74000000-0000-4000-8000-000000000001',clock_timestamp(),'source-auth-v1',
  'responsibility-retrieval-v1','listing-requirements-v3',repeat('5',64)
);
insert into public.ap_feasibility_source_configurations(
  id,source_authorization_id,config_version,pagination_bound,lookback_bound,result_bound,
  release_verification_ttl,parser_version,cutoff_version,content_sha256,approved_by_role,approved_at
)
select
  '62000000-0000-4000-8000-000000000041',source_auth.id,'chunk4-manual-v1',1,
  interval '30 days',50,interval '1 hour','listing-requirements-v3','current-v1',
  repeat('5',64),'operator',clock_timestamp()
from public.ap_source_authorizations source_auth
where source_auth.source_id='manual-reviewed' and source_auth.authorization_version='source-auth-v1';
insert into public.ap_feasibility_coverage_plans(
  id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256
) values(
  '73000000-0000-4000-8000-000000000041','54000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001','feasibility-v1',
  '{"requiredFamilyIds":["responsibility-family"],"breadth":"ADJACENT_OPPORTUNITIES"}',
  'REQUIRED',repeat('6',64)
);
insert into public.ap_feasibility_coverage_cells(
  plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,
  result_bound,execution_path,terminal_outcome,cursor_or_stop_reason,result_count,parser_result,
  started_at,completed_at,query_family_id,source_authorization_id,configuration_id,
  configured_bound_satisfied,normalized_and_deduplicated,manual_checklist_complete
)
select
  '73000000-0000-4000-8000-000000000041','manual-reviewed','AUTHORIZED_MANUAL_ONLY',
  repeat('6',64),1,interval '30 days',50,'MANUAL','SUCCEEDED_WITH_RESULTS',
  'fixture-manual-review-complete',10,'{"status":"COMPLETE"}',clock_timestamp(),clock_timestamp(),
  'responsibility-family',source_auth.id,'62000000-0000-4000-8000-000000000041',
  true,true,true
from public.ap_source_authorizations source_auth
where source_auth.source_id='manual-reviewed' and source_auth.authorization_version='source-auth-v1';
insert into public.ap_feasibility_assessments(
  id,snapshot_id,coverage_plan_id,state,outcome,resolution_blocker,preliminarily_deliverable_count,
  reviewable_count,excluded_count,reasons,primary_reason,rules_version,expires_at
) values(
  '64000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000041','COMPLETE','LIKELY','NONE',10,0,0,'{}',null,
  'feasibility-worker-v1',clock_timestamp()+interval '1 hour'
);
insert into public.ap_feasibility_requests(
  id,draft_id,snapshot_id,state,request_version,idempotency_key,completed_assessment_id
) values(
  '63000000-0000-4000-8000-000000000041','34000000-0000-4000-8000-000000000001',
  '54000000-0000-4000-8000-000000000001','COMPLETED','feasibility-v1','chunk4-feasibility',
  '64000000-0000-4000-8000-000000000001'
);

select public.ap_record_snapshot_legal_acceptance(
  '34000000-0000-4000-8000-000000000001',repeat('a',64),
  '54000000-0000-4000-8000-000000000001','terms-v1','privacy-v1',repeat('7',64)
);
select pg_temp.assert_true(
  (public.ap_read_current_feasibility('34000000-0000-4000-8000-000000000001',repeat('a',64))->>'checkoutEligible')='false',
  'checkout became eligible without capacity'
);

insert into public.ap_capacity_pools(id,resource,enabled,configuration_version)
values('a4000000-0000-4000-8000-000000000001','SEARCH',true,'chunk4-fixture-v1');
insert into public.ap_capacity_buckets(id,pool_id,starts_at,ends_at,total_units,staffing_version)
values(
  'a4100000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 days',3,'fixture-staffing-v1'
);
select pg_temp.assert_true(
  (public.ap_read_current_feasibility('34000000-0000-4000-8000-000000000001',repeat('a',64))->>'checkoutEligible')='true',
  'current likely feasibility with capacity was not checkout eligible'
);

do $$
declare prepared record;
begin
  select * into prepared from public.ap_begin_search_checkout(
    '34000000-0000-4000-8000-000000000001',repeat('a',64),
    '54000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',
    'chunk4-search-request','a4200000-0000-4000-8000-000000000001',repeat('8',64),
    'a4300000-0000-4000-8000-000000000001','search-checkout/a4300000-0000-4000-8000-000000000001',
    'a4400000-0000-4000-8000-000000000001','a4500000-0000-4000-8000-000000000001',
    repeat('9',64),repeat('b',64),'5a000000-0000-4000-8000-000000000001'
  );
  perform pg_temp.assert_true(prepared.quote_id='a4200000-0000-4000-8000-000000000001', 'quote identity mismatch');
  perform pg_temp.assert_true(prepared.access_email='chunk4-customer@example.invalid', 'immutable access email mismatch');
  perform pg_temp.assert_true(prepared.lease_expires_at between clock_timestamp()+interval '4 minutes 50 seconds' and clock_timestamp()+interval '5 minutes 1 second', 'provisional lease is not five minutes');
  perform pg_temp.assert_true(prepared.reservation_expires_at between clock_timestamp()+interval '29 minutes 59 seconds' and clock_timestamp()+interval '30 minutes 6 seconds', 'provider reservation boundary is not thirty minutes');
end;
$$;

select * from public.ap_begin_search_checkout(
  '34000000-0000-4000-8000-000000000001',repeat('a',64),
  '54000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',
  'chunk4-search-request','a4200000-0000-4000-8000-000000000001',repeat('8',64),
  'a4300000-0000-4000-8000-000000000001','search-checkout/a4300000-0000-4000-8000-000000000001',
  'a4400000-0000-4000-8000-000000000001','a4500000-0000-4000-8000-000000000001',
  repeat('9',64),repeat('b',64),'5a000000-0000-4000-8000-000000000001'
);
select pg_temp.assert_true((select count(*)=1 from public.ap_quotes where idempotency_key='chunk4-search-request'), 'checkout replay duplicated quote');
select pg_temp.assert_true((select lifecycle='RESERVED' and debit_disposition='HELD' from public.ap_capacity_allocations where request_key='search-checkout:chunk4-search-request'), 'checkout did not atomically hold capacity');

savepoint before_ambiguous_checkout_compensation;
select pg_temp.assert_true(not public.ap_compensate_search_checkout(
  'a4400000-0000-4000-8000-000000000001','LOCAL_PROMOTION_FAILED_RECONCILIATION_REQUIRED',null
), 'ambiguous provider outcome was incorrectly treated as compensated');
select pg_temp.assert_true((select state='NONE' from public.ap_checkout_attempts where id='a4400000-0000-4000-8000-000000000001'), 'ambiguous provider outcome closed the provisional checkout');
select pg_temp.assert_true((select lifecycle='RESERVED' and debit_disposition='HELD' from public.ap_capacity_allocations where request_key='search-checkout:chunk4-search-request'), 'ambiguous provider outcome returned capacity before reconciliation');
select pg_temp.assert_true((select state='CREATING' and reconciliation_state='REQUIRED' from public.ap_external_commands where id='a4300000-0000-4000-8000-000000000001'), 'ambiguous provider command did not remain reconcilable');
rollback to savepoint before_ambiguous_checkout_compensation;

savepoint before_confirmed_checkout_compensation;
select pg_temp.assert_true(public.ap_compensate_search_checkout(
  'a4400000-0000-4000-8000-000000000001','LOCAL_PROMOTION_FAILED_PROVIDER_EXPIRED','cs_confirmed_expired'
), 'confirmed provider cancellation did not compensate');
select pg_temp.assert_true((select state='NONE' and invalidated_at is not null
  and provider_checkout_session_id='cs_confirmed_expired' from public.ap_checkout_attempts
  where id='a4400000-0000-4000-8000-000000000001'),
  'confirmed compensation did not terminally invalidate the unexposed checkout');
select pg_temp.assert_true((select lifecycle='RELEASED' and debit_disposition='RETURNED' from public.ap_capacity_allocations where request_key='search-checkout:chunk4-search-request'), 'confirmed compensation did not return never-consumed capacity');
rollback to savepoint before_confirmed_checkout_compensation;

do $$ begin
  perform public.ap_reserve_capacity(
    '14000000-0000-4000-8000-000000000001','SEARCH',3,'chunk4-over-capacity',
    clock_timestamp()+interval '5 minutes','[]',null
  );
  raise exception 'spent_or_held_capacity_was_oversubscribed';
exception when raise_exception then
  if sqlerrm='spent_or_held_capacity_was_oversubscribed' then raise; end if;
  if sqlerrm<>'capacity_unavailable' then raise; end if;
end $$;

insert into public.jobs(
  id,company,title,source_url,location_text,salary_text,checked_at,listing_status,
  official_application_url,source_job_url,normalized_source_url,external_job_id,description,
  employment_type,w2_or_contractor,work_mode,pay_model,posted_at,last_verified_at,
  source_freshness_status,is_active,review_status,reviewed_by,reviewed_at
)
select
  ('b4000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  'Fixture Employer '||g,'Operations Specialist '||g,
  'https://employer'||g||'.example/jobs/'||g,'Remote - United States','$70,000 annually',clock_timestamp(),
  'open','https://employer'||g||'.example/apply/'||g,'https://employer'||g||'.example/jobs/'||g,
  'https://employer'||g||'.example/jobs/'||g,'REQ-'||g,
  'Current reviewed operations role with an employer-hosted application path.','w2_full_time','w2',
  'remote_us_nationwide','salary',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 minute',
  'fresh',true,'approved','14000000-0000-4000-8000-000000000003',clock_timestamp()
from generate_series(1,10) g;

with current_source as (
  select id from public.ap_source_authorizations
  where source_id='manual-reviewed' and state='AUTHORIZED_MANUAL_ONLY'
  order by created_at desc,authorization_version desc limit 1
)
insert into public.ap_job_snapshots(
  id,legacy_job_id,origin,discovery_source,external_job_id,canonical_application_url,
  application_host_type,canonical_employer_listing_url,source_url,company,exact_title,
  normalized_fingerprint,captured_listing,retrieved_at,posted_on,posted_date_unknown,
  live_verified_at,compensation_text,compensation_source,location_and_work_mode,parser_version,
  content_sha256,source_authorization_id,first_seen_at,canonical_employer_domain,
  employer_identity_result,application_path_result,listing_activity_result,material_restrictions,
  fraud_signals,legitimacy_result,requirement_completeness,compensation_completeness,
  canonicalization_version,legacy_compatibility
)
select
  ('b4100000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  ('b4000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  'APPLYPACK_FOUND','manual-reviewed','REQ-'||g,
  'https://employer'||g||'.example/apply/'||g,'EMPLOYER_HOSTED',
  'https://employer'||g||'.example/jobs/'||g,'https://employer'||g||'.example/jobs/'||g,
  'Fixture Employer '||g,'Operations Specialist '||g,
  encode(extensions.digest(convert_to('fixture-job-'||g,'UTF8'),'sha256'),'hex'),
  jsonb_build_object('description','Current reviewed operations role '||g),
  clock_timestamp(),current_date,false,clock_timestamp()-interval '1 minute','$70,000 annually','EMPLOYER_LISTING',
  '{"mode":"REMOTE","location":"United States"}','listing-requirements-v3',
  encode(extensions.digest(convert_to('fixture-content-'||g,'UTF8'),'sha256'),'hex'),
  current_source.id,clock_timestamp()-interval '1 day','employer'||g||'.example',
  'PASS','PASS','PASS','{}','{}','PASS',100,100,'applypack-c14n-v1',false
from generate_series(1,10) g cross join current_source;

insert into public.ap_inventory_members(
  id,inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication
)
select
  ('b4200000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  '74000000-0000-4000-8000-000000000001',
  ('b4100000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  'application-url|https://employer'||g||'.example/apply/'||g,true
from generate_series(1,10) g;

insert into public.ap_requirement_nodes(
  id,job_snapshot_id,parent_id,position,node_kind,classification_method,human_correction_history
)
select
  ('b4300000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  ('b4100000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  null,0,'ALL_OF','listing-requirements-v3','[]'
from generate_series(1,10) g;
insert into public.ap_requirement_nodes(
  id,job_snapshot_id,parent_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,
  requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,
  classification_method,human_correction_history
)
select
  ('b4400000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  ('b4100000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  ('b4300000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  0,'CRITERION','RESPONSIBILITY',
  ('b4400000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  'responsibility.coordinate-operations-'||g,'REQUIRED','description:1',1,
  'listing-requirements-v3','{"kind":"RESPONSIBILITY"}',
  'Coordinate current operations and provide accurate customer support.',
  'listing-requirements-v3','[]'
from generate_series(1,10) g;

insert into public.ap_match_evaluations(
  id,customer_id,snapshot_id,job_snapshot_id,inventory_member_id,inventory_version_id,
  eligibility,root_result,leaf_results,resolution_issues,unknown_treatments,satisfaction_paths,
  categorical_evidence_sufficient,fit_score,fit_components,evidence_confidence,confidence_components,
  salary_status,salary_disposition,soft_preferences,application_readiness,presentation_risk,
  presentation_risk_reasons,warnings,candidate_fact_ids,job_evidence,version_bundle,
  active_root_keys,root_results,calculation_input_sha256,calculation_version,usefulness_result,
  preference_alignment,confidence_label,base_rank,rank_explanation,selector_explanation,
  legacy_compatibility,explanation_evidence
)
select
  ('b4500000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  '14000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',
  ('b4100000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  ('b4200000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  '74000000-0000-4000-8000-000000000001','ELIGIBLE','PASS','[]','{}','{}','[]',true,
  95-g,'[]',90,'{}','PUBLISHED_MEETS_MINIMUM','PASS','{}','READY','LOW','[]','[]','{}','[]',
  jsonb_build_object(
    'matching','matching-rules-v3',
    'parser','listing-requirements-v3',
    'catalog','matching-rules-v3',
    'criteria','applypack-intake-v3',
    'selector','bounded-diversity-v2',
    'jobSnapshot',encode(extensions.digest(convert_to('fixture-content-'||g,'UTF8'),'sha256'),'hex'),
    'sourceAuthorization','source-auth-v1'
  ),
  array['hard-root-'||g],jsonb_build_array(jsonb_build_object('rootKey','hard-root-'||g,'result','PASS')),
  encode(extensions.digest(convert_to('evaluation-'||g,'UTF8'),'sha256'),'hex'),
  'matching-rules-v3','PASS',0.8,'HIGH',g,
  '{"state":"AWAITING_SELECTION_RUN"}','{"state":"AWAITING_SELECTION_RUN"}',false,
  jsonb_build_object(
    'whatJobInvolves',jsonb_build_object('sourceEvidenceNodeIds',jsonb_build_array(('b4400000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid::text)),
    'whyMadeList',jsonb_build_object('sourceEvidenceNodeIds',jsonb_build_array(('b4400000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid::text)),
    'howExperienceConnects',jsonb_build_object('sourceEvidenceNodeIds',jsonb_build_array(('b4400000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid::text)),
    'whatMayBeNew',jsonb_build_object('sourceEvidenceNodeIds',jsonb_build_array(('b4400000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid::text)),
    'whatToKnow',jsonb_build_object('sourceEvidenceNodeIds',jsonb_build_array(('b4400000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid::text))
  )
from generate_series(1,10) g;

select pg_temp.assert_true(public.ap_promote_search_checkout(
  'a4400000-0000-4000-8000-000000000001','cs_chunk4_fixture',
  date_trunc('second',clock_timestamp())+interval '30 minutes'
), 'checkout promotion failed');
select pg_temp.assert_true((select state='OPEN' and promoted_at is not null from public.ap_checkout_attempts where id='a4400000-0000-4000-8000-000000000001'), 'checkout did not become open');
select pg_temp.assert_true((select state='LOCKED_TO_CHECKOUT' from public.ap_anonymous_drafts where id='34000000-0000-4000-8000-000000000001'), 'draft was not locked to checkout');

savepoint before_unsettled_completed_event;
do $$
declare result_value jsonb;
begin
  result_value:=public.ap_apply_verified_search_payment(
    'evt_chunk4_unsettled','checkout.session.completed',repeat('a',64),clock_timestamp(),null,
    'cs_chunk4_fixture','pi_chunk4_unsettled','unverified_requires_action','card',0,'USD',
    'payer@example.invalid','14000000-0000-4000-8000-000000000099',
    '24000000-0000-4000-8000-000000000099','94000000-0000-4000-8000-000000000099',
    'a4600000-0000-4000-8000-000000000099','a4700000-0000-4000-8000-000000000099',repeat('d',64),
    'a4800000-0000-4000-8000-000000000099','a4800000-0000-4000-8000-000000000098',
    'a4900000-0000-4000-8000-000000000099','a4900000-0000-4000-8000-000000000098'
  );
  perform pg_temp.assert_true(result_value->>'outcome'='UNSETTLED_OR_UNSUPPORTED'
    and not (result_value->>'searchActive')::boolean, 'unsettled completed event did not fail closed');
  perform pg_temp.assert_true((select settlement='FAILED' and customer_id is null
    from public.ap_payment_attempts where id='a4500000-0000-4000-8000-000000000001'),
    'unsettled event created identity or paid state');
  perform pg_temp.assert_true((select applied_at is not null from public.ap_provider_events
    where provider_event_id='evt_chunk4_unsettled'), 'unsettled provider event was not durably acknowledged');
  perform pg_temp.assert_true(not exists(select 1 from public.ap_search_services
    where winning_payment_attempt_id='a4500000-0000-4000-8000-000000000001'),
    'unsettled event activated work');
end;
$$;
rollback to savepoint before_unsettled_completed_event;

do $$ begin
  perform public.ap_apply_verified_search_payment(
    'evt_chunk4_wrong_identity','checkout.session.completed',repeat('c',64),clock_timestamp(),clock_timestamp()-interval '1 minute',
    'cs_chunk4_fixture','pi_chunk4_fixture','succeeded','card',2000,'USD','payer@example.invalid',
    '14000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001','a4600000-0000-4000-8000-000000000001',
    'a4700000-0000-4000-8000-000000000001',repeat('d',64),
    'a4800000-0000-4000-8000-000000000001','a4800000-0000-4000-8000-000000000002',
    'a4900000-0000-4000-8000-000000000001','a4900000-0000-4000-8000-000000000002'
  );
  raise exception 'wrong_access_identity_was_activated';
exception when raise_exception then
  if sqlerrm='wrong_access_identity_was_activated' then raise; end if;
  if sqlerrm<>'access_identity_mismatch' then raise; end if;
end $$;

savepoint before_two_paid_checkout_sessions;
select pg_temp.assert_true(public.ap_expire_search_checkout(
  'a4400000-0000-4000-8000-000000000001','SUPERSEDED_BY_NEW_CHECKOUT'
), 'superseded checkout did not expire');
select * from public.ap_begin_search_checkout(
  '34000000-0000-4000-8000-000000000001',repeat('a',64),
  '54000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',
  'chunk4-search-request-second','a4200000-0000-4000-8000-000000000002',repeat('c',64),
  'a4300000-0000-4000-8000-000000000002','search-checkout/a4300000-0000-4000-8000-000000000002',
  'a4400000-0000-4000-8000-000000000002','a4500000-0000-4000-8000-000000000002',
  repeat('d',64),repeat('e',64),'5a000000-0000-4000-8000-000000000001'
);
select pg_temp.assert_true(public.ap_promote_search_checkout(
  'a4400000-0000-4000-8000-000000000002','cs_chunk4_fixture_second',
  date_trunc('second',clock_timestamp())+interval '30 minutes'
), 'replacement checkout promotion failed');
do $$
declare winner_result jsonb; duplicate_result jsonb;
begin
  winner_result:=public.ap_apply_verified_search_payment(
    'evt_chunk4_second_wins','checkout.session.completed',repeat('1',64),clock_timestamp(),clock_timestamp()-interval '1 minute',
    'cs_chunk4_fixture_second','pi_chunk4_second_wins','succeeded','card',2000,'USD','second-payer@example.invalid',
    '14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000002',
    '94000000-0000-4000-8000-000000000002','a4600000-0000-4000-8000-000000000002',
    'a4700000-0000-4000-8000-000000000002',repeat('2',64),
    'a4800000-0000-4000-8000-000000000003','a4800000-0000-4000-8000-000000000004',
    'a4900000-0000-4000-8000-000000000003','a4900000-0000-4000-8000-000000000004'
  );
  duplicate_result:=public.ap_apply_verified_search_payment(
    'evt_chunk4_late_duplicate','checkout.session.completed',repeat('3',64),clock_timestamp(),clock_timestamp()-interval '30 seconds',
    'cs_chunk4_fixture','pi_chunk4_late_duplicate','succeeded','card',2000,'USD','different-payer@example.invalid',
    '14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000003',
    '94000000-0000-4000-8000-000000000003','a4600000-0000-4000-8000-000000000003',
    'a4700000-0000-4000-8000-000000000003',repeat('4',64),
    'a4800000-0000-4000-8000-000000000005','a4800000-0000-4000-8000-000000000006',
    'a4900000-0000-4000-8000-000000000005','a4900000-0000-4000-8000-000000000006'
  );
  perform pg_temp.assert_true(winner_result->>'outcome'='SEARCH_ACTIVE'
    and duplicate_result->>'outcome'='DUPLICATE_REFUND_PENDING',
    'two paid sessions did not preserve one winner and refund the loser');
end;
$$;
select pg_temp.assert_true((select count(*)=1 and bool_and(winning_payment_attempt_id='a4500000-0000-4000-8000-000000000002')
  from public.ap_search_services where original_snapshot_id='54000000-0000-4000-8000-000000000001'),
  'two paid sessions activated more than one search');
select pg_temp.assert_true((select count(*)=1 and bool_and(state='PENDING' and amount_cents=2000 and reason_code='DUPLICATE_PAID_ATTEMPT')
  from public.ap_refund_operations where payment_attempt_id='a4500000-0000-4000-8000-000000000001'),
  'duplicate paid session did not queue exactly one full refund');
select pg_temp.assert_true((select state='EXPIRED' and stale_reason='DUPLICATE_PAID_ATTEMPT'
  from public.ap_checkout_attempts where id='a4400000-0000-4000-8000-000000000001'),
  'late duplicate checkout did not remain terminal with its classified reason');
select pg_temp.assert_true((select lifecycle='EXPIRED' and debit_disposition='RETURNED'
  from public.ap_capacity_allocations where request_key='search-checkout:chunk4-search-request'),
  'late duplicate returned or corrupted capacity incorrectly');
select pg_temp.assert_true((select lifecycle='CONSUMED' and debit_disposition='SPENT'
  from public.ap_capacity_allocations where request_key='search-checkout:chunk4-search-request-second'),
  'winning paid session did not consume capacity exactly once');
rollback to savepoint before_two_paid_checkout_sessions;

savepoint before_stale_checkout_paid_after_edit;
do $$
declare edit_version bigint; stale_result jsonb;
begin
  edit_version:=public.ap_begin_pre_activation_edit(
    '34000000-0000-4000-8000-000000000001',repeat('a',64)
  );
  perform pg_temp.assert_true((select state='OPEN' and invalidated_at is not null and stale_reason='PRE_ACTIVATION_EDIT'
      from public.ap_checkout_attempts where id='a4400000-0000-4000-8000-000000000001')
    and (select lifecycle='SUPERSEDED' and debit_disposition='RETURNED'
      from public.ap_capacity_allocations where request_key='search-checkout:chunk4-search-request')
    and exists(select 1 from public.ap_scheduled_jobs where job_kind='CHECKOUT_PROVIDER_EXPIRE'
      and reference_id='a4400000-0000-4000-8000-000000000001'),
    'editing did not invalidate the open checkout, return held capacity, and queue provider expiry');
  insert into public.ap_intake_snapshots
  select (jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(snapshot)||jsonb_build_object(
    'id','54000000-0000-4000-8000-000000000002',
    'parent_snapshot_id',snapshot.id,
    'version',2,
    'snapshot_kind','PRE_ACTIVATION_EDIT',
    'content_sha256',repeat('a',64),
    'finalized_at',clock_timestamp()
  ))).* from public.ap_intake_snapshots snapshot
  where snapshot.id='54000000-0000-4000-8000-000000000001';
  update public.ap_anonymous_drafts set state='COMPLETE',
    finalized_snapshot_id='54000000-0000-4000-8000-000000000002',version=edit_version+1
  where id='34000000-0000-4000-8000-000000000001';
  stale_result:=public.ap_apply_verified_search_payment(
    'evt_chunk4_stale_paid','checkout.session.completed',repeat('5',64),clock_timestamp(),clock_timestamp()-interval '20 seconds',
    'cs_chunk4_fixture','pi_chunk4_stale_paid','succeeded','card',2000,'USD','payer-change@example.invalid',
    '14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000004',
    '94000000-0000-4000-8000-000000000004','a4600000-0000-4000-8000-000000000004',
    'a4700000-0000-4000-8000-000000000004',repeat('6',64),
    'a4800000-0000-4000-8000-000000000007','a4800000-0000-4000-8000-000000000008',
    'a4900000-0000-4000-8000-000000000007','a4900000-0000-4000-8000-000000000008'
  );
  perform pg_temp.assert_true(stale_result->>'outcome'='STALE_REFUND_PENDING'
    and not (stale_result->>'searchActive')::boolean,
    'late payment after intake edit activated stale work');
  perform pg_temp.assert_true(not exists(select 1 from public.ap_search_services)
    and (select count(*)=1 and bool_and(state='PENDING' and reason_code='STALE_CHECKOUT_PAID')
      from public.ap_refund_operations where payment_attempt_id='a4500000-0000-4000-8000-000000000001'),
    'late stale payment did not queue exactly one full refund');
  perform pg_temp.assert_true((select state='COMPLETED' and invalidated_at is not null
      from public.ap_checkout_attempts where id='a4400000-0000-4000-8000-000000000001')
    and (select state='COMPLETE' and finalized_snapshot_id='54000000-0000-4000-8000-000000000002'
      and capability_secret_hash=repeat('a',64) from public.ap_anonymous_drafts
      where id='34000000-0000-4000-8000-000000000001'),
    'stale payment corrupted the newer edited draft or failed to terminally classify checkout');
end;
$$;
rollback to savepoint before_stale_checkout_paid_after_edit;

savepoint before_expired_capacity_reacquired;
update public.ap_capacity_allocations set expires_at=clock_timestamp()-interval '1 second'
where request_key='search-checkout:chunk4-search-request';
do $$
declare result_value jsonb;
begin
  result_value:=public.ap_apply_verified_search_payment(
    'evt_chunk4_reacquire_success','checkout.session.completed',repeat('7',64),clock_timestamp(),clock_timestamp()-interval '10 seconds',
    'cs_chunk4_fixture','pi_chunk4_reacquire_success','succeeded','card',2000,'USD','payer@example.invalid',
    '14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000005',
    '94000000-0000-4000-8000-000000000005','a4600000-0000-4000-8000-000000000005',
    'a4700000-0000-4000-8000-000000000005',repeat('8',64),
    'a4800000-0000-4000-8000-000000000009','a4800000-0000-4000-8000-00000000000a',
    'a4900000-0000-4000-8000-000000000009','a4900000-0000-4000-8000-00000000000a'
  );
  perform pg_temp.assert_true(result_value->>'outcome'='SEARCH_ACTIVE',
    'paid reservation expiry did not attempt one successful atomic reacquisition');
end;
$$;
select pg_temp.assert_true((select lifecycle='EXPIRED' and debit_disposition='RETURNED'
    from public.ap_capacity_allocations where request_key='search-checkout:chunk4-search-request')
  and (select lifecycle='CONSUMED' and debit_disposition='SPENT'
    from public.ap_capacity_allocations where request_key='search-reacquire:a4400000-0000-4000-8000-000000000001')
  and (select reacquisition_attempted_at is not null and reacquired_capacity_allocation_id is not null
    from public.ap_checkout_attempts where id='a4400000-0000-4000-8000-000000000001'),
  'successful reacquisition did not preserve old and new capacity dispositions');
rollback to savepoint before_expired_capacity_reacquired;

savepoint before_expired_capacity_exception;
update public.ap_capacity_allocations set expires_at=clock_timestamp()-interval '1 second'
where request_key='search-checkout:chunk4-search-request';
select pg_temp.assert_true(public.ap_release_unconsumed_capacity(
  (select id from public.ap_capacity_allocations where request_key='search-checkout:chunk4-search-request'),
  'CHECKOUT_RESERVATION_EXPIRED_FIXTURE'
), 'expired reservation fixture was not returned before saturation');
select public.ap_reserve_capacity(
  '14000000-0000-4000-8000-000000000002','SEARCH',3,'chunk4-race-saturation',
  clock_timestamp()+interval '5 minutes','[]',null
);
do $$
declare result_value jsonb;
begin
  result_value:=public.ap_apply_verified_search_payment(
    'evt_chunk4_reacquire_failed','checkout.session.completed',repeat('9',64),clock_timestamp(),clock_timestamp()-interval '10 seconds',
    'cs_chunk4_fixture','pi_chunk4_reacquire_failed','succeeded','card',2000,'USD','payer@example.invalid',
    '14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000006',
    '94000000-0000-4000-8000-000000000006','a4600000-0000-4000-8000-000000000006',
    'a4700000-0000-4000-8000-000000000006',repeat('0',64),
    'a4800000-0000-4000-8000-00000000000b','a4800000-0000-4000-8000-00000000000c',
    'a4900000-0000-4000-8000-00000000000b','a4900000-0000-4000-8000-00000000000c'
  );
  perform pg_temp.assert_true(result_value->>'outcome'='CAPACITY_EXCEPTION'
    and not (result_value->>'searchActive')::boolean,
    'failed paid-capacity reacquisition claimed search activation');
end;
$$;
select pg_temp.assert_true(not exists(select 1 from public.ap_search_services)
  and (select count(*)=1 and bool_and(state='PENDING' and amount_cents=2000 and reason_code='CAPACITY_EXCEPTION')
    from public.ap_refund_operations where payment_attempt_id='a4500000-0000-4000-8000-000000000001')
  and (select state='COMPLETED' and capacity_exception_at is not null
    and reacquisition_attempted_at is not null from public.ap_checkout_attempts
    where id='a4400000-0000-4000-8000-000000000001'),
  'failed reacquisition did not atomically record capacity exception and full refund');
rollback to savepoint before_expired_capacity_exception;

do $$
declare result_value jsonb; replay_value jsonb;
begin
  result_value:=public.ap_apply_verified_search_payment(
    'evt_chunk4_success','checkout.session.completed',repeat('e',64),clock_timestamp(),clock_timestamp()-interval '1 minute',
    'cs_chunk4_fixture','pi_chunk4_fixture','succeeded','card',2000,'USD','payer@example.invalid',
    '14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001','a4600000-0000-4000-8000-000000000001',
    'a4700000-0000-4000-8000-000000000001',repeat('d',64),
    'a4800000-0000-4000-8000-000000000001','a4800000-0000-4000-8000-000000000002',
    'a4900000-0000-4000-8000-000000000001','a4900000-0000-4000-8000-000000000002'
  );
  perform pg_temp.assert_true(result_value->>'outcome'='SEARCH_ACTIVE' and (result_value->>'searchActive')::boolean, 'verified charge did not activate search');
  replay_value:=public.ap_apply_verified_search_payment(
    'evt_chunk4_success','checkout.session.completed',repeat('e',64),clock_timestamp(),clock_timestamp()-interval '1 minute',
    'cs_chunk4_fixture','pi_chunk4_fixture','succeeded','card',2000,'USD','payer@example.invalid',
    '14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000009',
    '94000000-0000-4000-8000-000000000009','a4600000-0000-4000-8000-000000000009',
    'a4700000-0000-4000-8000-000000000009',repeat('d',64),
    'a4800000-0000-4000-8000-000000000009','a4800000-0000-4000-8000-00000000000a',
    'a4900000-0000-4000-8000-000000000009','a4900000-0000-4000-8000-00000000000a'
  );
  perform pg_temp.assert_true((replay_value->>'replayed')::boolean and replay_value->>'outcome'='SEARCH_ACTIVE', 'provider-event replay was not idempotent');
end;
$$;

select pg_temp.assert_true((select count(*)=1 from public.ap_search_services where original_snapshot_id='54000000-0000-4000-8000-000000000001'), 'verified webhook duplicated search');
select pg_temp.assert_true((select settlement='PAID' and immediate_charge_verified and payment_method_type='card' and amount_cents=2000 and currency='USD' and payer_receipt_email='payer@example.invalid' from public.ap_payment_attempts where id='a4500000-0000-4000-8000-000000000001'), 'verified payment facts were not persisted');
select pg_temp.assert_true((select paid_at<>search_activated_at from public.orders join public.ap_search_services on legacy_order_id=orders.id where orders.id='94000000-0000-4000-8000-000000000001'), 'provider payment time was replaced by activation time');
select pg_temp.assert_true((select delivery_due_at=service_started_at+interval '24 hours' and service_started_at>=intake_completed_at and service_started_at>=capacity_confirmed_at from public.ap_search_services where id='a4600000-0000-4000-8000-000000000001'), 'exact activation deadline clock is invalid');
select pg_temp.assert_true((select lifecycle='CONSUMED' and debit_disposition='SPENT' and expires_at is null from public.ap_capacity_allocations where id=(select capacity_allocation_id from public.ap_search_services where id='a4600000-0000-4000-8000-000000000001')), 'capacity was not consumed exactly once');
select pg_temp.assert_true((select count(*)=2 and bool_and(expires_at=issued_at+interval '15 minutes') from public.ap_order_access_capabilities where checkout_attempt_id='a4400000-0000-4000-8000-000000000001'), 'access capability clocks are not exact');
select pg_temp.assert_true((public.ap_read_checkout_status('a4400000-0000-4000-8000-000000000001',repeat('9',64))->>'state')='SEARCH_ACTIVE', 'browser status did not derive from verified server state');

select * from public.ap_claim_outbox_messages('chunk4-fixture-worker',1);
select pg_temp.assert_true((select state='SENDING' and first_submitted_at is not null and attempts=1 from public.ap_outbox_messages where id='a4900000-0000-4000-8000-000000000001'), 'outbox was not durably leased');
do $$
declare prior_expiry timestamptz; renewed_expiry timestamptz;
begin
  select lease_expires_at into prior_expiry from public.ap_outbox_messages
    where id='a4900000-0000-4000-8000-000000000001';
  perform pg_sleep(0.01);
  renewed_expiry:=public.ap_renew_outbox_lease('a4900000-0000-4000-8000-000000000001','chunk4-fixture-worker');
  perform pg_temp.assert_true(renewed_expiry>prior_expiry
    and renewed_expiry<=clock_timestamp()+interval '5 minutes 1 second', 'outbox lease renewal was not bounded');
end;
$$;
select pg_temp.assert_true(public.ap_align_access_capability_to_outbox(
  'a4900000-0000-4000-8000-000000000001','chunk4-fixture-worker',repeat('b',64)
)='a4800000-0000-4000-8000-000000000002', 'email capability did not bind to first provider submission');
select pg_temp.assert_true((select capability.issued_at=message.first_submitted_at and capability.expires_at=message.first_submitted_at+interval '15 minutes' from public.ap_order_access_capabilities capability join public.ap_outbox_messages message on message.id='a4900000-0000-4000-8000-000000000001' where capability.id='a4800000-0000-4000-8000-000000000002'), 'email access did not receive an exact fifteen-minute send clock');
select pg_temp.assert_true(public.ap_complete_outbox_message('a4900000-0000-4000-8000-000000000001','chunk4-fixture-worker','provider-message-1'), 'outbox completion failed');

savepoint before_unapproved_email_provider;
update public.ap_commerce_configuration set provider_idempotent_email_approved=false,
  provider_email_approval_reference=null where singleton;
do $$ begin
  begin
    perform * from public.ap_claim_outbox_messages('blocked-provider-worker',1);
  exception when raise_exception then
    if sqlerrm='email_provider_guarantee_unapproved' then return; end if;
    raise;
  end;
  raise exception 'unapproved_email_provider_was_claimed';
end $$;
rollback to savepoint before_unapproved_email_provider;

savepoint before_outbox_crash_recovery;
insert into public.ap_outbox_messages(
  id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,
  provider_idempotency_key,state,next_attempt_at
) values(
  'a4900000-0000-4000-8000-000000000030','14000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','SEARCH_EXACT_TEN_DELIVERED',
  '54000000-0000-4000-8000-000000000001','chunk4-outbox-crash',
  'a4900000-0000-4000-8000-000000000030','QUEUED',clock_timestamp()-interval '2 days'
);
select * from public.ap_claim_outbox_messages('outbox-crash-worker-a',1);
select pg_temp.assert_true((select state='SENDING' and attempts=1 and first_submitted_at is not null
    and provider_idempotency_key='a4900000-0000-4000-8000-000000000030'
    from public.ap_outbox_messages where id='a4900000-0000-4000-8000-000000000030'),
  'outbox commit was not durably claimed with immutable provider idempotency');
select pg_temp.assert_true((select count(*)=0 from public.ap_claim_outbox_messages('outbox-crash-worker-b',1)
    where id='a4900000-0000-4000-8000-000000000030'),
  'unexpired outbox lease was concurrently reclaimed');
update public.ap_outbox_messages set lease_expires_at=clock_timestamp()-interval '1 second'
where id='a4900000-0000-4000-8000-000000000030';
select * from public.ap_claim_outbox_messages('outbox-crash-worker-b',1);
select pg_temp.assert_true((select state='SENDING' and attempts=2 and lease_owner='outbox-crash-worker-b'
    and provider_idempotency_key='a4900000-0000-4000-8000-000000000030'
    from public.ap_outbox_messages where id='a4900000-0000-4000-8000-000000000030'),
  'provider-accepted crash was not reclaimed with the same idempotency key');
select pg_temp.assert_true(public.ap_fail_outbox_message(
  'a4900000-0000-4000-8000-000000000030','outbox-crash-worker-b','provider_send_ambiguous',
  clock_timestamp()+interval '1 minute',false
), 'outbox retry transition failed');
select pg_temp.assert_true((select state='RETRY' and reconciliation_state='REQUIRED'
    and last_error_code='provider_send_ambiguous' from public.ap_outbox_messages
    where id='a4900000-0000-4000-8000-000000000030'),
  'ambiguous outbox send was not held for idempotent reconciliation');
update public.ap_outbox_messages set next_attempt_at=clock_timestamp()-interval '1 second'
where id='a4900000-0000-4000-8000-000000000030';
select * from public.ap_claim_outbox_messages('outbox-crash-worker-c',1);
update public.ap_outbox_messages set first_submitted_at=clock_timestamp()-interval '24 hours 1 second'
where id='a4900000-0000-4000-8000-000000000030';
select pg_temp.assert_true(public.ap_fail_outbox_message(
  'a4900000-0000-4000-8000-000000000030','outbox-crash-worker-c','provider_send_failed',
  clock_timestamp()+interval '1 minute',false
), 'outbox dead-letter transition failed');
select pg_temp.assert_true((select state='DEAD_LETTER' and dead_lettered_at is not null
    and reconciliation_state='FAILED' from public.ap_outbox_messages
    where id='a4900000-0000-4000-8000-000000000030')
  and exists(select 1 from public.ap_operational_alerts
    where alert_key='outbox-dead-letter:a4900000-0000-4000-8000-000000000030'),
  'outbox dead letter was not durable and visible');
rollback to savepoint before_outbox_crash_recovery;

insert into public.ap_scheduled_jobs(id,job_kind,reference_id,idempotency_key,run_at)
values('a4f00000-0000-4000-8000-000000000001','LEASE_TEST','a4f00000-0000-4000-8000-000000000002',
  'chunk4-lease-test',clock_timestamp()-interval '1 day');
select * from public.ap_claim_scheduled_jobs('chunk4-lease-worker',1);
do $$
declare prior_expiry timestamptz; renewed_expiry timestamptz;
begin
  select lease_expires_at into prior_expiry from public.ap_scheduled_jobs
    where id='a4f00000-0000-4000-8000-000000000001' and lease_owner='chunk4-lease-worker';
  perform pg_temp.assert_true(prior_expiry is not null, 'scheduled job lease was not acquired');
  perform pg_sleep(0.01);
  renewed_expiry:=public.ap_renew_scheduled_job_lease('a4f00000-0000-4000-8000-000000000001','chunk4-lease-worker');
  perform pg_temp.assert_true(renewed_expiry>prior_expiry
    and renewed_expiry<=clock_timestamp()+interval '5 minutes 1 second', 'scheduled job lease renewal was not bounded');
  perform public.ap_complete_external_scheduled_job('a4f00000-0000-4000-8000-000000000001','chunk4-lease-worker');
end;
$$;

savepoint before_scheduler_crash_recovery;
insert into public.ap_scheduled_jobs(id,job_kind,reference_id,idempotency_key,run_at)
values('a4f00000-0000-4000-8000-000000000010','LEASE_TEST','a4f00000-0000-4000-8000-000000000011',
  'chunk4-scheduler-crash',clock_timestamp()-interval '2 days');
select * from public.ap_claim_scheduled_jobs('scheduler-crash-worker-a',1);
select pg_temp.assert_true((select count(*)=0 from public.ap_claim_scheduled_jobs('scheduler-crash-contender',1)
    where id='a4f00000-0000-4000-8000-000000000010'),
  'scheduler lease contention claimed the same job twice');
update public.ap_scheduled_jobs set lease_expires_at=clock_timestamp()-interval '1 second'
where id='a4f00000-0000-4000-8000-000000000010';
select * from public.ap_claim_scheduled_jobs('scheduler-crash-worker-b',1);
select pg_temp.assert_true((select state='LEASED' and attempts=2 and lease_owner='scheduler-crash-worker-b'
    from public.ap_scheduled_jobs where id='a4f00000-0000-4000-8000-000000000010'),
  'expired scheduler lease was not reclaimed after worker crash');
select pg_temp.assert_true(public.ap_retry_scheduled_job(
  'a4f00000-0000-4000-8000-000000000010','scheduler-crash-worker-b','transient_worker_error',
  clock_timestamp()+interval '1 minute',false
), 'scheduler retry transition failed');
update public.ap_scheduled_jobs set run_at=clock_timestamp()-interval '1 second'
where id='a4f00000-0000-4000-8000-000000000010';
select * from public.ap_claim_scheduled_jobs('scheduler-crash-worker-c',1);
select pg_temp.assert_true(public.ap_retry_scheduled_job(
  'a4f00000-0000-4000-8000-000000000010','scheduler-crash-worker-c','terminal_worker_error',
  clock_timestamp(),true
), 'scheduler dead-letter transition failed');
select pg_temp.assert_true((select state='DEAD_LETTER' and attempts=3
    from public.ap_scheduled_jobs where id='a4f00000-0000-4000-8000-000000000010')
  and exists(select 1 from public.ap_operational_alerts
    where alert_key='worker-dead-letter:a4f00000-0000-4000-8000-000000000010'),
  'scheduler dead letter was not durable and visible');
rollback to savepoint before_scheduler_crash_recovery;

select * from public.ap_consume_order_access('a4800000-0000-4000-8000-000000000002',repeat('b',64));
do $$ begin
  perform public.ap_consume_order_access('a4800000-0000-4000-8000-000000000002',repeat('b',64));
  raise exception 'single_use_access_was_reused';
exception when raise_exception then
  if sqlerrm='single_use_access_was_reused' then raise; end if;
  if sqlerrm<>'access_capability_invalid' then raise; end if;
end $$;

savepoint before_adjustment_accept;
select public.ap_propose_search_adjustment(
  'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',8,
  array['INVENTORY_SHORTAGE'],'{"workMode":"REMOTE_ONLY"}','{"workModes":{"before":["REMOTE"],"after":["REMOTE","HYBRID"]}}',
  '{"workModes":["REMOTE","HYBRID"]}',clock_timestamp()+interval '1 hour',1800,
  'chunk4-adjustment-accept','a4900000-0000-4000-8000-000000000003'
);
do $$
declare amendment_id uuid; accepted jsonb; replayed jsonb;
begin
  select id into amendment_id from public.ap_criteria_amendments where idempotency_key='chunk4-adjustment-accept';
  perform pg_temp.assert_true((select revision_due_at is null and estimated_revision_seconds=1800
    and proposal_expires_at<=service.delivery_due_at from public.ap_criteria_amendments amendment
    join public.ap_search_services service on service.id=amendment.search_service_id
    where amendment.id=amendment_id), 'proposal exposed an exact pre-acceptance deadline or exceeded the active deadline');
  begin
    perform public.ap_commit_exact_ten_release(
      'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',
      'a4a00000-0000-4000-8000-000000000001',
      (select jsonb_agg(jsonb_build_object('position',g,'evaluationId','b4500000-0000-4000-8000-'||lpad(g::text,12,'0'))) from generate_series(1,10) g),
      '{"criteriaCompared":true,"allListingsRechecked":true,"exactlyTenApplicationWorthy":true,"noPadding":true,"humanReleaseApproved":true}',
      'The reviewer checked every exact release condition.','a4b00000-0000-4000-8000-000000000001','a4900000-0000-4000-8000-000000000010'
    );
    raise exception 'release_bypassed_pending_adjustment';
  exception when raise_exception then
    if sqlerrm='release_bypassed_pending_adjustment' then raise; end if;
    if sqlerrm<>'search_release_not_allowed' then raise; end if;
  end;
  accepted:=public.ap_accept_search_adjustment(
    amendment_id,'14000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000002',
    repeat('f',64),'chunk4-adjustment-acceptance','chunk4-adjustment-capacity',
    'a4900000-0000-4000-8000-000000000004'
  );
  perform pg_temp.assert_true(accepted->>'outcome'='ACCEPTED' and not (accepted->>'replayed')::boolean, 'explicit adjustment acceptance failed');
  replayed:=public.ap_accept_search_adjustment(
    amendment_id,'14000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000002',
    repeat('f',64),'chunk4-adjustment-acceptance','chunk4-adjustment-capacity',
    'a4900000-0000-4000-8000-000000000006'
  );
  perform pg_temp.assert_true((replayed->>'replayed')::boolean and replayed->>'outcome'='ACCEPTED',
    'adjustment acceptance replay was not idempotent');
  perform pg_temp.assert_true((select parent_snapshot_id='54000000-0000-4000-8000-000000000001' and snapshot_kind='SEARCH_ADJUSTMENT' from public.ap_intake_snapshots where id='54000000-0000-4000-8000-000000000002'), 'adjustment child snapshot lineage missing');
  perform pg_temp.assert_true((select active_deadline_revision=2 and delivery_due_at=service_started_at+interval '24 hours' from public.ap_search_services where id='a4600000-0000-4000-8000-000000000001')
    and (select count(*)=2 and bool_and(due_at=started_at+interval '24 hours') from public.ap_search_deadline_history where search_service_id='a4600000-0000-4000-8000-000000000001')
    and (select lifecycle='SUPERSEDED' and debit_disposition='SPENT' from public.ap_capacity_allocations where request_key='search-checkout:chunk4-search-request')
    and (select lifecycle='CONSUMED' and debit_disposition='SPENT' from public.ap_capacity_allocations where request_key='chunk4-adjustment-capacity'),
    'accepted adjustment did not preserve immutable deadlines and atomically transfer spent capacity');
end;
$$;
rollback to savepoint before_adjustment_accept;

savepoint before_adjustment_decline;
select public.ap_propose_search_adjustment(
  'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',8,
  array['INVENTORY_SHORTAGE'],'{"workMode":"REMOTE_ONLY"}','{"workModes":{"before":["REMOTE"],"after":["REMOTE","HYBRID"]}}',
  '{"workModes":["REMOTE","HYBRID"]}',clock_timestamp()+interval '1 hour',1800,
  'chunk4-adjustment-decline','a4900000-0000-4000-8000-000000000005'
);
do $$
declare amendment_id uuid; declined jsonb;
begin
  select id into amendment_id from public.ap_criteria_amendments where idempotency_key='chunk4-adjustment-decline';
  declined:=public.ap_decline_search_adjustment(
    amendment_id,'14000000-0000-4000-8000-000000000001','chunk4-adjustment-declined','Customer chose the full refund.'
  );
  perform pg_temp.assert_true(declined->>'outcome'='REFUND_PROCESSING', 'adjustment decline did not start refund');
  perform pg_temp.assert_true((select count(*)=1 and bool_and(amount_cents=2000 and currency='USD' and state='PENDING' and required) from public.ap_refund_operations where payment_attempt_id='a4500000-0000-4000-8000-000000000001' and superseded_at is null), 'required full refund was not durable');
end;
$$;
rollback to savepoint before_adjustment_decline;

savepoint before_repeated_adjustments;
select public.ap_propose_search_adjustment(
  'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',8,
  array['INVENTORY_SHORTAGE'],'{"workMode":"REMOTE_ONLY"}','{"workModes":{"before":["REMOTE"],"after":["REMOTE","HYBRID"]}}',
  '{"workModes":["REMOTE","HYBRID"]}',clock_timestamp()+interval '30 minutes',1800,
  'chunk4-adjustment-repeat-1','a4900000-0000-4000-8000-000000000020'
);
select public.ap_accept_search_adjustment(
  (select id from public.ap_criteria_amendments where idempotency_key='chunk4-adjustment-repeat-1'),
  '14000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000012',repeat('1',64),
  'chunk4-adjustment-repeat-accept-1','chunk4-adjustment-repeat-capacity-1',
  'a4900000-0000-4000-8000-000000000021'
);
select public.ap_propose_search_adjustment(
  'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',9,
  array['INVENTORY_SHORTAGE'],'{"industryBreadth":"CURRENT"}','{"searchBreadth":{"before":"ADJACENT_OPPORTUNITIES","after":"BROADEST_SUPPORTED_SCOPE"}}',
  '{"searchBreadth":"BROADEST_SUPPORTED_SCOPE"}',clock_timestamp()+interval '30 minutes',1200,
  'chunk4-adjustment-repeat-2','a4900000-0000-4000-8000-000000000022'
);
select public.ap_accept_search_adjustment(
  (select id from public.ap_criteria_amendments where idempotency_key='chunk4-adjustment-repeat-2'),
  '14000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000013',repeat('2',64),
  'chunk4-adjustment-repeat-accept-2','chunk4-adjustment-repeat-capacity-2',
  'a4900000-0000-4000-8000-000000000023'
);
select pg_temp.assert_true((select active_deadline_revision=3 and delivery_due_at=service_started_at+interval '24 hours'
    from public.ap_search_services where id='a4600000-0000-4000-8000-000000000001')
  and (select count(*)=3 and bool_and(due_at=started_at+interval '24 hours')
    from public.ap_search_deadline_history where search_service_id='a4600000-0000-4000-8000-000000000001')
  and (select lifecycle='SUPERSEDED' and debit_disposition='SPENT'
    from public.ap_capacity_allocations where request_key='chunk4-adjustment-repeat-capacity-1')
  and (select lifecycle='CONSUMED' and debit_disposition='SPENT'
    from public.ap_capacity_allocations where request_key='chunk4-adjustment-repeat-capacity-2')
  and public.ap_capacity_available('a4100000-0000-4000-8000-000000000001')=0,
  'repeated adjustment did not preserve each deadline and spent capacity revision');
rollback to savepoint before_repeated_adjustments;

savepoint before_adjustment_capacity_failure;
select public.ap_reserve_capacity(
  '14000000-0000-4000-8000-000000000002','SEARCH',2,'chunk4-adjustment-capacity-saturation',
  clock_timestamp()+interval '5 minutes','[]',null
);
select public.ap_propose_search_adjustment(
  'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',8,
  array['INVENTORY_SHORTAGE'],'{"workMode":"REMOTE_ONLY"}','{"workModes":{"before":["REMOTE"],"after":["REMOTE","HYBRID"]}}',
  '{"workModes":["REMOTE","HYBRID"]}',clock_timestamp()+interval '30 minutes',1800,
  'chunk4-adjustment-capacity-failure','a4900000-0000-4000-8000-000000000024'
);
do $$
declare result_value jsonb;
begin
  result_value:=public.ap_accept_search_adjustment(
    (select id from public.ap_criteria_amendments where idempotency_key='chunk4-adjustment-capacity-failure'),
    '14000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000014',repeat('3',64),
    'chunk4-adjustment-capacity-failure-accept','chunk4-adjustment-capacity-failure-reserve',
    'a4900000-0000-4000-8000-000000000025'
  );
  perform pg_temp.assert_true(result_value->>'outcome'='CAPACITY_EXCEPTION',
    'failed revised capacity did not return an explicit capacity exception');
end;
$$;
select pg_temp.assert_true(not exists(select 1 from public.ap_intake_snapshots where id='54000000-0000-4000-8000-000000000014')
  and (select count(*)=1 from public.ap_search_deadline_history where search_service_id='a4600000-0000-4000-8000-000000000001')
  and (select state='DECLINED' and revision_started_at is null and revision_due_at is null
    from public.ap_criteria_amendments where idempotency_key='chunk4-adjustment-capacity-failure')
  and (select refund_started_at is not null and fulfillment='CANCELED'
    from public.ap_search_services where id='a4600000-0000-4000-8000-000000000001')
  and (select count(*)=1 and bool_and(state='PENDING' and reason_code='REVISED_CAPACITY_UNAVAILABLE')
    from public.ap_refund_operations where payment_attempt_id='a4500000-0000-4000-8000-000000000001'),
  'failed revised capacity created a clock or failed to start one full refund');
rollback to savepoint before_adjustment_capacity_failure;

savepoint before_adjustment_no_response;
select public.ap_propose_search_adjustment(
  'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',8,
  array['INVENTORY_SHORTAGE'],'{"workMode":"REMOTE_ONLY"}','{"workModes":{"before":["REMOTE"],"after":["REMOTE","HYBRID"]}}',
  '{"workModes":["REMOTE","HYBRID"]}',clock_timestamp()+interval '30 minutes',1800,
  'chunk4-adjustment-no-response','a4900000-0000-4000-8000-000000000026'
);
update public.ap_criteria_amendments set proposal_expires_at=created_at+interval '1 microsecond'
where idempotency_key='chunk4-adjustment-no-response';
update public.ap_scheduled_jobs set run_at=clock_timestamp()-interval '3 days'
where idempotency_key='proposal-expiry:'||(select id::text from public.ap_criteria_amendments
  where idempotency_key='chunk4-adjustment-no-response');
do $$ begin
  begin
    perform public.ap_accept_search_adjustment(
      (select id from public.ap_criteria_amendments where idempotency_key='chunk4-adjustment-no-response'),
      '14000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000015',repeat('4',64),
      'chunk4-adjustment-stale-accept','chunk4-adjustment-stale-capacity',
      'a4900000-0000-4000-8000-000000000027'
    );
  exception when raise_exception then
    if sqlerrm='adjustment_not_acceptable' then return; end if;
    raise;
  end;
  raise exception 'expired_adjustment_link_was_accepted';
end $$;
select * from public.ap_claim_scheduled_jobs('adjustment-expiry-worker',1);
select public.ap_apply_local_scheduled_job(
  (select id from public.ap_scheduled_jobs where idempotency_key='proposal-expiry:'||
    (select id::text from public.ap_criteria_amendments where idempotency_key='chunk4-adjustment-no-response')),
  'adjustment-expiry-worker'
);
select pg_temp.assert_true((select state='EXPIRED' and revision_started_at is null and revision_due_at is null
    from public.ap_criteria_amendments where idempotency_key='chunk4-adjustment-no-response')
  and (select count(*)=1 and bool_and(state='PENDING' and reason_code='ADJUSTMENT_NO_RESPONSE')
    from public.ap_refund_operations where payment_attempt_id='a4500000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_search_deadline_history where search_service_id='a4600000-0000-4000-8000-000000000001'),
  'no-response adjustment did not expire into one refund without a new clock');
do $$ begin
  begin
    perform public.ap_accept_search_adjustment(
      (select id from public.ap_criteria_amendments where idempotency_key='chunk4-adjustment-no-response'),
      '14000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000015',repeat('4',64),
      'chunk4-adjustment-after-refund','chunk4-adjustment-after-refund-capacity',
      'a4900000-0000-4000-8000-000000000028'
    );
  exception when raise_exception then
    if sqlerrm='adjustment_not_acceptable' then return; end if;
    raise;
  end;
  raise exception 'adjustment_revived_after_refund';
end $$;
rollback to savepoint before_adjustment_no_response;

savepoint before_deadline_refund_boundary;
update public.ap_search_services
set service_started_at=boundary.at_time-interval '24 hours',
  delivery_due_at=boundary.at_time
from (select clock_timestamp()+interval '1 second' as at_time) boundary
where id='a4600000-0000-4000-8000-000000000001';
select pg_temp.assert_true(public.ap_start_search_service_refund(
  'a4600000-0000-4000-8000-000000000001','MISSED_ACTIVE_DEADLINE',true
) is null, 'deadline refund started at or before the active due boundary');
update public.ap_search_services
set service_started_at=boundary.at_time-interval '24 hours',
  delivery_due_at=boundary.at_time
from (select clock_timestamp()-interval '1 microsecond' as at_time) boundary
where id='a4600000-0000-4000-8000-000000000001';
select pg_temp.assert_true(public.ap_start_search_service_refund(
  'a4600000-0000-4000-8000-000000000001','MISSED_ACTIVE_DEADLINE',true
) is not null, 'deadline refund did not start immediately after the active due boundary');
select pg_temp.assert_true((select fulfillment='CANCELED' and refund_started_at is not null
    from public.ap_search_services where id='a4600000-0000-4000-8000-000000000001')
  and (select lifecycle='SUPERSEDED' and debit_disposition='SPENT'
    from public.ap_capacity_allocations where request_key='search-checkout:chunk4-search-request'),
  'deadline refund did not serialize against delivery and preserve spent capacity');
rollback to savepoint before_deadline_refund_boundary;

insert into public.ap_match_selection_runs(
  id,snapshot_id,purpose,scope_key,requested_count,selector_version,evaluation_set_sha256,content_sha256
) values(
  'a4a00000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',
  'RELEASE','search-service:a4600000-0000-4000-8000-000000000001',10,'bounded-diversity-v2',
  repeat('1',64),repeat('2',64)
);
insert into public.ap_match_selection_members(
  selection_run_id,evaluation_id,base_rank,selected_rank,rank_explanation,selector_explanation
)
select
  'a4a00000-0000-4000-8000-000000000001',
  ('b4500000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  g,g,jsonb_build_object('rank',g),jsonb_build_object('selected',true,'rank',g)
from generate_series(1,10) g;

-- Release is fail-closed against every material freshness, evidence, policy,
-- and provenance gate. Trigger bypass below is test-only synthetic mutation;
-- release itself always executes again with normal trigger behavior.
savepoint before_stale_selector_release;
set local session_replication_role = replica;
update public.ap_match_selection_runs set selector_version='bounded-diversity-v1'
where id='a4a00000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select pg_temp.assert_chunk4_release_rejected('current_release_selection_required',pg_temp.chunk4_release_members());
select pg_temp.assert_true(not exists(select 1 from public.ap_releases where id='a4b00000-0000-4000-8000-000000000001'), 'stale selector exposed a release');
rollback to savepoint before_stale_selector_release;

savepoint before_stale_rules_release;
set local session_replication_role = replica;
update public.ap_match_evaluations set calculation_version='matching-rules-v2'
where id='b4500000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select pg_temp.assert_chunk4_release_rejected('release_candidate_gate_failed',pg_temp.chunk4_release_members());
rollback to savepoint before_stale_rules_release;

savepoint before_disallowed_unknown_release;
set local session_replication_role = replica;
update public.ap_match_evaluations set unknown_treatments=array['BLOCK']::public.ap_unknown_treatment[]
where id='b4500000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select pg_temp.assert_chunk4_release_rejected('release_candidate_gate_failed',pg_temp.chunk4_release_members());
rollback to savepoint before_disallowed_unknown_release;

savepoint before_candidate_unknown_release;
set local session_replication_role = replica;
update public.ap_match_evaluations set resolution_issues=array['CANDIDATE_MISSING']::public.ap_resolution_issue[]
where id='b4500000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select pg_temp.assert_chunk4_release_rejected('release_candidate_gate_failed',pg_temp.chunk4_release_members());
rollback to savepoint before_candidate_unknown_release;

savepoint before_below_minimum_release;
set local session_replication_role = replica;
update public.ap_match_evaluations set salary_status='PUBLISHED_BELOW_MINIMUM',salary_disposition='FAIL'
where id='b4500000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select pg_temp.assert_chunk4_release_rejected('release_candidate_gate_failed',pg_temp.chunk4_release_members());
rollback to savepoint before_below_minimum_release;

savepoint before_low_evidence_release;
set local session_replication_role = replica;
update public.ap_match_evaluations set categorical_evidence_sufficient=false,usefulness_result='FAIL'
where id='b4500000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select pg_temp.assert_chunk4_release_rejected('release_candidate_gate_failed',pg_temp.chunk4_release_members());
rollback to savepoint before_low_evidence_release;

savepoint before_liveops_release;
set local session_replication_role = replica;
update public.ap_job_snapshots set company='Liveops'
where id='b4100000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select pg_temp.assert_chunk4_release_rejected('release_candidate_gate_failed',pg_temp.chunk4_release_members());
rollback to savepoint before_liveops_release;

savepoint before_listing_closed_after_evaluation;
set local session_replication_role = replica;
update public.ap_job_snapshots set listing_activity_result='FAIL'
where id='b4100000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select pg_temp.assert_chunk4_release_rejected('release_candidate_gate_failed',pg_temp.chunk4_release_members());
rollback to savepoint before_listing_closed_after_evaluation;

savepoint before_listing_closed_after_review;
select public.ap_record_job_release_review(
  'a4600000-0000-4000-8000-000000000001','b4500000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000003','APPROVED',
  'The current listing and all evidence gates were reviewed.'
);
set local session_replication_role = replica;
update public.ap_job_snapshots set listing_activity_result='FAIL'
where id='b4100000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select pg_temp.assert_chunk4_release_rejected('release_candidate_gate_failed',pg_temp.chunk4_release_members());
rollback to savepoint before_listing_closed_after_review;

savepoint before_listing_stale_immediately_before_release;
set local session_replication_role = replica;
update public.ap_job_snapshots set live_verified_at=clock_timestamp()-interval '60 minutes 1 second'
where id='b4100000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select pg_temp.assert_chunk4_release_rejected('release_candidate_gate_failed',pg_temp.chunk4_release_members());
rollback to savepoint before_listing_stale_immediately_before_release;

savepoint before_hard_failure_review_override;
set local session_replication_role = replica;
update public.ap_match_evaluations set root_result='FAIL',eligibility='INELIGIBLE'
where id='b4500000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
do $$ begin
  begin
    perform public.ap_record_job_release_review(
      'a4600000-0000-4000-8000-000000000001','b4500000-0000-4000-8000-000000000001',
      '14000000-0000-4000-8000-000000000003','APPROVED',
      'An attempted approval must not override a confirmed failure.'
    );
  exception when raise_exception then
    if sqlerrm='confirmed_hard_failure_not_approvable' then return; end if;
    raise;
  end;
  raise exception 'hard_failure_review_was_approved';
end $$;
rollback to savepoint before_hard_failure_review_override;

savepoint before_mid_release_failure;
select pg_temp.assert_chunk4_release_rejected(
  'release_member_job_mismatch',
  jsonb_set(pg_temp.chunk4_release_members(),'{5,jobId}',to_jsonb('b4000000-0000-4000-8000-000000000001'::text))
);
select pg_temp.assert_true(
  not exists(select 1 from public.ap_releases where id='a4b00000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.job_matches where search_order_id='94000000-0000-4000-8000-000000000001'),
  'mid-release failure exposed partial delivery'
);
rollback to savepoint before_mid_release_failure;

savepoint before_search_predelivery_dispute;
select public.ap_apply_search_dispute(
  'evt_chunk4_search_dispute_open',repeat('5',64),clock_timestamp(),'pi_chunk4_fixture','OPEN',
  'a4900000-0000-4000-8000-000000000070'
);
select pg_temp.assert_true((select fulfillment='CANCELED' and refund_started_at is null
  from public.ap_search_services where id='a4600000-0000-4000-8000-000000000001'),
  'open pre-delivery search dispute did not cancel without a merchant refund');
select pg_temp.assert_true((select lifecycle='SUPERSEDED' and debit_disposition='SPENT'
  from public.ap_capacity_allocations where id=(select capacity_allocation_id from public.ap_search_services
    where id='a4600000-0000-4000-8000-000000000001')),
  'consumed pre-delivery search capacity was returned or not superseded');
select public.ap_apply_search_dispute(
  'evt_chunk4_search_dispute_won',repeat('6',64),clock_timestamp(),'pi_chunk4_fixture','WON',
  'a4900000-0000-4000-8000-000000000071'
);
select pg_temp.assert_true((select count(*)=1 and bool_and(state='PENDING' and amount_cents=2000)
  from public.ap_refund_operations where payment_attempt_id='a4500000-0000-4000-8000-000000000001'
    and scope='FULL_SEARCH' and superseded_at is null),
  'won pre-delivery search dispute did not start one full refund');
rollback to savepoint before_search_predelivery_dispute;

do $$
declare members jsonb; checklist jsonb; release_value uuid; replay_value uuid;
begin
  select jsonb_agg(jsonb_build_object(
    'position',g,
    'evaluationId',('b4500000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
    'jobId',('b4000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
    'fitSummary','A reviewed evidence-based fit summary for this current role.',
    'matchingExperience',jsonb_build_array('Operations coordination'),
    'primaryOutcome','Coordinate accurate operations and customer support.',
    'coreResponsibilities',jsonb_build_array('Coordinate operations'),
    'requirements',jsonb_build_array('Reviewed current listing evidence'),
    'warnings','[]'::jsonb,
    'criteriaChecks',jsonb_build_object('applicationWorthy',true),
    'rankingReasonCodes',jsonb_build_array('CURRENT_VERIFIED_LISTING'),
    'releaseExplanation',jsonb_build_object(
      'whatJobInvolves','Coordinate current operations and support customers.',
      'whyMadeList','The reviewed criteria and current listing evidence passed.',
      'howExperienceConnects','The candidate evidence supports operations coordination.',
      'whatMayBeNew','The employer-specific workflow may be new.',
      'whatToKnow','Confirm the current employer listing before applying.'
    )
  ) order by g) into members from generate_series(1,10) g;
  checklist:='{"criteriaCompared":true,"allListingsRechecked":true,"exactlyTenApplicationWorthy":true,"noPadding":true,"humanReleaseApproved":true}'::jsonb;
  begin
    perform public.ap_commit_exact_ten_release(
      'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',
      'a4a00000-0000-4000-8000-000000000001',members||jsonb_build_array(members->0),checklist,
      'The reviewer checked every exact release condition and source.',
      'a4b00000-0000-4000-8000-000000000001','a4900000-0000-4000-8000-000000000010'
    );
    raise exception 'eleven_member_release_was_committed';
  exception when raise_exception then
    if sqlerrm='eleven_member_release_was_committed' then raise; end if;
    if sqlerrm<>'exact_ten_review_incomplete' then raise; end if;
  end;
  begin
    perform public.ap_commit_exact_ten_release(
      'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',
      'a4a00000-0000-4000-8000-000000000001',
      jsonb_set(members,'{9,evaluationId}',members->0->'evaluationId'),checklist,
      'The reviewer checked every exact release condition and source.',
      'a4b00000-0000-4000-8000-000000000001','a4900000-0000-4000-8000-000000000010'
    );
    raise exception 'duplicate_member_release_was_committed';
  exception when raise_exception then
    if sqlerrm='duplicate_member_release_was_committed' then raise; end if;
    if sqlerrm<>'release_selection_members_invalid' then raise; end if;
  end;
  begin
    perform public.ap_commit_exact_ten_release(
      'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',
      'a4a00000-0000-4000-8000-000000000001',members-9,checklist,
      'The reviewer checked every exact release condition and source.',
      'a4b00000-0000-4000-8000-000000000001','a4900000-0000-4000-8000-000000000010'
    );
    raise exception 'nine_member_release_was_committed';
  exception when raise_exception then
    if sqlerrm='nine_member_release_was_committed' then raise; end if;
    if sqlerrm<>'exact_ten_review_incomplete' then raise; end if;
  end;
  perform pg_temp.assert_true(not exists(select 1 from public.ap_releases where id='a4b00000-0000-4000-8000-000000000001'), 'failed release left partial state');
  release_value:=public.ap_commit_exact_ten_release(
    'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',
    'a4a00000-0000-4000-8000-000000000001',members,checklist,
    'The reviewer checked every exact release condition and source.',
    'a4b00000-0000-4000-8000-000000000001','a4900000-0000-4000-8000-000000000010'
  );
  perform pg_temp.assert_true(release_value='a4b00000-0000-4000-8000-000000000001', 'exact-ten release identity mismatch');
  replay_value:=public.ap_commit_exact_ten_release(
    'a4600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003',
    'a4a00000-0000-4000-8000-000000000001',members,checklist,
    'The reviewer checked every exact release condition and source.',
    'a4b00000-0000-4000-8000-000000000009','a4900000-0000-4000-8000-000000000019'
  );
  perform pg_temp.assert_true(replay_value=release_value, 'exact-ten release replay was not idempotent');
end;
$$;

select pg_temp.assert_true((select count(*)=1 from public.ap_releases where order_id='94000000-0000-4000-8000-000000000001' and release_kind='SEARCH_EXACT_TEN'), 'release ledger duplicated');
select pg_temp.assert_true((select count(*)=10 from public.ap_release_members where release_id='a4b00000-0000-4000-8000-000000000001'), 'release does not contain exactly ten members');
select pg_temp.assert_true((select count(*)=10 and count(distinct job_id)=10 and count(distinct release_evaluation_id)=10 from public.job_matches where search_order_id='94000000-0000-4000-8000-000000000001'), 'released jobs are not exactly ten pairwise records');
select pg_temp.assert_true((select count(*)=10 and bool_and(decision='APPROVED' and invalidated_at is null) from public.ap_job_release_reviews where search_service_id='a4600000-0000-4000-8000-000000000001'), 'per-job human release review missing');
select pg_temp.assert_true((select count(*)=1 and bool_and(decision='APPROVED' and cardinality(evaluation_ids)=10) from public.ap_search_package_reviews where search_service_id='a4600000-0000-4000-8000-000000000001'), 'package human release review missing');
select pg_temp.assert_true((select fulfillment='DELIVERED' and revenue_earned_at is not null from public.ap_search_services where id='a4600000-0000-4000-8000-000000000001'), 'revenue was not earned only at immutable release');
select pg_temp.assert_true((select status='delivered' and delivered_at is not null from public.orders where id='94000000-0000-4000-8000-000000000001'), 'legacy order projection was not delivered');
select pg_temp.assert_true((select lifecycle='COMPLETED' and debit_disposition='SPENT' from public.ap_capacity_allocations where id=(select capacity_allocation_id from public.ap_search_services where id='a4600000-0000-4000-8000-000000000001')), 'release did not complete spent capacity');
select pg_temp.assert_true((select count(*)=10 and bool_and(release_explanation ?& array['whatJobInvolves','whyMadeList','howExperienceConnects','whatMayBeNew','whatToKnow']) from public.job_matches where search_order_id='94000000-0000-4000-8000-000000000001'), 'five-section customer explanations missing');
select pg_temp.assert_true((select count(*)=1 from public.ap_outbox_messages where id='a4900000-0000-4000-8000-000000000010' and state='QUEUED' and message_kind='SEARCH_EXACT_TEN_DELIVERED'), 'delivery outbox message missing');

savepoint before_search_postdelivery_dispute;
select public.ap_apply_search_dispute(
  'evt_chunk4_search_delivered_open',repeat('7',64),clock_timestamp(),'pi_chunk4_fixture','OPEN',
  'a4900000-0000-4000-8000-000000000072'
);
select pg_temp.assert_true((select fulfillment='DELIVERED' and revenue_earned_at is not null
  from public.ap_search_services where id='a4600000-0000-4000-8000-000000000001'),
  'open post-delivery dispute mutated the immutable search release');
savepoint before_search_dispute_lost;
select public.ap_apply_search_dispute(
  'evt_chunk4_search_delivered_lost',repeat('8',64),clock_timestamp(),'pi_chunk4_fixture','LOST',
  'a4900000-0000-4000-8000-000000000073'
);
select pg_temp.assert_true((select dispute='LOST' and funds_reversed_at is not null and settlement='PAID'
  from public.ap_payment_attempts where id='a4500000-0000-4000-8000-000000000001'),
  'lost search dispute did not preserve paid settlement with provider reversal');
select pg_temp.assert_true(not exists(select 1 from public.ap_refund_operations
  where payment_attempt_id='a4500000-0000-4000-8000-000000000001'),
  'lost post-delivery dispute created a second refund');
rollback to savepoint before_search_dispute_lost;
select public.ap_apply_search_dispute(
  'evt_chunk4_search_delivered_won',repeat('9',64),clock_timestamp(),'pi_chunk4_fixture','WON',
  'a4900000-0000-4000-8000-000000000074'
);
select pg_temp.assert_true((select dispute='WON' and funds_secured_at is not null and settlement='PAID'
  from public.ap_payment_attempts where id='a4500000-0000-4000-8000-000000000001'),
  'won search dispute did not preserve paid settlement');
select pg_temp.assert_true(not exists(select 1 from public.ap_refund_operations
  where payment_attempt_id='a4500000-0000-4000-8000-000000000001'),
  'won post-delivery dispute refunded an immutable release');
rollback to savepoint before_search_postdelivery_dispute;

savepoint before_material_dispute;
insert into public.ap_capacity_pools(id,resource,enabled,configuration_version)
values('a5000000-0000-4000-8000-000000000001','MATERIALS',true,'chunk4-material-dispute-v1')
on conflict(resource) do update set enabled=true,configuration_version=excluded.configuration_version;
insert into public.ap_capacity_buckets(id,pool_id,starts_at,ends_at,total_units,staffing_version)
values('a5100000-0000-4000-8000-000000000001',
  (select id from public.ap_capacity_pools where resource='MATERIALS'),
  clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 days',3,'fixture-material-staffing-v1');
insert into public.ap_payment_attempts(
  id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,payment_verified_at,
  provider_payment_status,payment_method_type,immediate_charge_verified
) values(
  'a5200000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001',
  'stripe','pi_chunk4_material_fixture',2400,'USD','PAID',clock_timestamp()-interval '30 minutes',
  'succeeded','card',true
);
insert into public.ap_material_purchases(id,customer_id,payment_attempt_id,amount_cents,currency)
values('a5300000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001',
  'a5200000-0000-4000-8000-000000000001',2400,'USD');
insert into public.ap_material_lines(
  id,purchase_id,delivered_order_id,delivered_match_id,payment_attempt_id,payment_allocation_key,
  allocated_amount_cents,fulfillment,selection_confirmed_at,materials_payment_verified_at,
  materials_capacity_confirmed_at,materials_started_at,materials_due_at,earned_revenue_at
)
select
  ('a5400000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  'a5300000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001',match.id,
  'a5200000-0000-4000-8000-000000000001','material-allocation-'||g,800,
  case when g=1 then 'DELIVERED'::public.ap_material_fulfillment
    when g=2 then 'GENERATING'::public.ap_material_fulfillment else 'PAID'::public.ap_material_fulfillment end,
  statement_timestamp()-interval '30 minutes',statement_timestamp()-interval '30 minutes',
  case when g<3 then statement_timestamp()-interval '29 minutes' else null end,
  case when g<3 then statement_timestamp()-interval '29 minutes' else null end,
  case when g<3 then statement_timestamp()-interval '29 minutes'+interval '24 hours' else null end,
  case when g=1 then statement_timestamp()-interval '5 minutes' else null end
from generate_series(1,3) g
join public.job_matches match on match.search_order_id='94000000-0000-4000-8000-000000000001'
  and match.position=g;
insert into public.ap_material_entitlement_history(
  id,line_id,delivered_order_id,delivered_match_id,state
)
select
  ('a5500000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,line.id,
  line.delivered_order_id,line.delivered_match_id,'PAID'
from generate_series(1,3) g
join public.ap_material_lines line on line.id=('a5400000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid;
insert into public.ap_material_entitlement_claims(delivered_order_id,delivered_match_id,entitlement_history_id)
select delivered_order_id,delivered_match_id,id from public.ap_material_entitlement_history
where id in (
  'a5500000-0000-4000-8000-000000000001','a5500000-0000-4000-8000-000000000002',
  'a5500000-0000-4000-8000-000000000003'
);
insert into public.ap_releases(
  id,customer_id,order_id,material_line_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by
) values(
  'a5600000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','a5400000-0000-4000-8000-000000000001',
  'MATERIAL_PAIR',clock_timestamp()-interval '5 minutes',clock_timestamp()+interval '1 hour',
  '{"fixture":"chunk4-material-delivered"}','14000000-0000-4000-8000-000000000003'
);
insert into public.ap_capacity_allocations(
  id,bucket_id,customer_id,units,lifecycle,debit_disposition,order_id,material_line_id,
  request_key,staffing_version,reserved_at,consumed_at,expires_at,audit_version
) values
  ('a5700000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',1,'COMPLETED','SPENT',
    '94000000-0000-4000-8000-000000000001','a5400000-0000-4000-8000-000000000001',
    'material-dispute-line-1','fixture-material-staffing-v1',clock_timestamp()-interval '30 minutes',
    clock_timestamp()-interval '29 minutes',null,'chunk4-v1'),
  ('a5700000-0000-4000-8000-000000000002','a5100000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',1,'CONSUMED','SPENT',
    '94000000-0000-4000-8000-000000000001','a5400000-0000-4000-8000-000000000002',
    'material-dispute-line-2','fixture-material-staffing-v1',clock_timestamp()-interval '30 minutes',
    clock_timestamp()-interval '29 minutes',null,'chunk4-v1'),
  ('a5700000-0000-4000-8000-000000000003','a5100000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001',1,'RESERVED','HELD',
    '94000000-0000-4000-8000-000000000001','a5400000-0000-4000-8000-000000000003',
    'material-dispute-line-3','fixture-material-staffing-v1',clock_timestamp()-interval '5 minutes',
    null,clock_timestamp()+interval '25 minutes','chunk4-v1');
select pg_temp.assert_true(public.ap_capacity_available('a5100000-0000-4000-8000-000000000001')=0,
  'material capacity did not subtract HELD plus SPENT before dispute');

select public.ap_apply_search_dispute(
  'evt_chunk4_material_open',repeat('a',64),clock_timestamp(),'pi_chunk4_material_fixture','OPEN',
  'a5800000-0000-4000-8000-000000000001'
);
select pg_temp.assert_true((select fulfillment='DELIVERED' and earned_revenue_at is not null
  from public.ap_material_lines where id='a5400000-0000-4000-8000-000000000001'),
  'material dispute mutated a delivered line or earned revenue');
select pg_temp.assert_true((select count(*)=2 and bool_and(fulfillment='CANCELED')
  from public.ap_material_lines where id in ('a5400000-0000-4000-8000-000000000002','a5400000-0000-4000-8000-000000000003')),
  'open material dispute did not cancel every undelivered line');
select pg_temp.assert_true((select lifecycle='SUPERSEDED' and debit_disposition='SPENT'
  from public.ap_capacity_allocations where id='a5700000-0000-4000-8000-000000000002'),
  'consumed undelivered material capacity did not remain spent');
select pg_temp.assert_true((select lifecycle='RELEASED' and debit_disposition='RETURNED'
  from public.ap_capacity_allocations where id='a5700000-0000-4000-8000-000000000003'),
  'never-consumed material capacity was not returned');
select pg_temp.assert_true(public.ap_capacity_available('a5100000-0000-4000-8000-000000000001')=1,
  'material capacity accounting after dispute is not total minus HELD minus SPENT');
select pg_temp.assert_true((select count(*)=2 from public.ap_material_entitlement_history history
  where history.line_id in ('a5400000-0000-4000-8000-000000000002','a5400000-0000-4000-8000-000000000003')
    and history.state='DISPUTED'), 'undelivered material entitlements did not enter immutable disputed history');
select pg_temp.assert_true(not exists(select 1 from public.ap_refund_operations
  where payment_attempt_id='a5200000-0000-4000-8000-000000000001'),
  'open material dispute initiated a second merchant refund');

savepoint before_material_dispute_lost;
select public.ap_apply_search_dispute(
  'evt_chunk4_material_lost',repeat('b',64),clock_timestamp(),'pi_chunk4_material_fixture','LOST',
  'a5800000-0000-4000-8000-000000000002'
);
select pg_temp.assert_true((select dispute='LOST' and funds_reversed_at is not null and settlement='PAID'
  from public.ap_payment_attempts where id='a5200000-0000-4000-8000-000000000001'),
  'lost material dispute did not record provider reversal without corrupting settlement');
select pg_temp.assert_true(not exists(select 1 from public.ap_refund_operations
  where payment_attempt_id='a5200000-0000-4000-8000-000000000001'),
  'lost material dispute created a second refund');
rollback to savepoint before_material_dispute_lost;

select public.ap_apply_search_dispute(
  'evt_chunk4_material_won',repeat('c',64),clock_timestamp(),'pi_chunk4_material_fixture','WON',
  'a5800000-0000-4000-8000-000000000003'
);
select pg_temp.assert_true((select count(*)=2 and sum(amount_cents)=1600 and bool_and(state='PENDING')
  from public.ap_refund_operations where payment_attempt_id='a5200000-0000-4000-8000-000000000001'
    and scope='MATERIAL_LINE' and superseded_at is null),
  'won material dispute did not queue exactly one refund per undelivered line');
select pg_temp.assert_true(not exists(select 1 from public.ap_refund_operations
  where material_line_id='a5400000-0000-4000-8000-000000000001'),
  'won material dispute refunded a delivered immutable line');
select pg_temp.assert_true((select count(*)=2 from public.ap_material_entitlement_history history
  where history.line_id in ('a5400000-0000-4000-8000-000000000002','a5400000-0000-4000-8000-000000000003')
    and history.state='REFUND_PENDING'), 'won material dispute did not record per-line refund processing');
select public.ap_apply_search_dispute(
  'evt_chunk4_material_won',repeat('c',64),clock_timestamp(),'pi_chunk4_material_fixture','WON',
  'a5800000-0000-4000-8000-000000000009'
);
select pg_temp.assert_true((select count(*)=2 from public.ap_refund_operations
  where payment_attempt_id='a5200000-0000-4000-8000-000000000001'),
  'material dispute replay duplicated refunds');
select public.ap_record_search_refund_result(
  (select id from public.ap_refund_operations where material_line_id='a5400000-0000-4000-8000-000000000002'),
  're_chunk4_material_2','succeeded',null,null,null,null,null
);
select public.ap_record_search_refund_result(
  (select id from public.ap_refund_operations where material_line_id='a5400000-0000-4000-8000-000000000003'),
  're_chunk4_material_3','failed',null,'provider_declined',null,null,null
);
select pg_temp.assert_true((select settlement='PAID' and dispute='WON'
  from public.ap_payment_attempts where id='a5200000-0000-4000-8000-000000000001'),
  'scoped material refund results corrupted paid settlement');
select pg_temp.assert_true((select count(*)=1 from public.ap_refund_operations
  where payment_attempt_id='a5200000-0000-4000-8000-000000000001' and state='SUCCEEDED')
  and (select count(*)=1 from public.ap_refund_operations
  where payment_attempt_id='a5200000-0000-4000-8000-000000000001' and state='FAILED'),
  'material payment did not coexist with scoped succeeded and failed refunds');
do $$
declare refund_id uuid; completed_before timestamptz; first_replay jsonb; second_replay jsonb;
begin
  select id,completed_at into refund_id,completed_before from public.ap_refund_operations
    where material_line_id='a5400000-0000-4000-8000-000000000002';
  first_replay:=public.ap_record_search_refund_result(
    refund_id,'re_chunk4_material_2','succeeded','evt_chunk4_refund_success_replay',null,
    repeat('d',64),clock_timestamp(),'refund.updated'
  );
  perform pg_temp.assert_true((first_replay->>'ignoredStale')::boolean
    and (select completed_at=completed_before from public.ap_refund_operations where id=refund_id),
    'terminal refund event changed the immutable completion time');
  second_replay:=public.ap_record_search_refund_result(
    refund_id,'re_chunk4_material_2','succeeded','evt_chunk4_refund_success_replay',null,
    repeat('d',64),clock_timestamp(),'refund.updated'
  );
  perform pg_temp.assert_true((second_replay->>'replayed')::boolean
    and (select count(*)=1 from public.ap_provider_events where provider_event_id='evt_chunk4_refund_success_replay'),
    'refund webhook replay was not durable and idempotent');
end;
$$;
do $$
declare refund_id uuid; old_command_id uuid; new_command_id uuid; retried jsonb; completed jsonb;
begin
  select id,provider_command_id into refund_id,old_command_id from public.ap_refund_operations
    where material_line_id='a5400000-0000-4000-8000-000000000003';
  retried:=public.ap_retry_search_refund(refund_id,'14000000-0000-4000-8000-000000000003');
  select provider_command_id into new_command_id from public.ap_refund_operations where id=refund_id;
  perform pg_temp.assert_true(retried->>'state'='PENDING'
    and (select state='PENDING' and retry_count=1 and provider_refund_id is null
      from public.ap_refund_operations where id=refund_id)
    and old_command_id<>new_command_id
    and (select provider_object_id='re_chunk4_material_3' and state='APPLIED'
      from public.ap_external_commands where id=old_command_id),
    'failed refund retry did not preserve the old attempt and clear the active provider binding');
  completed:=public.ap_record_search_refund_result(
    refund_id,'re_chunk4_material_3_retry_1','succeeded','evt_chunk4_refund_retry_succeeded',null,
    repeat('e',64),clock_timestamp(),'refund.updated'
  );
  perform pg_temp.assert_true(completed->>'state'='SUCCEEDED'
    and (select state='SUCCEEDED' and provider_refund_id='re_chunk4_material_3_retry_1'
      from public.ap_refund_operations where id=refund_id)
    and (select state='APPLIED' and provider_object_id='re_chunk4_material_3_retry_1'
      and reconciliation_state='RECONCILED' from public.ap_external_commands where id=new_command_id),
    'retried refund did not bind and reconcile the new provider attempt');
end;
$$;
select pg_temp.assert_true(not exists(select 1 from public.ap_material_entitlement_claims claim
  join public.ap_material_entitlement_history history on history.id=claim.entitlement_history_id
  where history.line_id in ('a5400000-0000-4000-8000-000000000002','a5400000-0000-4000-8000-000000000003')),
  'successfully refunded material entitlement claims were not released');
select pg_temp.assert_true((select count(*)=1 from public.ap_releases
  where material_line_id='a5400000-0000-4000-8000-000000000001')
  and (select earned_revenue_at is not null from public.ap_material_lines
  where id='a5400000-0000-4000-8000-000000000001'),
  'mixed-scope refunds mutated the delivered material release');
rollback to savepoint before_material_dispute;

select pg_temp.assert_true((public.ap_chunk4_monitor_snapshot() ?& array['capacityHeld','capacitySpent','webhookFailures','webhookDispatcherFailures','webhooksPending','webhookDispatcherPending','oldestWebhookLagSeconds','ordersApproachingDeadline','ordersPastDeadline','adjustmentsAwaitingResponse','refundFailures','outboxDeadLetters','staleReviews','leasedJobsOverdue']), 'monitor snapshot is incomplete');

select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=1 from public.ap_search_services), 'customer could not see own search service');
select pg_temp.assert_true((select count(*)=1 from public.ap_search_deadline_history), 'customer could not see own deadline history');
reset role;
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.ap_search_services), 'other customer saw protected search service');
select pg_temp.assert_true((select count(*)=0 from public.ap_search_deadline_history), 'other customer saw protected deadline history');
reset role;

rollback;
