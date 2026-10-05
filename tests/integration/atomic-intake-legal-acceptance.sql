begin;

create function pg_temp.assert_true(value boolean, failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%', failure_message; end if; end $$;

update public.ap_commerce_configuration
set privacy_version='privacy-v1'
where singleton;

select * from public.ap_create_anonymous_draft(
  'e3000000-0000-4000-8000-000000000001',
  repeat('a',64),
  now()+interval '1 day'
);

select * from public.ap_register_anonymous_document(
  'e3000000-0000-4000-8000-000000000001',
  repeat('a',64),
  1,
  'e3100000-0000-4000-8000-000000000001',
  'RESUME',
  'resume.pdf',
  'anonymous/e3000000-0000-4000-8000-000000000001/resume/v1.pdf',
  128,
  'application/pdf',
  'application/pdf',
  repeat('1',64)
);

select public.ap_record_isolated_document_review(
  'e3000000-0000-4000-8000-000000000001',
  'e3100000-0000-4000-8000-000000000001',
  repeat('1',64),
  'isolated-extractor-v1',
  '["Maintained records."]'
);

create function pg_temp.reject_legal_receipt()
returns trigger language plpgsql as $$ begin raise exception 'fixture_legal_receipt_failure'; end $$;
create trigger atomic_intake_fixture_reject_legal
before insert on public.ap_snapshot_legal_acceptances
for each row execute function pg_temp.reject_legal_receipt();

do $$
begin
  perform public.ap_finalize_four_step_intake_with_legal_acceptance_v3(
    'e3000000-0000-4000-8000-000000000001',repeat('a',64),2,
    'e3300000-0000-4000-8000-000000000001',
    '{"accessEmailNormalized":"atomic@example.invalid","documentContactEmail":"atomic@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',
    repeat('7',64),'e3200000-0000-4000-8000-000000000001',
    decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),
    decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64),'{}',
    'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
    'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
    'applypack-legal-acceptance-copy-2026-10-04-v1','0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283',
    'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('8',64)
  );
  raise exception 'legal receipt failure did not abort finalization';
exception when others then
  if sqlerrm='legal receipt failure did not abort finalization' then raise; end if;
  if sqlerrm<>'fixture_legal_receipt_failure' then raise; end if;
end;
$$;

drop trigger atomic_intake_fixture_reject_legal on public.ap_snapshot_legal_acceptances;

select pg_temp.assert_true(
  (select state='IN_PROGRESS' and finalized_snapshot_id is null and version=2
   from public.ap_anonymous_drafts where id='e3000000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.ap_intake_snapshots where id='e3300000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.ap_sensitive_payloads where id='e3200000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.ap_feasibility_requests where snapshot_id='e3300000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.ap_snapshot_legal_acceptances where snapshot_id='e3300000-0000-4000-8000-000000000001'),
  'legal receipt failure left a partially finalized intake'
);

select * from public.ap_finalize_four_step_intake_with_legal_acceptance_v3(
  'e3000000-0000-4000-8000-000000000001',repeat('a',64),2,
  'e3300000-0000-4000-8000-000000000001',
  '{"accessEmailNormalized":"atomic@example.invalid","documentContactEmail":"atomic@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',
  repeat('7',64),'e3200000-0000-4000-8000-000000000001',
  decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),
  decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64),'{}',
  'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
  'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
  'applypack-legal-acceptance-copy-2026-10-04-v1','0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283',
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('8',64)
);

-- The stale pre-finalization version is accepted only for an exact replay of
-- the same immutable snapshot and legal receipt.
select * from public.ap_finalize_four_step_intake_with_legal_acceptance_v3(
  'e3000000-0000-4000-8000-000000000001',repeat('a',64),2,
  'e3300000-0000-4000-8000-000000000001',
  '{"accessEmailNormalized":"atomic@example.invalid","documentContactEmail":"atomic@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',
  repeat('7',64),'e3200000-0000-4000-8000-000000000001',
  decode('ff','hex'),'AES-256-GCM',decode('ee','hex'),decode(repeat('03',12),'hex'),
  decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64),'{}',
  'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
  'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
  'applypack-legal-acceptance-copy-2026-10-04-v1','0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283',
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('8',64)
);

