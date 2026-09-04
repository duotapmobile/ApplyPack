begin;

create function pg_temp.assert_true(value boolean, failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%', failure_message; end if; end $$;

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','one@example.invalid','',now(),'{}','{}',now(),now()),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','two@example.invalid','',now(),'{}','{}',now(),now());

insert into public.intakes(id, customer_id, email, direction, dealbreakers, location_preference, schedule_preference, experience_summary, resume_path, status, source_scan_status)
values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','one@example.invalid','Operations','None','Remote','Weekdays','Confirmed','one/resume.pdf','ready_for_payment','clean'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','two@example.invalid','Support','None','Remote','Weekdays','Confirmed','two/resume.pdf','ready_for_payment','clean');

select * from public.ap_create_anonymous_draft('30000000-0000-4000-8000-000000000001', repeat('a',64), now() + interval '1 day');
select pg_temp.assert_true((select count(*) = 1 from public.ap_read_anonymous_draft('30000000-0000-4000-8000-000000000001', repeat('a',64))), 'valid draft capability denied');
select pg_temp.assert_true((select count(*) = 0 from public.ap_read_anonymous_draft('30000000-0000-4000-8000-000000000001', repeat('b',64))), 'guessed draft secret authorized');
select pg_temp.assert_true((select version = 2 and current_step = 2 from public.ap_save_anonymous_draft('30000000-0000-4000-8000-000000000001', repeat('a',64), 1, 2, '{"partial":"saved"}')), 'progressive draft save failed');
do $$ begin
  perform public.ap_save_anonymous_draft('30000000-0000-4000-8000-000000000001', repeat('a',64), 1, 3, '{}');
  raise exception 'stale draft write was accepted';
exception when serialization_failure then
  if sqlerrm <> 'draft_version_conflict' then raise; end if;
end $$;

select * from public.ap_register_anonymous_document('30000000-0000-4000-8000-000000000001', repeat('a',64), 2, '40000000-0000-4000-8000-000000000001', 'RESUME', 'resume.pdf', 'anonymous/30000000-0000-4000-8000-000000000001/resume/one.pdf', 128, 'application/pdf', 'application/pdf', repeat('1',64));
select * from public.ap_register_anonymous_document('30000000-0000-4000-8000-000000000001', repeat('a',64), 3, '40000000-0000-4000-8000-000000000002', 'RESUME', 'resume.pdf', 'anonymous/30000000-0000-4000-8000-000000000001/resume/two.pdf', 129, 'application/pdf', 'application/pdf', repeat('2',64));
select pg_temp.assert_true((select count(*) = 2 and count(*) filter(where is_current) = 1 and count(*) filter(where processing_state='SUPERSEDED') = 1 from public.ap_document_versions where draft_id='30000000-0000-4000-8000-000000000001'), 'document replacement overwrote history');
select pg_temp.assert_true(not public.ap_apply_document_pipeline_result('40000000-0000-4000-8000-000000000001',1,'READY','CLEAN','SUCCEEDED','CLEAR','CLEAR','fixture','{}','policy',null), 'stale extraction updated superseded document');

insert into public.ap_document_versions(id,intake_id,customer_id,kind,version,processing_state,is_current,safe_display_name,storage_bucket,storage_path,size_bytes,claimed_mime_type,verified_mime_type,sha256)
values
 ('40000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','RESUME',1,'QUARANTINED',true,'resume.pdf','customer-source-documents','one/v1.pdf',100,'application/pdf','application/pdf',repeat('3',64)),
 ('40000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','RESUME',1,'QUARANTINED',true,'resume.pdf','customer-source-documents','two/v1.pdf',100,'application/pdf','application/pdf',repeat('4',64));

insert into public.ap_intake_snapshots(id,intake_id,customer_id,parent_snapshot_id,version,snapshot_kind,access_email_normalized,payer_receipt_email,document_contact_email,desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,schedules,travel,benefits,dealbreakers,salary_target_cents,salary_hard_minimum_cents,salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at)
values
 ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',null,1,'INITIAL','one@example.invalid',null,'one@example.invalid','[]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',6000000,5000000,false,'YEAR','BASE','PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',repeat('5',64),'applypack-c14n-v1','applypack-foundation-v1',now()),
 ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',null,1,'INITIAL','two@example.invalid',null,'two@example.invalid','[]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','DC','["FULL_TIME"]','[]','{}','{}','[]',6000000,5000000,false,'YEAR','BASE','PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',repeat('6',64),'applypack-c14n-v1','applypack-foundation-v1',now()),
 ('50000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',2,'PRE_ACTIVATION_EDIT','one@example.invalid',null,'one@example.invalid','[]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',6100000,5100000,false,'YEAR','BASE','PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',repeat('7',64),'applypack-c14n-v1','applypack-foundation-v1',now());

