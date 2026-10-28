-- Executed only inside the runner's disposable rollback-only 085 -> 086 test.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('86ff0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'historical-activation@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='86ff0000-0000-4000-8000-000000000001';
insert into public.ap_manual_launch_activations(id,release_sha,health_evidence_reference,database_evidence_reference,
  payment_evidence_reference,email_evidence_reference,kms_evidence_reference,worker_evidence_reference,
  maintenance_evidence_reference,backup_restore_evidence_reference,inventory_evidence_reference,
  accessibility_evidence_reference,product_supervisor_reference,security_supervisor_reference,operations_supervisor_reference,
  tenth_man_supervisor_reference,accepted_p2_disposition_reference,unresolved_p0_count,unresolved_p1_count,
  canary_reconciliation_reference,canary_reconciled_amount_cents,worker_network_attestation_sha256,evidence_bundle_sha256,approved_by)
values('86ff0000-0000-4000-8000-000000000011',repeat('f',40),'historical-evidence','historical-evidence','historical-evidence',
  'historical-evidence','historical-evidence','historical-evidence','historical-evidence','historical-evidence',
  'historical-evidence','historical-evidence','historical-evidence','historical-evidence','historical-evidence',
  'historical-evidence','historical-evidence',0,0,'historical-refund-reconciliation',2698,repeat('f',64),repeat('e',64),
  '86ff0000-0000-4000-8000-000000000001');
insert into public.ap_payment_attempts(id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,payment_verified_at)
values('86ff0000-0000-4000-8000-000000000021','86ff0000-0000-4000-8000-000000000001','stripe','pi_Historical086',1899,'USD','PAID','NONE',clock_timestamp());
insert into public.ap_refund_operations(id,customer_id,payment_attempt_id,scope,amount_cents,currency,idempotency_key,state,required,reason_code)
values('86ff0000-0000-4000-8000-000000000031','86ff0000-0000-4000-8000-000000000001','86ff0000-0000-4000-8000-000000000021',
  'FULL_SEARCH',1899,'USD','historical-canary-086-refund','PENDING',true,'MANUAL_LAUNCH_CANARY');
create temporary table activation_before_086 as select to_jsonb(a) as value from public.ap_manual_launch_activations a
  where id='86ff0000-0000-4000-8000-000000000011';
create temporary table payment_before_086 as select to_jsonb(p) as value from public.ap_payment_attempts p
  where id='86ff0000-0000-4000-8000-000000000021';
create temporary table refund_before_086 as select to_jsonb(r) as value from public.ap_refund_operations r
  where id='86ff0000-0000-4000-8000-000000000031';

-- Preserve an actual pre-086 accepted privacy receipt across the forward amendment.
select * from public.ap_create_anonymous_draft(
  '86000000-0000-4000-8000-000000000001',
  repeat('a',64),
  now()+interval '1 day'
);

select * from public.ap_register_anonymous_document(
  '86000000-0000-4000-8000-000000000001',
  repeat('a',64),
  1,
  '86100000-0000-4000-8000-000000000001',
  'RESUME',
  'resume.pdf',
  'anonymous/86000000-0000-4000-8000-000000000001/resume/v1.pdf',
  128,
  'application/pdf',
  'application/pdf',
  repeat('1',64)
);

select public.ap_record_isolated_document_review(
  '86000000-0000-4000-8000-000000000001',
  '86100000-0000-4000-8000-000000000001',
  repeat('1',64),
  'isolated-extractor-v1',
  '["Maintained records."]'
);

select * from public.ap_finalize_four_step_intake_with_legal_acceptance_v3(
  '86000000-0000-4000-8000-000000000001',repeat('a',64),2,
  '86300000-0000-4000-8000-000000000001',
  '{"accessEmailNormalized":"atomic@example.invalid","documentContactEmail":"atomic@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',
  repeat('7',64),'86200000-0000-4000-8000-000000000001',
  decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),
  decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64),'{}',
  'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
  'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
  'applypack-legal-acceptance-copy-2026-10-04-v1','0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283',
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('8',64)
);


create temporary table legal_receipt_before_086 as
select to_jsonb(receipt) as value from public.ap_snapshot_legal_content_receipts receipt
where snapshot_id='86300000-0000-4000-8000-000000000001';
