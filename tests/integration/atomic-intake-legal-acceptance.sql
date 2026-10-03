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

insert into public.ap_sensitive_payloads(
  id,draft_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,
  authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash
) values(
  'e3200000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),
  decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64)
);

create function pg_temp.reject_legal_receipt()
returns trigger language plpgsql as $$ begin raise exception 'fixture_legal_receipt_failure'; end $$;
create trigger atomic_intake_fixture_reject_legal
before insert on public.ap_snapshot_legal_acceptances
for each row execute function pg_temp.reject_legal_receipt();

do $$
begin
  perform public.ap_finalize_four_step_intake_with_legal_acceptance(
    'e3000000-0000-4000-8000-000000000001',repeat('a',64),2,
    'e3300000-0000-4000-8000-000000000001',
    '{"accessEmailNormalized":"atomic@example.invalid","documentContactEmail":"atomic@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',
    repeat('7',64),'e3200000-0000-4000-8000-000000000001','{}',
    'manual-launch-terms-2026-10-02-v2','privacy-v1',repeat('8',64)
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
  and not exists(select 1 from public.ap_feasibility_requests where snapshot_id='e3300000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.ap_snapshot_legal_acceptances where snapshot_id='e3300000-0000-4000-8000-000000000001'),
  'legal receipt failure left a partially finalized intake'
);

select * from public.ap_finalize_four_step_intake_with_legal_acceptance(
  'e3000000-0000-4000-8000-000000000001',repeat('a',64),2,
  'e3300000-0000-4000-8000-000000000001',
  '{"accessEmailNormalized":"atomic@example.invalid","documentContactEmail":"atomic@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',
  repeat('7',64),'e3200000-0000-4000-8000-000000000001','{}',
  'manual-launch-terms-2026-10-02-v2','privacy-v1',repeat('8',64)
);

-- The stale pre-finalization version is accepted only for an exact replay of
-- the same immutable snapshot and legal receipt.
select * from public.ap_finalize_four_step_intake_with_legal_acceptance(
  'e3000000-0000-4000-8000-000000000001',repeat('a',64),2,
  'e3300000-0000-4000-8000-000000000001',
  '{"accessEmailNormalized":"atomic@example.invalid","documentContactEmail":"atomic@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',
  repeat('7',64),'e3200000-0000-4000-8000-000000000001','{}',
  'manual-launch-terms-2026-10-02-v2','privacy-v1',repeat('8',64)
);

select pg_temp.assert_true(
  (select state='COMPLETE' and finalized_snapshot_id='e3300000-0000-4000-8000-000000000001' and version=3
   from public.ap_anonymous_drafts where id='e3000000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_intake_snapshots where id='e3300000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_feasibility_requests where snapshot_id='e3300000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_snapshot_legal_acceptances where snapshot_id='e3300000-0000-4000-8000-000000000001'),
  'atomic intake finalization or exact replay created inconsistent records'
);

rollback;