do $$ begin
  update public.ap_intake_snapshots set salary_target_cents=1 where id='50000000-0000-4000-8000-000000000001';
  raise exception 'immutable snapshot changed';
exception when others then if sqlerrm='immutable snapshot changed' then raise; end if; end $$;

insert into public.ap_sensitive_payloads(id,customer_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
values ('5f000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',decode('0102','hex'),'AES-256-GCM',decode(repeat('11',32),'hex'),decode(repeat('22',12),'hex'),decode(repeat('33',16),'hex'),repeat('f',64),'fixture-kms','1',repeat('e',64));
insert into public.ap_independent_verification_sources(id,customer_id,encrypted_payload_id,source_type,source_locator,content_sha256,reviewer_id,verified_at)
values ('5f000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000001','LICENSE_REGISTRY','registry record',repeat('d',64),'10000000-0000-4000-8000-000000000002',now());
insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,source_locator,extraction_confidence,verification,catalog_version,schema_version)
values
 ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','title','string','{"value":"Coordinator"}','DOCUMENT','40000000-0000-4000-8000-000000000011','page 1 line 1',.9,'EXTRACTED_UNCONFIRMED','v1','v1'),
 ('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002','title','string','{"value":"Analyst"}','DOCUMENT','40000000-0000-4000-8000-000000000012','page 1 line 1',.9,'CUSTOMER_REJECTED','v1','v1');
insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,supplied_source_id,source_locator,human_reviewer_id,verification,catalog_version,schema_version)
values ('60000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','license','credential','{"value":"active"}','HUMAN_VERIFICATION','5f000000-0000-4000-8000-000000000002','registry record','10000000-0000-4000-8000-000000000002','HUMAN_VERIFIED','v1','v1');
insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,catalog_version,schema_version)
values ('60000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','capability','capability','{"status":"CAN_DO_NOW"}','CUSTOMER_ASSERTION','50000000-0000-4000-8000-000000000001','capability-control','intake control','CUSTOMER_CONFIRMED','v1','v1');
update public.ap_candidate_facts set verification='CUSTOMER_CONFIRMED',confirmed_or_corrected_at=now() where id='60000000-0000-4000-8000-000000000001';
update public.ap_candidate_facts set verification='DISPUTED' where id='60000000-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,confirmed_or_corrected_at,catalog_version,schema_version,supersedes_fact_id)
values ('60000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','title','string','{"value":"Senior Coordinator"}','CUSTOMER_ASSERTION','50000000-0000-4000-8000-000000000001','title-correction-control','intake correction','CUSTOMER_CONFIRMED',now(),'v1','v1','60000000-0000-4000-8000-000000000001');
insert into public.ap_candidate_fact_conflicts(fact_id,conflicting_fact_id,resolution,resolved_by,resolved_at)
values ('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000005','CUSTOMER_CORRECTION','10000000-0000-4000-8000-000000000001',now());
update public.ap_candidate_facts set superseded_at=now() where id='60000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select verification='DISPUTED' and superseded_at is not null from public.ap_candidate_facts where id='60000000-0000-4000-8000-000000000001'),'customer correction did not preserve and supersede disputed extraction');
select pg_temp.assert_true((select count(*)=1 from public.ap_candidate_fact_conflicts where fact_id='60000000-0000-4000-8000-000000000001' and resolution='CUSTOMER_CORRECTION'),'customer correction conflict history missing');
do $$ begin update public.ap_candidate_facts set verification='CUSTOMER_CONFIRMED' where id='60000000-0000-4000-8000-000000000003'; raise exception 'human verification was downgraded'; exception when others then if sqlerrm='human verification was downgraded' then raise; end if; end $$;
do $$ begin
  insert into public.ap_candidate_facts(customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,source_locator,verification,catalog_version,schema_version)
  values ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','bad','string','{}','DOCUMENT','40000000-0000-4000-8000-000000000011','line','HUMAN_VERIFIED','v1','v1');
  raise exception 'document text became human verified';
exception when check_violation then null; end $$;

insert into public.ap_experience_identities(customer_id,kind,label,starts_on,ends_on,calendar_duration_days,intensity_percent,occupational_credit_eligible,source_fact_id)
values ('10000000-0000-4000-8000-000000000001','CAREGIVING','Caregiving','2024-01-01','2024-12-31',366,100,false,'60000000-0000-4000-8000-000000000001');
do $$ begin
  insert into public.ap_experience_identities(customer_id,kind,label,occupational_credit_eligible,source_fact_id)
  values ('10000000-0000-4000-8000-000000000001','CAREGIVING','Invalid',true,'60000000-0000-4000-8000-000000000001');
  raise exception 'caregiving received occupational credit';