select pg_temp.assert_true(
  (select state='COMPLETE' and finalized_snapshot_id='e3300000-0000-4000-8000-000000000001' and version=3
   from public.ap_anonymous_drafts where id='e3000000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_sensitive_payloads where id='e3200000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_intake_snapshots where id='e3300000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_feasibility_requests where snapshot_id='e3300000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_snapshot_legal_acceptances where snapshot_id='e3300000-0000-4000-8000-000000000001'),
  'atomic intake finalization or exact replay created inconsistent records'
);

select pg_temp.assert_true(
  (select count(*)=1
   from public.ap_snapshot_legal_content_receipts
   where snapshot_id='e3300000-0000-4000-8000-000000000001'
     and terms_content_sha256='eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c'
     and privacy_content_sha256='9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9'
     and acceptance_copy_sha256='0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283')
  and public.ap_has_current_content_bound_legal_acceptance(
    'e3000000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000001'),
  'exact replay did not preserve one content-bound immutable legal receipt'
);

-- The supported rollback build still calls v2. Migration 074 must route that
-- signature through v3 so every newly finalized rollback intake receives the
-- current immutable content receipt in the same transaction.
select * from public.ap_create_anonymous_draft(
  'e4000000-0000-4000-8000-000000000001',repeat('b',64),now()+interval '1 day'
);
select * from public.ap_register_anonymous_document(
  'e4000000-0000-4000-8000-000000000001',repeat('b',64),1,
  'e4100000-0000-4000-8000-000000000001','RESUME','resume.pdf',
  'anonymous/e4000000-0000-4000-8000-000000000001/resume/v1.pdf',128,
  'application/pdf','application/pdf',repeat('1',64)
);
select public.ap_record_isolated_document_review(
  'e4000000-0000-4000-8000-000000000001',
  'e4100000-0000-4000-8000-000000000001',repeat('1',64),
  'isolated-extractor-v1','["Maintained records."]'
);

select * from public.ap_finalize_four_step_intake_with_legal_acceptance_v2(
  'e4000000-0000-4000-8000-000000000001',repeat('b',64),2,
  'e4300000-0000-4000-8000-000000000001',
  '{"accessEmailNormalized":"rolling@example.invalid","documentContactEmail":"rolling@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',
  repeat('9',64),'e4200000-0000-4000-8000-000000000001',
  decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),
  decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64),'{}',
  'manual-launch-terms-2026-10-02-v2','privacy-v1',repeat('1',64)
);

select pg_temp.assert_true(
  public.ap_has_current_content_bound_legal_acceptance(
    'e4000000-0000-4000-8000-000000000001','e4300000-0000-4000-8000-000000000001'),
  'supported v2 rollback finalization did not create the content-bound receipt'
);

select * from public.ap_finalize_four_step_intake_with_legal_acceptance_v3(
  'e4000000-0000-4000-8000-000000000001',repeat('b',64),2,
  'e4300000-0000-4000-8000-000000000001',
  '{"accessEmailNormalized":"rolling@example.invalid","documentContactEmail":"rolling@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',
  repeat('9',64),'e4200000-0000-4000-8000-000000000001',
  decode('ff','hex'),'AES-256-GCM',decode('ee','hex'),decode(repeat('03',12),'hex'),
  decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64),'{}',
  'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
  'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
  'applypack-legal-acceptance-copy-2026-10-04-v1','0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283',
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('1',64)
);

select pg_temp.assert_true(
  public.ap_has_current_content_bound_legal_acceptance(
    'e4000000-0000-4000-8000-000000000001','e4300000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_snapshot_legal_acceptances
       where snapshot_id='e4300000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_snapshot_legal_content_receipts
       where snapshot_id='e4300000-0000-4000-8000-000000000001'),
  'v3 replay did not preserve exactly one immutable content receipt created through v2'
);

