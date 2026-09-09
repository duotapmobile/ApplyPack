begin;

create function pg_temp.assert_true(value boolean, failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%', failure_message; end if; end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('16000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','claim-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('16000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-owner@example.invalid','',now(),'{}','{}',now(),now());

select * from public.ap_create_anonymous_draft(
  '36000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day'
);
update public.ap_anonymous_drafts set access_email_normalized='claim-owner@example.invalid'
where id='36000000-0000-4000-8000-000000000001';

insert into public.ap_intake_snapshots(
  id,draft_id,customer_id,parent_snapshot_id,version,snapshot_kind,access_email_normalized,
  payer_receipt_email,document_contact_email,desired_activities,avoided_activities,optional_titles,
  confirmed_title_restriction,optional_industries,blocked_industries,search_breadth,guidance_requested,
  work_modes,us_state_or_dc,employment_types,schedules,travel,benefits,dealbreakers,salary_target_cents,
  salary_hard_minimum_cents,salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,
  salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,
  prior_cover_letter_use,targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at
) values (
  '56000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000001',null,null,1,'INITIAL',
  'claim-owner@example.invalid',null,'claim-owner@example.invalid','["helping customers"]','["cold calling"]','[]',
  null,'[]','[]','ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',
  6000000,5000000,false,'YEAR','BASE','PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW',
  'EXCLUDE_VARIABLE','{}','NEITHER','{}',repeat('5',64),'applypack-c14n-v1','applypack-foundation-v1',now()
);
update public.ap_anonymous_drafts set state='COMPLETE',finalized_snapshot_id='56000000-0000-4000-8000-000000000001'
where id='36000000-0000-4000-8000-000000000001';

do $$ begin
  perform public.ap_claim_board_profile('36000000-0000-4000-8000-000000000001',repeat('a',64),
    '16000000-0000-4000-8000-000000000002','other-owner@example.invalid');
  raise exception 'mismatched_profile_email_was_accepted';
exception when raise_exception then
  if sqlerrm='mismatched_profile_email_was_accepted' then raise; end if;
  if sqlerrm<>'board_profile_email_or_owner_mismatch' then raise; end if;
end $$;

select pg_temp.assert_true(
  public.ap_claim_board_profile('36000000-0000-4000-8000-000000000001',repeat('a',64),
    '16000000-0000-4000-8000-000000000001','CLAIM-OWNER@EXAMPLE.INVALID')
    ='56000000-0000-4000-8000-000000000001',
  'valid finalized profile was not claimed'
);
select pg_temp.assert_true(
  (select customer_id is null from public.ap_intake_snapshots
    where id='56000000-0000-4000-8000-000000000001')
  and (select customer_id='16000000-0000-4000-8000-000000000001' from public.ap_board_profile_claims
    where profile_snapshot_id='56000000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_board_recompute_jobs
    where profile_snapshot_id='56000000-0000-4000-8000-000000000001' and state='PENDING'),
  'immutable profile claim or recomputation queue was not established'
);

insert into public.jobs(id,company,title,source_url,checked_at)
values('66000000-0000-4000-8000-000000000001','Synthetic Fixture Employer','Support Specialist',
  'https://example.invalid/jobs/fixture',now());
select pg_temp.assert_true(
  (select count(*)=1 from public.ap_board_recompute_jobs
    where job_id='66000000-0000-4000-8000-000000000001' and scope='JOB' and state='PENDING'),
  'job creation did not enqueue board recomputation'
);

do $$ declare claimed public.ap_board_recompute_jobs; begin
  select * into claimed from public.ap_claim_board_recompute_jobs('chunk6-worker',1);
  perform pg_temp.assert_true(claimed.state='PROCESSING' and claimed.attempts=1 and claimed.lease_owner='chunk6-worker',
    'recompute job was not leased atomically');
  perform pg_temp.assert_true(public.ap_finish_board_recompute_job(claimed.id,'chunk6-worker',true,null),
    'leased recompute job could not be completed');
end $$;
select pg_temp.assert_true(
  (select count(*)=1 from public.ap_board_recompute_jobs where state='COMPLETED' and completed_at is not null),
  'recompute completion invariant failed'
);

select pg_temp.assert_true(
  (select pg_get_constraintdef(oid) like '%BOARD_MATERIAL_SOURCE%'
      and pg_get_constraintdef(oid) like '%"position" IS NULL%'
      and pg_get_constraintdef(oid) like '%ranking_score IS NULL%'
    from pg_constraint where conname='job_matches_match_kind_check'),
  'board material lineage is not structurally unranked'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.ap_board_recompute_jobs','select')
  and not has_table_privilege('authenticated','public.ap_board_provider_events','select')
  and not has_table_privilege('authenticated','public.ap_board_profile_claims','select'),
  'internal board ownership, queue, or provider evidence leaked to customers'
);

rollback;