exception when check_violation then null; end $$;

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=4 from public.ap_candidate_facts), 'cross-customer candidate fact exposed');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ap_document_versions','select'), 'direct file table access granted');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ap_job_snapshots','select'), 'direct job snapshot access granted');
reset role;

insert into public.ap_capacity_pools(id,resource,enabled,configuration_version) values ('70000000-0000-4000-8000-000000000001','SEARCH',true,'staff-v1');
insert into public.ap_capacity_buckets(id,pool_id,starts_at,ends_at,total_units,staffing_version) values
 ('71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',now()-interval '1 hour',now()+interval '1 hour',4,'staff-v1');
select public.ap_reserve_capacity('10000000-0000-4000-8000-000000000001','SEARCH',2,'reserve-1',now()+interval '30 minutes','[]');
select pg_temp.assert_true(public.ap_capacity_available('71000000-0000-4000-8000-000000000001')=2,'held capacity not debited');
update public.ap_capacity_allocations set lifecycle='CONSUMED',debit_disposition='SPENT',consumed_at=now() where request_key='reserve-1';
update public.ap_capacity_allocations set lifecycle='COMPLETED' where request_key='reserve-1';
do $$ begin perform public.ap_release_unconsumed_capacity((select id from public.ap_capacity_allocations where request_key='reserve-1'),'bad'); raise exception 'spent capacity returned'; exception when others then if sqlerrm='spent capacity returned' then raise; end if; end $$;
insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
values ('72000000-0000-4000-8000-000000000001',now(),'sources-v1','query-v1','parser-v1',repeat('e',64));
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
values
 ('73000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','v1','{}','REQUIRED',repeat('1',64)),
 ('73000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001','v1','{}','REQUIRED',repeat('2',64));
insert into public.ap_feasibility_coverage_cells(plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,result_bound,execution_path,terminal_outcome,cursor_or_stop_reason,result_count,parser_result,started_at,completed_at)
values
 ('73000000-0000-4000-8000-000000000001','manual-reviewed','AUTHORIZED_MANUAL_ONLY',repeat('a',64),1,interval '1 day',20,'MANUAL','SUCCEEDED_WITH_RESULTS','fixture-complete',12,'{}',now(),now()),
 ('73000000-0000-4000-8000-000000000002','manual-reviewed','AUTHORIZED_MANUAL_ONLY',repeat('b',64),1,interval '1 day',20,'MANUAL','SUCCEEDED_WITH_RESULTS','fixture-complete',12,'{}',now(),now());
insert into public.ap_feasibility_assessments(id,snapshot_id,coverage_plan_id,state,outcome,resolution_blocker,preliminarily_deliverable_count,reviewable_count,excluded_count,rules_version)
values
 ('74000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','COMPLETE','LIKELY','NONE',12,2,3,'rules-v1'),
 ('74000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003','73000000-0000-4000-8000-000000000002','COMPLETE','LIKELY','NONE',12,2,3,'rules-v1');
do $$ begin
  insert into public.ap_feasibility_assessments(snapshot_id,coverage_plan_id,state,outcome,resolution_blocker,preliminarily_deliverable_count,reviewable_count,excluded_count,rules_version)
  values ('50000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','COMPLETE','LIKELY','NONE',9,1,3,'rules-v1');
  raise exception 'inconsistent feasibility outcome accepted';
exception when check_violation then null; end $$;
insert into public.ap_quotes(id,customer_id,snapshot_id,feasibility_assessment_id,price_cents,currency,tax_inclusive,content_sha256,expires_at)
values
 ('75000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001',2000,'USD',true,repeat('3',64),now()+interval '1 hour'),
 ('75000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','74000000-0000-4000-8000-000000000002',2000,'USD',true,repeat('4',64),now()+interval '1 hour');
insert into public.ap_human_review_records(customer_id,reviewer_id,snapshot_id,review_kind,rationale,catalog_version,decision)
values ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001','FEASIBILITY','fixture rationale','v1','{}');
select public.ap_reserve_capacity('10000000-0000-4000-8000-000000000001','SEARCH',1,'reserve-pre-edit',now()+interval '30 minutes','[]');
update public.ap_capacity_allocations set criteria_revision_id='50000000-0000-4000-8000-000000000001' where request_key='reserve-pre-edit';
select public.ap_invalidate_pre_activation_snapshot('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','PRE_ACTIVATION_EDIT');
select pg_temp.assert_true((select invalidated_at is not null from public.ap_feasibility_assessments where id='74000000-0000-4000-8000-000000000001'),'pre-activation feasibility remained valid');
select pg_temp.assert_true((select invalidated_at is not null from public.ap_quotes where id='75000000-0000-4000-8000-000000000001'),'pre-activation quote remained valid');
select pg_temp.assert_true((select lifecycle='SUPERSEDED' and debit_disposition='RETURNED' from public.ap_capacity_allocations where request_key='reserve-pre-edit'),'pre-activation held capacity did not return');