-- Simulate a draft completed immediately before migration 074 by using the
-- preserved base helpers. It must remain blocked until the customer explicitly
-- re-confirms the current legal copy through the upgrade RPC.
select * from public.ap_create_anonymous_draft(
  'e5000000-0000-4000-8000-000000000001',repeat('c',64),now()+interval '1 day'
);
select * from public.ap_register_anonymous_document(
  'e5000000-0000-4000-8000-000000000001',repeat('c',64),1,
  'e5100000-0000-4000-8000-000000000001','RESUME','resume.pdf',
  'anonymous/e5000000-0000-4000-8000-000000000001/resume/v1.pdf',128,
  'application/pdf','application/pdf',repeat('1',64)
);
select public.ap_record_isolated_document_review(
  'e5000000-0000-4000-8000-000000000001',
  'e5100000-0000-4000-8000-000000000001',repeat('1',64),
  'isolated-extractor-v1','["Maintained records."]'
);
insert into public.ap_sensitive_payloads(
  id,draft_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,
  authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash
) values(
  'e5200000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001',
  decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),
  decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64)
);
select * from public.ap_finalize_four_step_intake(
  'e5000000-0000-4000-8000-000000000001',repeat('c',64),2,
  'e5300000-0000-4000-8000-000000000001',
  '{"accessEmailNormalized":"upgrade@example.invalid","documentContactEmail":"upgrade@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',
  repeat('a',64),'e5200000-0000-4000-8000-000000000001','{}'
);
select public.ap_record_snapshot_legal_acceptance(
  'e5000000-0000-4000-8000-000000000001',repeat('c',64),
  'e5300000-0000-4000-8000-000000000001',
  'manual-launch-terms-2026-10-02-v2','privacy-v1',repeat('b',64)
);
select pg_temp.assert_true(
  not public.ap_has_current_content_bound_legal_acceptance(
    'e5000000-0000-4000-8000-000000000001','e5300000-0000-4000-8000-000000000001'),
  'pre-074 version-only receipt unexpectedly passed without explicit re-consent'
);
update public.ap_anonymous_drafts
set state='LOCKED_TO_CHECKOUT'
where id='e5000000-0000-4000-8000-000000000001';
select public.ap_upgrade_completed_intake_legal_acceptance(
  'e5000000-0000-4000-8000-000000000001',repeat('c',64),
  'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
  'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
  'applypack-legal-acceptance-copy-2026-10-04-v1','0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283',
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('c',64)
);
select pg_temp.assert_true(
  public.ap_has_current_content_bound_legal_acceptance(
    'e5000000-0000-4000-8000-000000000001','e5300000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_snapshot_legal_content_receipts
       where snapshot_id='e5300000-0000-4000-8000-000000000001'),
  'explicit customer re-consent on a checkout-locked draft did not append exactly one content-bound receipt'
);

-- Every later legal revision appends a new immutable episode on the same
-- snapshot. Exact replays remain idempotent, including the serialized path
-- used by concurrent requests.
update public.ap_commerce_configuration
set legal_acceptance_copy_version='applypack-legal-acceptance-copy-fixture-v2',
    legal_acceptance_copy_sha256=repeat('d',64)
where singleton;
select public.ap_upgrade_completed_intake_legal_acceptance(
  'e5000000-0000-4000-8000-000000000001',repeat('c',64),
  'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
  'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
  'applypack-legal-acceptance-copy-fixture-v2',repeat('d',64),
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('d',64)
);
select public.ap_upgrade_completed_intake_legal_acceptance(
  'e5000000-0000-4000-8000-000000000001',repeat('c',64),
  'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
  'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
  'applypack-legal-acceptance-copy-fixture-v2',repeat('d',64),
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('d',64)
);
select pg_temp.assert_true(
  public.ap_has_current_content_bound_legal_acceptance(
    'e5000000-0000-4000-8000-000000000001','e5300000-0000-4000-8000-000000000001')
  and (select count(*)=3 from public.ap_snapshot_legal_acceptances
       where snapshot_id='e5300000-0000-4000-8000-000000000001')
  and (select count(*)=2 from public.ap_snapshot_legal_content_receipts
       where snapshot_id='e5300000-0000-4000-8000-000000000001'),
  'copy-only revision or its exact replay did not append exactly one immutable episode'
);

update public.ap_commerce_configuration
set terms_version='manual-launch-terms-fixture-v3',
    terms_content_sha256=repeat('e',64)
where singleton;
select public.ap_upgrade_completed_intake_legal_acceptance(
  'e5000000-0000-4000-8000-000000000001',repeat('c',64),
  'manual-launch-terms-fixture-v3',repeat('e',64),
  'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
  'applypack-legal-acceptance-copy-fixture-v2',repeat('d',64),
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('e',64)
);
select pg_temp.assert_true(
  public.ap_has_current_content_bound_legal_acceptance(
    'e5000000-0000-4000-8000-000000000001','e5300000-0000-4000-8000-000000000001')
  and (select count(*)=3 from public.ap_snapshot_legal_content_receipts
       where snapshot_id='e5300000-0000-4000-8000-000000000001'),
  'Terms revision did not append a current immutable acceptance episode'
);

