select * from public.ap_create_anonymous_draft(
  'f5000000-0000-4000-8000-000000000001',repeat('c',64),now()+interval '1 day'
);
select * from public.ap_register_anonymous_document(
  'f5000000-0000-4000-8000-000000000001',repeat('c',64),1,
  'f5100000-0000-4000-8000-000000000001','RESUME','resume.pdf',
  'anonymous/f5000000-0000-4000-8000-000000000001/resume/v1.pdf',128,
  'application/pdf','application/pdf',repeat('1',64)
);
select public.ap_record_isolated_document_review(
  'f5000000-0000-4000-8000-000000000001',
  'f5100000-0000-4000-8000-000000000001',repeat('1',64),
  'isolated-extractor-v1','["Maintained records."]'
);
insert into public.ap_sensitive_payloads(
  id,draft_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,
  authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash
) values(
  'f5200000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001',
  decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),
  decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64)
);
select * from public.ap_finalize_four_step_intake(
  'f5000000-0000-4000-8000-000000000001',repeat('c',64),2,
  'f5300000-0000-4000-8000-000000000001',
  '{"accessEmailNormalized":"upgrade-074@example.invalid","documentContactEmail":"upgrade-074@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',
  repeat('a',64),'f5200000-0000-4000-8000-000000000001','{}'
);
select public.ap_record_snapshot_legal_acceptance(
  'f5000000-0000-4000-8000-000000000001',repeat('c',64),
  'f5300000-0000-4000-8000-000000000001',
  'manual-launch-terms-2026-10-02-v2','privacy-v1',repeat('b',64)
);
update public.ap_anonymous_drafts
set state='LOCKED_TO_CHECKOUT'
where id='f5000000-0000-4000-8000-000000000001';
select public.ap_upgrade_completed_intake_legal_acceptance(
  'f5000000-0000-4000-8000-000000000001',repeat('c',64),
  'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
  'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
  'applypack-legal-acceptance-copy-2026-10-04-v1','0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283',
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('c',64)
);

select case when
  (select count(*)=1 from public.ap_snapshot_legal_acceptances
   where snapshot_id='f5300000-0000-4000-8000-000000000001')
  and exists(
    select 1
    from public.ap_snapshot_legal_content_receipts receipt
    join public.ap_snapshot_legal_acceptances acceptance
      on acceptance.id=receipt.legal_acceptance_id
    where receipt.snapshot_id='f5300000-0000-4000-8000-000000000001'
      and acceptance.acceptance_sha256=repeat('b',64)
      and receipt.acceptance_sha256=repeat('c',64)
  )
then 'LEGAL_ACCEPTANCE_074_FIXTURE_OK' else 'LEGAL_ACCEPTANCE_074_FIXTURE_FAILED' end;