insert into public.ap_payment_attempts(id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,payment_verified_at)
values
 ('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','stripe','pi_chunk1_search',2000,'USD','PAID','NONE',now()),
 ('80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','stripe','pi_chunk1_materials',1600,'USD','PAID','NONE',now()),
 ('80000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','stripe','pi_chunk1_other',2000,'USD','PAID','NONE',now()),
 ('80000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','stripe','pi_chunk1_full_refund',2000,'USD','PAID','NONE',now()),
 ('80000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','stripe','pi_chunk1_duplicate_refund',2000,'USD','PAID','NONE',now()),
 ('80000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','stripe','pi_chunk1_stale_refund',2000,'USD','PAID','NONE',now());
insert into public.ap_refund_operations(customer_id,payment_attempt_id,scope,amount_cents,currency,idempotency_key,state,required,completed_at)
values
 ('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000004','FULL_SEARCH',2000,'USD','refund-full-search','SUCCEEDED',true,now()),
 ('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000005','DUPLICATE_ATTEMPT',2000,'USD','refund-duplicate','PENDING',true,null),
 ('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000006','STALE_ATTEMPT',2000,'USD','refund-stale','FAILED',true,null);
select pg_temp.assert_true((select refund_aggregate='FULL' and refunded_amount_cents=2000 from public.ap_payment_refund_aggregates where payment_attempt_id='80000000-0000-4000-8000-000000000004'),'full-search refund aggregate incorrect');
select pg_temp.assert_true((select refund_aggregate='PENDING' from public.ap_payment_refund_aggregates where payment_attempt_id='80000000-0000-4000-8000-000000000005'),'duplicate refund aggregate incorrect');
select pg_temp.assert_true((select refund_aggregate='FAILED' from public.ap_payment_refund_aggregates where payment_attempt_id='80000000-0000-4000-8000-000000000006'),'stale refund failure aggregate incorrect');
do $$ begin
  insert into public.ap_refund_operations(customer_id,payment_attempt_id,scope,amount_cents,currency,idempotency_key,state,required,completed_at)
  values ('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','DUPLICATE_ATTEMPT',800,'USD','refund-invalid-partial-attempt','SUCCEEDED',true,now());
  raise exception 'partial full-attempt refund accepted';
exception when others then
  if sqlerrm='partial full-attempt refund accepted' then raise; end if;
  if sqlerrm<>'full_attempt_refund_amount_mismatch' then raise; end if;
end $$;
select pg_temp.assert_true((select settlement='PAID' from public.ap_payment_attempts where id='80000000-0000-4000-8000-000000000001'),'refund records changed paid settlement');
update public.ap_payment_attempts set dispute='OPEN',dispute_opened_at=now() where id='80000000-0000-4000-8000-000000000001';
update public.ap_payment_attempts set dispute='WON',dispute_resolved_at=now(),funds_secured_at=now() where id='80000000-0000-4000-8000-000000000001';

select public.ap_reserve_capacity('10000000-0000-4000-8000-000000000001','SEARCH',1,'reserve-checkout',now()+interval '30 minutes','[]');
update public.ap_capacity_allocations set criteria_revision_id='50000000-0000-4000-8000-000000000003' where request_key='reserve-checkout';
insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key)
values ('81000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','CREATE_CHECKOUT','stripe',repeat('8',64),'checkout-command-1');
do $$ begin
  insert into public.ap_checkout_attempts(customer_id,quote_id,command_id,capacity_allocation_id,state,provider_checkout_session_id,expires_at)
  values ('10000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001',(select id from public.ap_capacity_allocations where request_key='reserve-checkout'),'OPEN','cs_unapproved',now()+interval '20 minutes');
  raise exception 'checkout opened without approved tax configuration';
exception when others then if sqlerrm='checkout opened without approved tax configuration' then raise; end if; end $$;
update public.ap_commerce_configuration set tax_configuration_approved=true,tax_approval_reference='test-approval';
insert into public.ap_checkout_attempts(customer_id,quote_id,command_id,capacity_allocation_id,state,provider_checkout_session_id,expires_at)
values ('10000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001',(select id from public.ap_capacity_allocations where request_key='reserve-checkout'),'OPEN','cs_approved',now()+interval '20 minutes');
select pg_temp.assert_true(not (select cleanup_enabled from public.ap_retention_configuration),'retention cleanup enabled without approved durations');
do $$ begin
  perform public.ap_claim_retention_cleanup('worker-retention',10);
  raise exception 'retention cleanup ran without approval';
