insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values(
  'f6000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','inventory-upgrade-reviewer@example.invalid','',now(),'{}','{}',now(),now()
);
update public.profiles set role='admin' where id='f6000000-0000-4000-8000-000000000001';

insert into public.ap_anonymous_drafts(
  id,capability_secret_hash,state,expires_at,flow_version,answers
) values(
  'f6100000-0000-4000-8000-000000000001',repeat('a',64),'IN_PROGRESS',
  clock_timestamp()+interval '1 day','FOUR_STEP_RESPONSIBILITY_V1',
  '{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1"}'
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
  'f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000001',1,'INITIAL',
  'inventory-upgrade-customer@example.invalid',null,'inventory-upgrade-customer@example.invalid',
  '["COORDINATING_PROJECTS"]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,
  '["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',7000000,6000000,false,'YEAR','BASE',
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',
  repeat('b',64),'applypack-c14n-v1','applypack-intake-v3',clock_timestamp()-interval '2 minutes'
);
update public.ap_anonymous_drafts set
  state='COMPLETE',finalized_snapshot_id='f6200000-0000-4000-8000-000000000001',current_step=3
where id='f6100000-0000-4000-8000-000000000001';

insert into public.ap_inventory_versions(
  id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256
) values(
  'f6300000-0000-4000-8000-000000000001',clock_timestamp(),'source-auth-v1',
  'identity-upgrade-v1','listing-requirements-v3',repeat('c',64)
);
insert into public.ap_feasibility_source_configurations(
  id,source_authorization_id,config_version,pagination_bound,lookback_bound,result_bound,
  release_verification_ttl,parser_version,cutoff_version,content_sha256,approved_by_role,approved_at
)
select
  'f6400000-0000-4000-8000-000000000001',source_authorization.id,'identity-upgrade-v1',1,
  interval '30 days',50,interval '1 hour','listing-requirements-v3','identity-upgrade-v1',
  repeat('d',64),'operator',clock_timestamp()
from public.ap_source_authorizations source_authorization
where source_authorization.source_id='manual-reviewed' and source_authorization.state='AUTHORIZED_MANUAL_ONLY'
order by source_authorization.created_at
limit 1;
insert into public.ap_feasibility_coverage_plans(
  id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256
) values(
  'f6500000-0000-4000-8000-000000000001','f6200000-0000-4000-8000-000000000001',
  'f6300000-0000-4000-8000-000000000001','feasibility-v1',
  '{"requiredFamilyIds":["responsibility-family"],"breadth":"ADJACENT_OPPORTUNITIES"}',
  'REQUIRED',repeat('e',64)
);
insert into public.ap_feasibility_coverage_cells(
  plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,
  result_bound,execution_path,terminal_outcome,cursor_or_stop_reason,result_count,parser_result,
  started_at,completed_at,query_family_id,source_authorization_id,configuration_id,
  configured_bound_satisfied,normalized_and_deduplicated,manual_checklist_complete
)
select
  'f6500000-0000-4000-8000-000000000001','manual-reviewed','AUTHORIZED_MANUAL_ONLY',
  repeat('f',64),1,interval '30 days',50,'MANUAL','SUCCEEDED_WITH_RESULTS',
  'identity-upgrade-fixture',10,'{"status":"COMPLETE"}',clock_timestamp(),clock_timestamp(),
  'responsibility-family',configuration.source_authorization_id,configuration.id,true,true,true
from public.ap_feasibility_source_configurations configuration
where configuration.id='f6400000-0000-4000-8000-000000000001';
insert into public.ap_feasibility_assessments(
  id,snapshot_id,coverage_plan_id,state,outcome,resolution_blocker,preliminarily_deliverable_count,
  reviewable_count,excluded_count,reasons,primary_reason,rules_version,expires_at
) values(
  'f6600000-0000-4000-8000-000000000001','f6200000-0000-4000-8000-000000000001',
  'f6500000-0000-4000-8000-000000000001','COMPLETE','LIKELY','NONE',10,0,0,'{}',null,
  'pre-atomic-identity-v1',clock_timestamp()+interval '1 hour'
);
insert into public.ap_feasibility_requests(
  id,draft_id,snapshot_id,state,request_version,idempotency_key,completed_assessment_id,stale_reason,error_code
) values(
  'f6700000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000001',
  'f6200000-0000-4000-8000-000000000001','COMPLETED','feasibility-v1',
  'identity-policy-upgrade-fixture','f6600000-0000-4000-8000-000000000001','old-stale-reason','old-error-code'
);
insert into public.ap_capacity_pools(id,resource,enabled,configuration_version)
values('f6800000-0000-4000-8000-000000000001','SEARCH',true,'identity-upgrade-v1');
insert into public.ap_capacity_buckets(id,pool_id,starts_at,ends_at,total_units,staffing_version)
values(
  'f6900000-0000-4000-8000-000000000001','f6800000-0000-4000-8000-000000000001',
  clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 days',1,'identity-upgrade-v1'
);
insert into public.ap_capacity_allocations(
  id,bucket_id,draft_id,units,lifecycle,debit_disposition,criteria_revision_id,request_key,
  staffing_version,reserved_at,expires_at,audit_version
) values(
  'f6a00000-0000-4000-8000-000000000001','f6900000-0000-4000-8000-000000000001',
  'f6100000-0000-4000-8000-000000000001',1,'RESERVED','HELD',
  'f6200000-0000-4000-8000-000000000001','search-invitation:f6b00000-0000-4000-8000-000000000001',
  'identity-upgrade-v1',clock_timestamp(),clock_timestamp()+interval '20 minutes','manual-launch-v2'
);
insert into public.ap_search_checkout_invitations(
  id,draft_id,snapshot_id,assessment_id,capacity_allocation_id,secret_hash,issued_by,issued_at,expires_at,rationale
) values(
  'f6b00000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000001',
  'f6200000-0000-4000-8000-000000000001','f6600000-0000-4000-8000-000000000001',
  'f6a00000-0000-4000-8000-000000000001',repeat('1',64),'f6000000-0000-4000-8000-000000000001',
  clock_timestamp(),clock_timestamp()+interval '20 minutes',
  'Pre-policy invitation that must be revoked during the identity-policy cutover.'
);
insert into public.ap_quotes(
  id,draft_id,snapshot_id,feasibility_assessment_id,price_cents,currency,tax_inclusive,content_sha256,expires_at
) values(
  'f6c00000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000001',
  'f6200000-0000-4000-8000-000000000001','f6600000-0000-4000-8000-000000000001',
  1899,'USD',true,repeat('2',64),clock_timestamp()+interval '20 minutes'
);

select 'ATOMIC_INVENTORY_077_FIXTURE_OK' as case;