update public.ap_commerce_configuration
set privacy_version='privacy-fixture-v2',
    privacy_content_sha256=repeat('f',64)
where singleton;
select public.ap_upgrade_completed_intake_legal_acceptance(
  'e5000000-0000-4000-8000-000000000001',repeat('c',64),
  'manual-launch-terms-fixture-v3',repeat('e',64),
  'privacy-fixture-v2',repeat('f',64),
  'applypack-legal-acceptance-copy-fixture-v2',repeat('d',64),
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('f',64)
);
select pg_temp.assert_true(
  public.ap_has_current_content_bound_legal_acceptance(
    'e5000000-0000-4000-8000-000000000001','e5300000-0000-4000-8000-000000000001')
  and (select count(*)=5 from public.ap_snapshot_legal_acceptances
       where snapshot_id='e5300000-0000-4000-8000-000000000001')
  and (select count(*)=4 from public.ap_snapshot_legal_content_receipts
       where snapshot_id='e5300000-0000-4000-8000-000000000001'),
  'Privacy revision did not append a current immutable acceptance episode'
);

select pg_temp.assert_true(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'public.ap_upgrade_completed_intake_legal_acceptance(uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure
  ))>0
  and exists(
    select 1 from pg_constraint
    where conrelid='public.ap_snapshot_legal_acceptances'::regclass
      and conname='ap_snapshot_legal_acceptances_snapshot_hash_key'
  )
  and exists(
    select 1 from pg_constraint
    where conrelid='public.ap_snapshot_legal_content_receipts'::regclass
      and conname='ap_snapshot_legal_content_receipts_snapshot_hash_key'
  )
  and exists(
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.proname='ap_finalize_four_step_intake_with_legal_acceptance_v3'
      and pg_get_functiondef(procedure.oid) like '%acceptance.acceptance_sha256=p_acceptance_sha256%'
  )
  and exists(
    select 1 from pg_trigger
    where tgrelid='public.ap_legal_receipt_acceptance_reconciliations'::regclass
      and tgname='ap_legal_receipt_acceptance_reconciliations_immutable'
      and not tgisinternal
  ),
  'legal re-consent is missing serialized, append-only idempotency controls'
);

select pg_temp.assert_true(
  not has_function_privilege('anon','public.ap_finalize_four_step_intake(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.ap_finalize_four_step_intake(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.ap_record_snapshot_legal_acceptance(uuid,text,uuid,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.ap_record_snapshot_legal_acceptance(uuid,text,uuid,text,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.ap_finalize_four_step_intake_with_legal_acceptance(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.ap_finalize_four_step_intake_with_legal_acceptance(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb,text,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.ap_finalize_four_step_intake_with_legal_acceptance_v2(uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.ap_finalize_four_step_intake_with_legal_acceptance_v2(uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,text,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.ap_finalize_four_step_intake_with_legal_acceptance_v3(uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.ap_finalize_four_step_intake_with_legal_acceptance_v3(uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.ap_finalize_four_step_intake(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb)','EXECUTE')
  and has_function_privilege('service_role','public.ap_record_snapshot_legal_acceptance(uuid,text,uuid,text,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.ap_finalize_four_step_intake_with_legal_acceptance(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb,text,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.ap_finalize_four_step_intake_with_legal_acceptance_v2(uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,text,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.ap_record_snapshot_legal_content_receipt(uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.ap_record_snapshot_legal_content_receipt(uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.ap_record_snapshot_legal_content_receipt(uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.ap_upgrade_completed_intake_legal_acceptance(uuid,text,text,text,text,text,text,text,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.ap_upgrade_completed_intake_legal_acceptance(uuid,text,text,text,text,text,text,text,text,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.ap_upgrade_completed_intake_legal_acceptance(uuid,text,text,text,text,text,text,text,text,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.ap_finalize_four_step_intake_with_legal_acceptance_v3(uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text)','EXECUTE'),
  'intake finalization function privileges are not fail closed'
);

rollback;