exception when others then
  if sqlerrm='retention cleanup ran without approval' then raise; end if;
  if sqlerrm<>'retention_cleanup_disabled_unapproved' then raise; end if;
end $$;

insert into public.ap_provider_events(provider,provider_event_id,event_type,payload_sha256,signature_verified_at)
values ('stripe','evt_chunk1','payment_intent.succeeded',repeat('9',64),now());
do $$ begin
  insert into public.ap_provider_events(provider,provider_event_id,event_type,payload_sha256,signature_verified_at)
  values ('stripe','evt_chunk1','duplicate',repeat('9',64),now());
  raise exception 'duplicate provider event accepted';
exception when unique_violation then null; end $$;
insert into public.ap_outbox_messages(customer_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key)
values ('10000000-0000-4000-8000-000000000001','RECEIPT','opaque-recipient','receipt:1','email:1');
do $$ begin
  insert into public.ap_outbox_messages(customer_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key)
  values ('10000000-0000-4000-8000-000000000001','RECEIPT','opaque-recipient','receipt:1','email:2');
  raise exception 'outbox deduplication failed';
exception when unique_violation then null; end $$;

insert into public.ap_job_snapshots(id,origin,discovery_source,canonical_application_url,application_host_type,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_on,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256)
values ('82000000-0000-4000-8000-000000000001','APPLYPACK_FOUND','fixture','https://example.invalid/apply','EMPLOYER_HOSTED','https://example.invalid/job','Example','Coordinator',repeat('a',64),'{}',now(),null,true,now(),'{}','v1',repeat('b',64));
do $$ begin
  insert into public.ap_job_snapshots(origin,discovery_source,canonical_application_url,application_host_type,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_on,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256)
  values ('CUSTOMER_SUPPLIED','fixture','https://example.invalid/customer','EMPLOYER_HOSTED','https://example.invalid/customer','Example','Customer Job',repeat('c',64),'{}',now(),null,true,now(),'{}','v1',repeat('d',64));
  raise exception 'customer supplied ingestion enabled by default';
exception when others then if sqlerrm='customer supplied ingestion enabled by default' then raise; end if; end $$;

insert into public.orders(id,customer_id,intake_id,product_kind,amount_cents,status,paid_at,delivered_at)
values
 ('90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','job_search',2000,'delivered',now(),now()),
 ('90000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','job_search',2000,'delivered',now(),now());
