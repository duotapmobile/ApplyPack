begin;

create function pg_temp.assert_true(value boolean, failure_message text)
returns void language plpgsql as $$
begin
  if value is not true then raise exception '%', failure_message; end if;
end;
$$;

select pg_temp.assert_true(
  exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202609070031' and checkpoint='CHUNK5_MATERIALS_DELIVERY_V1'),
  'chunk5 checkpoint missing'
);
select pg_temp.assert_true(
  to_regprocedure('public.ap_begin_material_checkout(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text,text,boolean,boolean,boolean)') is not null,
  'atomic material checkout function missing'
);
select pg_temp.assert_true(
  to_regprocedure('public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz)') is not null,
  'secure material download authorization missing'
);
select pg_temp.assert_true(
  to_regprocedure('public.ap_open_postdelivery_false_claim_case(uuid,uuid,uuid,uuid,jsonb)') is not null,
  'postdelivery correction support function missing'
);
select pg_temp.assert_true(
  to_regprocedure('public.ap_chunk5_monitor_snapshot()') is not null,
  'chunk5 monitor snapshot missing'
);
select pg_temp.assert_true(
  (select not public and file_size_limit=10485760
     from storage.buckets where id='operator-render-previews'),
  'operator render previews bucket is not private and bounded'
);
select pg_temp.assert_true(
  (select tax_treatment='UNSET_BLOCKING' and not materials_generation_approved
     and cardinality(material_output_formats)=0 and document_renderer_identity is null
     and arial_font_sha256 is null and malware_scanner_identity is null
     from public.ap_commerce_configuration where singleton),
  'materials generation defaults are not fail closed'
);
select pg_temp.assert_true(
  not has_function_privilege('authenticated',
    'public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz)','execute')
  and has_function_privilege('service_role',
    'public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz)','execute'),
  'secure download function privilege boundary is incorrect'
);
select pg_temp.assert_true(
  not has_function_privilege('authenticated',
    'public.ap_open_postdelivery_false_claim_case(uuid,uuid,uuid,uuid,jsonb)','execute')
  and has_function_privilege('service_role',
    'public.ap_open_postdelivery_false_claim_case(uuid,uuid,uuid,uuid,jsonb)','execute'),
  'postdelivery support function privilege boundary is incorrect'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.ap_job_snapshots','select'),
  'chunk5 re-exposed immutable job snapshots directly to customers'
);
select pg_temp.assert_true(
  (select bool_and(relrowsecurity) from pg_class
    where oid in (
      'public.ap_material_checkout_intents'::regclass,
      'public.ap_material_checkout_items'::regclass,
      'public.ap_generated_artifacts'::regclass,
      'public.ap_generated_file_versions'::regclass,
      'public.ap_artifact_quality_reviews'::regclass,
      'public.ap_material_download_audits'::regclass,
      'public.ap_material_support_cases'::regclass
    )),
  'chunk5 customer material tables do not all enforce RLS'
);

do $$ begin
  perform public.ap_begin_material_checkout(
    '15000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    '35000000-0000-4000-8000-000000000001',
    '45000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000001',
    'chunk5-unconfigured-checkout',repeat('a',64),'[]'::jsonb,
    'KEEP_EXISTING_TIMELINE',null,false,true,true
  );
  raise exception 'unconfigured_material_checkout_was_enabled';
exception when raise_exception then
  if sqlerrm='unconfigured_material_checkout_was_enabled' then raise; end if;
  if sqlerrm<>'materials_checkout_disabled_unset_blocking' then raise; end if;
end $$;