insert into public.jobs(id,company,title,source_url,checked_at) values ('91000000-0000-4000-8000-000000000001','Example','Coordinator','https://example.invalid/job',now());
insert into public.job_matches(id,search_order_id,job_id,position,fit_summary) values ('92000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',1,'fixture');
insert into public.ap_intake_snapshots
select (jsonb_populate_record(null::public.ap_intake_snapshots, to_jsonb(s) || jsonb_build_object(
  'id','50000000-0000-4000-8000-000000000004','parent_snapshot_id','50000000-0000-4000-8000-000000000003',
  'version',3,'snapshot_kind','SEARCH_ADJUSTMENT','content_sha256',repeat('8',64),'finalized_at',now(),'created_at',now()
))).* from public.ap_intake_snapshots s where s.id='50000000-0000-4000-8000-000000000003';
select public.ap_reserve_capacity('10000000-0000-4000-8000-000000000001','SEARCH',1,'reserve-adjustment',now()+interval '30 minutes','[]');
update public.ap_capacity_allocations set criteria_revision_id='50000000-0000-4000-8000-000000000003' where request_key='reserve-adjustment';
insert into public.ap_search_services(id,legacy_order_id,customer_id,quote_id,winning_payment_attempt_id,original_snapshot_id,active_snapshot_id,capacity_allocation_id,fulfillment,adjustment,intake_completed_at,capacity_confirmed_at,service_started_at,delivery_due_at,search_activated_at,version_bundle)
values ('96000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003',(select id from public.ap_capacity_allocations where request_key='reserve-1'),'RESEARCHING','PROPOSED',now(),now(),now(),now()+interval '24 hours',now(),'{}');
insert into public.ap_criteria_amendments(id,search_service_id,parent_snapshot_id,state,criteria_diff,proposal_expires_at,idempotency_key)
values ('97000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','PROPOSED','{}',now()+interval '1 hour','amendment:1');
select public.ap_accept_criteria_amendment('97000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000004');
select pg_temp.assert_true((select original_snapshot_id='50000000-0000-4000-8000-000000000003' and active_snapshot_id='50000000-0000-4000-8000-000000000004' and quote_id='75000000-0000-4000-8000-000000000002' and winning_payment_attempt_id='80000000-0000-4000-8000-000000000001' and delivery_due_at=service_started_at+interval '24 hours' from public.ap_search_services where id='96000000-0000-4000-8000-000000000001'),'post-activation amendment rewrote winning commercial history');
select pg_temp.assert_true((select invalidated_at is null from public.ap_quotes where id='75000000-0000-4000-8000-000000000002'),'post-activation amendment invalidated winning quote');
select pg_temp.assert_true((select lifecycle='SUPERSEDED' and debit_disposition='RETURNED' from public.ap_capacity_allocations where request_key='reserve-adjustment'),'revision-specific held capacity did not return');
insert into public.ap_intake_snapshots
select (jsonb_populate_record(null::public.ap_intake_snapshots, to_jsonb(s) || jsonb_build_object(
  'id','50000000-0000-4000-8000-000000000005','draft_id','30000000-0000-4000-8000-000000000001','intake_id',null,'customer_id',null,'parent_snapshot_id',null,
  'version',1,'snapshot_kind','INITIAL','content_sha256',repeat('9',64),'finalized_at',now(),'created_at',now()
))).* from public.ap_intake_snapshots s where s.id='50000000-0000-4000-8000-000000000003';
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
values ('73000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000005','72000000-0000-4000-8000-000000000001','v1','{}','REQUIRED',repeat('5',64));
insert into public.ap_feasibility_coverage_cells(plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,result_bound,execution_path,terminal_outcome,cursor_or_stop_reason,result_count,parser_result,started_at,completed_at)
values ('73000000-0000-4000-8000-000000000003','manual-reviewed','AUTHORIZED_MANUAL_ONLY',repeat('c',64),1,interval '1 day',20,'MANUAL','SUCCEEDED_WITH_RESULTS','fixture-complete',12,'{}',now(),now());
insert into public.ap_feasibility_assessments(id,snapshot_id,coverage_plan_id,state,outcome,resolution_blocker,preliminarily_deliverable_count,reviewable_count,excluded_count,rules_version)
values ('74000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000005','73000000-0000-4000-8000-000000000003','COMPLETE','LIKELY','NONE',12,2,3,'rules-v1');
insert into public.ap_quotes(id,draft_id,snapshot_id,feasibility_assessment_id,price_cents,currency,tax_inclusive,content_sha256,expires_at)
values ('75000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000005','74000000-0000-4000-8000-000000000003',2000,'USD',true,repeat('6',64),now()+interval '1 hour');
select public.ap_reserve_capacity(null::uuid,'SEARCH',1,'reserve-anonymous-checkout',now()+interval '30 minutes','[]','30000000-0000-4000-8000-000000000001');
insert into public.ap_external_commands(id,draft_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key)
values ('81000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','CREATE_CHECKOUT','stripe',repeat('7',64),'checkout-command-anonymous');
insert into public.ap_checkout_attempts(id,draft_id,quote_id,command_id,capacity_allocation_id,state,provider_checkout_session_id,expires_at)
values ('81500000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000002',(select id from public.ap_capacity_allocations where request_key='reserve-anonymous-checkout'),'OPEN','cs_anonymous',now()+interval '20 minutes');
update public.ap_anonymous_drafts set state='COMPLETE' where id='30000000-0000-4000-8000-000000000001';
select public.ap_lock_anonymous_draft_to_checkout('30000000-0000-4000-8000-000000000001',repeat('a',64),'81500000-0000-4000-8000-000000000001');
update public.ap_checkout_attempts set state='CANCELED' where id='81500000-0000-4000-8000-000000000001';
select public.ap_return_anonymous_draft_after_checkout('30000000-0000-4000-8000-000000000001',repeat('a',64));
select pg_temp.assert_true((select state='COMPLETE' and answers='{"partial":"saved"}' from public.ap_anonymous_drafts where id='30000000-0000-4000-8000-000000000001'),'payment-cancel return lost the anonymous session draft');
insert into public.ap_material_purchases(id,customer_id,payment_attempt_id,amount_cents,currency) values ('93000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002',1600,'USD');
insert into public.ap_material_lines(id,purchase_id,delivered_order_id,delivered_match_id,payment_attempt_id,payment_allocation_key,allocated_amount_cents,readiness,fulfillment,materials_payment_verified_at)
values
 ('94000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','allocation:1',800,'CHECKOUT_ELIGIBLE','PAID',now()),
 ('94000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','allocation:2',800,'CHECKOUT_ELIGIBLE','PAID',now());
insert into public.ap_capacity_pools(id,resource,enabled,configuration_version)
values ('70000000-0000-4000-8000-000000000002','MATERIALS',true,'staff-v1');
insert into public.ap_capacity_buckets(id,pool_id,starts_at,ends_at,total_units,staffing_version)
values ('71000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000002',now()-interval '1 hour',now()+interval '1 hour',2,'staff-v1');
do $$ begin
  perform public.ap_reserve_capacity('10000000-0000-4000-8000-000000000001','MATERIALS',2,'reserve-materials-missing',now()+interval '30 minutes','[]');
  raise exception 'materials reservation without complete line members accepted';
exception when others then
  if sqlerrm = 'materials reservation without complete line members accepted' then raise; end if;
  if sqlerrm <> 'materials_capacity_requires_complete_line_members' then raise; end if;
end $$;
select public.ap_reserve_capacity(
  '10000000-0000-4000-8000-000000000001','MATERIALS',2,'reserve-materials',now()+interval '30 minutes',
  jsonb_build_array(
    jsonb_build_object('materialLineId','94000000-0000-4000-8000-000000000001','units',1),
    jsonb_build_object('materialLineId','94000000-0000-4000-8000-000000000002','units',1)
  )
);
select pg_temp.assert_true((
  select count(*)=2 and sum(units)=2
  from public.ap_capacity_allocation_members
  where allocation_id=(select id from public.ap_capacity_allocations where request_key='reserve-materials')
),'materials capacity did not atomically attribute every line');
select pg_temp.assert_true(public.ap_capacity_available('71000000-0000-4000-8000-000000000002')=0,'materials capacity did not debit the full submitted set');
insert into public.ap_material_entitlement_history(id,line_id,delivered_order_id,delivered_match_id,state)
values
 ('95000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','PAID'),
 ('95000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','PAID');
select public.ap_claim_material_entitlement('95000000-0000-4000-8000-000000000001');
do $$ begin perform public.ap_claim_material_entitlement('95000000-0000-4000-8000-000000000002'); raise exception 'duplicate material entitlement claim accepted'; exception when others then if sqlerrm='duplicate material entitlement claim accepted' then raise; end if; end $$;
insert into public.ap_refund_operations(customer_id,payment_attempt_id,material_line_id,scope,amount_cents,currency,idempotency_key,state,required,completed_at)
values ('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','MATERIAL_LINE',800,'USD','refund-material-line-1','SUCCEEDED',true,now());
select pg_temp.assert_true((select refund_aggregate='PARTIAL' and refunded_amount_cents=800 from public.ap_payment_refund_aggregates where payment_attempt_id='80000000-0000-4000-8000-000000000002'),'material-line partial refund aggregate incorrect');
select pg_temp.assert_true((select settlement='PAID' from public.ap_payment_attempts where id='80000000-0000-4000-8000-000000000002'),'material-line refund changed paid settlement');
insert into public.ap_material_entitlement_history(id,line_id,delivered_order_id,delivered_match_id,state,supersedes_id)
values ('95000000-0000-4000-8000-000000000003','94000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','FULLY_REFUNDED','95000000-0000-4000-8000-000000000001');
select public.ap_release_fully_refunded_entitlement('95000000-0000-4000-8000-000000000003');
select public.ap_claim_material_entitlement('95000000-0000-4000-8000-000000000002');
update public.profiles set role='operator' where id='10000000-0000-4000-8000-000000000002';
insert into public.ap_generated_artifacts(id,customer_id,order_id,material_line_id,job_snapshot_id,artifact_type,source_snapshot_id,claim_provenance,generator_version,current_file_version)
values
 ('98000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','RESUME','50000000-0000-4000-8000-000000000004','{}','v1',1),
 ('98000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','COVER_LETTER','50000000-0000-4000-8000-000000000004','{}','v1',1);