update public.ap_commerce_configuration
set download_ttl_seconds=900,reauthentication_window_seconds=900
where singleton;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('15000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chunk5-customer@example.invalid','',now(),'{}','{}',now(),now()),
  ('15000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chunk5-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('15000000-0000-4000-8000-000000000003','00000000-0000-0000-8000-000000000000','authenticated','authenticated','chunk5-reviewer@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='operator' where id='15000000-0000-4000-8000-000000000003';

insert into public.ap_intake_snapshots(
  id,customer_id,version,snapshot_kind,access_email_normalized,payer_receipt_email,document_contact_email,
  desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,
  blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,
  schedules,travel,benefits,dealbreakers,salary_target_cents,salary_hard_minimum_cents,
  salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,
  salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,
  targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at
) values(
  '45000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',1,'INITIAL',
  'chunk5-customer@example.invalid',null,'chunk5-customer@example.invalid',
  '["COORDINATING_PROJECTS"]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,
  '["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',7000000,6000000,false,'YEAR','BASE',
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',
  repeat('4',64),'applypack-c14n-v1','applypack-intake-v3',clock_timestamp()-interval '2 days'
);

insert into public.jobs(
  id,company,title,source_url,location_text,salary_text,checked_at,listing_status,
  official_application_url,source_job_url,normalized_source_url,external_job_id,description,
  employment_type,w2_or_contractor,work_mode,pay_model,posted_at,last_verified_at,
  source_freshness_status,is_active,review_status,reviewed_by,reviewed_at
) values(
  '65000000-0000-4000-8000-000000000001','Chunk 5 Fixture Employer','Operations Specialist',
  'https://chunk5-employer.example/jobs/1','Remote - United States','$70,000 annually',clock_timestamp(),
  'open','https://chunk5-employer.example/apply/1','https://chunk5-employer.example/jobs/1',
  'https://chunk5-employer.example/jobs/1','CHUNK5-REQ-1',
  'Current reviewed operations role with an employer-hosted application path.',
  'w2_full_time','w2','remote_us_nationwide','salary',clock_timestamp()-interval '1 day',
  clock_timestamp()-interval '1 minute','fresh',true,'approved',
  '15000000-0000-4000-8000-000000000003',clock_timestamp()
);

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
  '75000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001',
  'APPLYPACK_FOUND','manual-reviewed','CHUNK5-REQ-1','https://chunk5-employer.example/apply/1',
  'EMPLOYER_HOSTED','https://chunk5-employer.example/jobs/1','https://chunk5-employer.example/jobs/1',
  'Chunk 5 Fixture Employer','Operations Specialist',repeat('7',64),
  '{"description":"Current reviewed operations role"}',clock_timestamp(),current_date,false,
  clock_timestamp()-interval '1 minute','$70,000 annually','EMPLOYER_LISTING',
  '{"mode":"REMOTE","location":"United States"}','listing-requirements-v3',repeat('8',64),
  current_source.id,clock_timestamp()-interval '1 day','chunk5-employer.example',
  'PASS','PASS','PASS','{}','{}','PASS',100,100,'applypack-c14n-v1',false
from current_source;

insert into public.orders(
  id,customer_id,product_kind,amount_cents,status,paid_at,delivery_deadline,delivered_at,
  human_review_checklist,human_reviewed_by,human_reviewed_at
) values(
  '25000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
  'job_search',2000,'delivered',clock_timestamp()-interval '3 days',
  clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days',
  '{"approved":true}','15000000-0000-4000-8000-000000000003',clock_timestamp()-interval '2 days'
);
insert into public.job_matches(
  id,search_order_id,job_id,position,fit_summary,requirements,concerns,delivered_at,
  matching_experience,primary_outcome,core_responsibilities,hidden_job_functions,
  reviewed_by,reviewed_at,release_explanation,allowed_unknown_warnings,source_provenance,
  compensation_status,posted_on,posted_date_unknown,last_checked_at
) values(
  '85000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000001',1,'Evidence-bound fit summary','[]','[]',
  clock_timestamp()-interval '2 days','["Operations coordination"]','Coordinate accurate operations',
  '["Maintain workflow records"]','[]','15000000-0000-4000-8000-000000000003',
  clock_timestamp()-interval '2 days',
  '{"whatJobInvolves":"Coordinate operations","whyMadeList":"All gates passed","howExperienceConnects":"Confirmed coordination experience","whatMayBeNew":"Employer workflow","whatToKnow":"Use employer application path"}',
  '[]','{"authorization":"manual-reviewed"}','PUBLISHED_MEETS_MINIMUM',current_date,false,
  clock_timestamp()-interval '2 days'
);

insert into public.ap_payment_attempts(
  id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,
  payment_verified_at,provider_payment_status,payment_method_type,immediate_charge_verified
) values(
  '95000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
  'stripe','pi_chunk5_fixture',800,'USD','PAID','NONE',clock_timestamp()-interval '25 hours',
  'succeeded','card',true
);
insert into public.ap_material_purchases(
  id,customer_id,payment_attempt_id,amount_cents,currency,completed_at
) values(
  'a5000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',800,'USD',clock_timestamp()-interval '25 hours'
);
insert into public.ap_material_lines(
  id,purchase_id,delivered_order_id,delivered_match_id,payment_attempt_id,payment_allocation_key,
  allocated_amount_cents,readiness,fulfillment,substitution,selected_reference_sheet,active_revision,
  selection_confirmed_at,materials_payment_verified_at,materials_capacity_confirmed_at,
  materials_started_at,materials_due_at,earned_revenue_at
) values(
  'b5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001','chunk5-payment-allocation-1',800,
  'CHECKOUT_ELIGIBLE','DELIVERED','NONE',false,1,statement_timestamp()-interval '26 hours',
  statement_timestamp()-interval '25 hours',statement_timestamp()-interval '25 hours',
  statement_timestamp()-interval '25 hours',statement_timestamp()-interval '1 hour',statement_timestamp()-interval '2 minutes'
);
insert into public.ap_material_line_revisions(
  id,line_id,version,revision_kind,job_snapshot_id,source_snapshot_id,binding_sha256,
  accepted_at,started_at,due_at
) values(
  'c5000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',1,
  'ORIGINAL','75000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000001',
  repeat('b',64),statement_timestamp()-interval '25 hours',statement_timestamp()-interval '25 hours',
  statement_timestamp()-interval '1 hour'
);
insert into public.ap_material_entitlement_history(
  id,line_id,delivered_order_id,delivered_match_id,revision_id,state
) values(
  'd5000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000001','DELIVERED'
);
select pg_temp.assert_true(public.ap_claim_material_entitlement(
  'd5000000-0000-4000-8000-000000000001'), 'material entitlement claim failed');
select pg_temp.assert_true(
  public.ap_append_material_entitlement_state_v2(
    'b5000000-0000-4000-8000-000000000001','DELIVERED')=
    'd5000000-0000-4000-8000-000000000001',
  'idempotent entitlement state appended duplicate history'
);
select pg_temp.assert_true(
  (select count(*)=1 from public.ap_material_entitlement_claims
    where delivered_order_id='25000000-0000-4000-8000-000000000001'
      and delivered_match_id='85000000-0000-4000-8000-000000000001'),
  'exact-order exact-match entitlement was not unique'
);

insert into public.ap_generated_artifacts(
  id,customer_id,order_id,material_line_id,job_snapshot_id,artifact_type,source_snapshot_id,
  source_line_revision_id,claim_provenance,generator_version,current_file_version
) values(
  'e5000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000001','RESUME',
  '45000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001',
  '{"claims":[{"source":"customer-confirmed"}]}','chunk5-generator-v1',1
);
insert into public.ap_generated_file_versions(
  id,artifact_id,version,storage_bucket,storage_path,checksum_sha256,mime_type,size_bytes,
  human_content_approved_by,human_content_approved_at,human_visual_approved_by,
  human_visual_approved_at,safe_filename,binding_sha256,package_qa_sha256
) values(
  'f5000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001',1,
  'generated-materials','customers/15000000/materials/resume-v1.docx',repeat('c',64),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',4096,
  '15000000-0000-4000-8000-000000000003',clock_timestamp()-interval '5 minutes',
  '15000000-0000-4000-8000-000000000003',clock_timestamp()-interval '4 minutes',
  'Chunk_5_Fixture_Employer_Operations_Specialist_Resume.docx',repeat('b',64),repeat('d',64)
);
insert into public.ap_artifact_quality_reviews(
  id,file_version_id,binding_sha256,structural_checks,provenance_checks,extracted_text_sha256,
  rendered_page_count,renderer_identity,arial_font_sha256,malware_scanner_identity,
  render_preview_bucket,render_preview_path,render_preview_sha256,rendered_page_sha256,
  arial_resolved,automated_passed_at,content_approved_by,content_approved_at,content_attestation,
  visual_approved_by,visual_approved_at,visual_attestation
) values(
  'aa500000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001',
  repeat('b',64),'{"docxPackage":"PASS"}','{"claims":"PASS"}',repeat('e',64),1,
  'fixture-renderer-v1',repeat('f',64),'fixture-clamav-v1','operator-render-previews',
  'chunk5/fixture/resume-v1.pdf',repeat('1',64),array[repeat('2',64)],true,
  clock_timestamp()-interval '6 minutes','15000000-0000-4000-8000-000000000003',
  clock_timestamp()-interval '5 minutes','All factual claims match the reviewed source evidence.',
  '15000000-0000-4000-8000-000000000003',clock_timestamp()-interval '4 minutes',
  'The rendered document has no clipping, overlap, or font substitution.'
);
insert into public.ap_releases(
  id,customer_id,order_id,material_line_id,release_kind,committed_at,active_due_at,
  version_bundle,human_approved_by
) values(
  'ab500000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',
  'MATERIAL_PAIR',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',
  '{"chunk":"5","generator":"chunk5-generator-v1"}','15000000-0000-4000-8000-000000000003'
);
insert into public.ap_release_members(release_id,member_type,member_id,position)
values(
  'ab500000-0000-4000-8000-000000000001','GENERATED_ARTIFACT',
  'e5000000-0000-4000-8000-000000000001',1
);
insert into public.ap_sensitive_payloads(
  id,customer_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,
  content_sha256,kms_key_identity,kms_key_version,encryption_context_hash
) values(
  'ac500000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
  decode('0102','hex'),'AES-256-GCM',decode(repeat('11',32),'hex'),decode(repeat('22',12),'hex'),
  decode(repeat('33',16),'hex'),repeat('3',64),'fixture-kms','1',repeat('4',64)
);

do $$ begin
  perform public.ap_authorize_material_download(
    '15000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001',
    'f5000000-0000-4000-8000-000000000001',clock_timestamp()-interval '16 minutes');
  raise exception 'stale_reauthentication_was_accepted';
exception when raise_exception then
  if sqlerrm='stale_reauthentication_was_accepted' then raise; end if;
  if sqlerrm<>'fresh_reauthentication_required' then raise; end if;
end $$;

do $$ begin
  perform public.ap_authorize_material_download(
    '15000000-0000-4000-8000-000000000002','e5000000-0000-4000-8000-000000000001',
    'f5000000-0000-4000-8000-000000000001',clock_timestamp()-interval '1 second');
  raise exception 'cross_customer_material_download_was_accepted';
exception when raise_exception then
  if sqlerrm='cross_customer_material_download_was_accepted' then raise; end if;
  if sqlerrm<>'material_download_unavailable' then raise; end if;
end $$;

do $$
declare result_value jsonb;
begin
  result_value:=public.ap_authorize_material_download(
    '15000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001',
    'f5000000-0000-4000-8000-000000000001',clock_timestamp()-interval '1 second');
  perform pg_temp.assert_true(
    result_value->>'path'='customers/15000000/materials/resume-v1.docx'
      and result_value->>'filename'='Chunk_5_Fixture_Employer_Operations_Specialist_Resume.docx'
      and result_value->>'checksumSha256'=repeat('c',64),
    'secure download authorization returned an incorrect immutable file binding'
  );
end;
$$;
select pg_temp.assert_true(
  (select count(*)=1 and bool_and(expires_at=issued_at+interval '15 minutes')
     from public.ap_material_download_audits
     where artifact_id='e5000000-0000-4000-8000-000000000001'),
  'secure download did not create an exact 15-minute immutable audit'
);

do $$
declare support_case_id uuid;
begin
  support_case_id:=public.ap_open_postdelivery_false_claim_case(
    '15000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000001','ac500000-0000-4000-8000-000000000001',
    '{"field":"employment dates","reportedIssue":"Customer reports an incorrect date"}'
  );
  perform pg_temp.assert_true(support_case_id is not null, 'postdelivery support case was not opened');
end;
$$;
select pg_temp.assert_true(
  (select downloads_revoked_at is not null from public.ap_generated_file_versions
    where id='f5000000-0000-4000-8000-000000000001')
  and (select invalidated_at is not null from public.ap_artifact_quality_reviews
    where id='aa500000-0000-4000-8000-000000000001'),
  'postdelivery false-claim report did not revoke hosted downloads and QA approval'
);
select pg_temp.assert_true(
  (select count(*)=1 and bool_and(state='OPEN') from public.ap_material_support_cases
    where material_line_id='b5000000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_releases
    where id='ab500000-0000-4000-8000-000000000001')
  and (select fulfillment='DELIVERED' and earned_revenue_at is not null
    and materials_due_at=materials_started_at+interval '24 hours'
    from public.ap_material_lines where id='b5000000-0000-4000-8000-000000000001')
  and (select settlement='PAID' from public.ap_payment_attempts
    where id='95000000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.ap_refund_operations
    where payment_attempt_id='95000000-0000-4000-8000-000000000001')
  and (select state='DELIVERED' from public.ap_material_entitlement_history
    where id='d5000000-0000-4000-8000-000000000001'),
  'postdelivery support flow changed delivery, earned revenue, payment, refund, SLA, release, or entitlement history'
);

do $$ begin
  perform public.ap_authorize_material_download(
    '15000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001',
    'f5000000-0000-4000-8000-000000000001',clock_timestamp()-interval '1 second');
  raise exception 'revoked_material_download_was_accepted';
exception when raise_exception then
  if sqlerrm='revoked_material_download_was_accepted' then raise; end if;
  if sqlerrm<>'material_download_unavailable' then raise; end if;
end $$;

select pg_temp.assert_true(
  (select (public.ap_chunk5_monitor_snapshot() ? 'materialsLinesPastDeadline')
    and (public.ap_chunk5_monitor_snapshot() ? 'artifactQaAwaitingHuman')
    and (public.ap_chunk5_monitor_snapshot() ? 'revokedHostedFiles')),
  'chunk5 monitor snapshot is missing required operational counters'
);

rollback;