insert into public.ap_generated_file_versions(artifact_id,version,storage_bucket,storage_path,checksum_sha256,mime_type,size_bytes,human_content_approved_by,human_content_approved_at,human_visual_approved_by,human_visual_approved_at)
values
 ('98000000-0000-4000-8000-000000000001',1,'customer-deliveries','fixture/resume-v1.docx',repeat('1',64),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',100,'10000000-0000-4000-8000-000000000002',now(),'10000000-0000-4000-8000-000000000002',now()),
 ('98000000-0000-4000-8000-000000000002',1,'customer-deliveries','fixture/cover-v1.docx',repeat('2',64),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',100,'10000000-0000-4000-8000-000000000002',now(),'10000000-0000-4000-8000-000000000002',now());
select public.ap_commit_release('99000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','MATERIAL_PAIR',now(),now()+interval '24 hours','{}','10000000-0000-4000-8000-000000000002',jsonb_build_array(
 jsonb_build_object('memberType','GENERATED_ARTIFACT','memberId','98000000-0000-4000-8000-000000000001','position',1),
 jsonb_build_object('memberType','GENERATED_ARTIFACT','memberId','98000000-0000-4000-8000-000000000002','position',2)
));
select pg_temp.assert_true((select fulfillment='DELIVERED' and earned_revenue_at is not null from public.ap_material_lines where id='94000000-0000-4000-8000-000000000001'),'atomic pair release did not mark line delivery/earned time');
do $$ begin
  perform public.ap_commit_release('99000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','MATERIAL_TRIPLE',now(),now()+interval '24 hours','{}','10000000-0000-4000-8000-000000000002','[]');
  raise exception 'non-atomic triple release accepted';
exception when others then if sqlerrm='non-atomic triple release accepted' then raise; end if; end $$;

insert into public.ap_sensitive_payloads(id,customer_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
values
 ('9a000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',decode('aabb','hex'),'AES-256-GCM',decode(repeat('44',32),'hex'),decode(repeat('55',12),'hex'),decode(repeat('66',16),'hex'),repeat('3',64),'fixture-kms','1',repeat('4',64)),
 ('9a000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',decode('ccdd','hex'),'AES-256-GCM',decode(repeat('77',32),'hex'),decode(repeat('88',12),'hex'),decode(repeat('99',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64));
do $$
declare reference_id uuid; first_version_id uuid; next_version_id uuid; permission_id uuid;
begin
  reference_id := public.ap_create_reference_record('10000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001','reference-v1',repeat('3',64));
  select id into first_version_id from public.ap_reference_record_versions where reference_record_id=reference_id and version=1;
  perform public.ap_confirm_reference_version('10000000-0000-4000-8000-000000000001',first_version_id);
  permission_id := public.ap_grant_reference_permission('10000000-0000-4000-8000-000000000001',first_version_id,'99000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',repeat('b',64),'Example','Coordinator','permission-v1');
  insert into public.ap_generated_artifacts(id,customer_id,order_id,material_line_id,job_snapshot_id,artifact_type,source_snapshot_id,reference_permission_id,claim_provenance,generator_version,current_file_version)
  values ('98000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','REFERENCE_SHEET','50000000-0000-4000-8000-000000000004',permission_id,'{}','v1',1);
  insert into public.ap_generated_file_versions(artifact_id,version,storage_bucket,storage_path,checksum_sha256,mime_type,size_bytes,human_content_approved_by,human_content_approved_at,human_visual_approved_by,human_visual_approved_at)
  values ('98000000-0000-4000-8000-000000000003',1,'customer-deliveries','fixture/reference-v1.docx',repeat('7',64),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',100,'10000000-0000-4000-8000-000000000002',now(),'10000000-0000-4000-8000-000000000002',now());
  next_version_id := public.ap_replace_reference('10000000-0000-4000-8000-000000000001',reference_id,'9a000000-0000-4000-8000-000000000002','reference-v1',repeat('5',64));
  if not exists(select 1 from public.ap_reference_permissions where id=permission_id and revoked_at is not null and contact_version_changed_at is not null) then raise exception 'contact change did not revoke/reconfirm permission'; end if;
  if not exists(select 1 from public.ap_generated_file_versions where artifact_id='98000000-0000-4000-8000-000000000003' and downloads_revoked_at is not null) then raise exception 'hosted reference sheet was not revoked'; end if;
  perform public.ap_confirm_reference_version('10000000-0000-4000-8000-000000000001',next_version_id);
  perform public.ap_record_reference_staff_access(reference_id,'10000000-0000-4000-8000-000000000002','FULFILLMENT');
  perform public.ap_remove_reference('10000000-0000-4000-8000-000000000001',reference_id,'CUSTOMER_REQUEST');
  if not exists(select 1 from public.ap_reference_records where id=reference_id and removed_at is not null and retention_state='DELETE_PENDING') then raise exception 'reference removal state missing'; end if;
end $$;

insert into public.ap_reference_records(customer_id) values ('10000000-0000-4000-8000-000000000002');
insert into public.ap_generated_artifacts(customer_id,order_id,artifact_type,source_snapshot_id,claim_provenance,generator_version)
values
 ('10000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000002','RESUME','50000000-0000-4000-8000-000000000002','{}','v1');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=5 from public.ap_payment_attempts),'cross-customer payment exposed');
select pg_temp.assert_true((select count(*)=1 from public.ap_reference_records),'cross-customer reference exposed');
select pg_temp.assert_true((select count(*)=3 from public.ap_generated_artifacts),'cross-customer artifact exposed');
reset role;

insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at) values ('RETENTION','30000000-0000-4000-8000-000000000001','retention:1',now()-interval '1 minute');
select pg_temp.assert_true((select count(*)=1 from public.ap_claim_scheduled_jobs('worker-a',10)),'scheduler failed to claim due job');
select pg_temp.assert_true((select count(*)=0 from public.ap_claim_scheduled_jobs('worker-b',10)),'scheduler lease was claimed twice');

rollback;