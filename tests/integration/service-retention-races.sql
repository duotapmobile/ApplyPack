begin;
create function pg_temp.assert_retention(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'retention assertion: %',message; end if; end $$;
create function pg_temp.retention_error(statement text,expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm=expected then return; end if; raise;
  end;
  raise exception 'expected retention rejection: %',expected;
end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('87000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retention-new@example.invalid','',now(),'{}','{}',now(),now()),
('87000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retention-old@example.invalid','',now(),'{}','{}',now(),now()),
('87000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retention-admin@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='87000000-0000-4000-8000-000000000003';
insert into public.intakes(id,customer_id,email,direction,dealbreakers,location_preference,schedule_preference,experience_summary,resume_path)
values('87100000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','retention-new@example.invalid','Synthetic private direction','Synthetic private constraint','Remote','Day','Synthetic private experience','synthetic/resume.pdf');
insert into public.intake_answers(intake_id,customer_id,answers) values('87100000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','{"private":"synthetic"}');
select * from public.ap_create_anonymous_draft('87200000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day');
insert into public.ap_intake_snapshots(id,draft_id,intake_id,customer_id,version,snapshot_kind,access_email_normalized,
  desired_activities,avoided_activities,optional_titles,optional_industries,blocked_industries,search_breadth,guidance_requested,
  work_modes,employment_types,schedules,travel,benefits,dealbreakers,salary_minimum_flexible,salary_overlap_policy,
  salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,
  prior_cover_letter_use,targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at)
values('87300000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000001','87100000-0000-4000-8000-000000000001',
  '87000000-0000-4000-8000-000000000001',1,'INITIAL','retention-new@example.invalid','["synthetic private activity"]','[]','[]','[]','[]',
  'ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','["FULL_TIME"]','[]','{}','{}','[]',false,
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',repeat('b',64),'applypack-c14n-v1','applypack-intake-v3',now());
insert into public.ap_snapshot_legal_acceptances(id,draft_id,snapshot_id,terms_version,privacy_version,acceptance_sha256)
values('87400000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000001','87300000-0000-4000-8000-000000000001',
  'manual-launch-terms-2026-10-24-v3','privacy-2026-10-24-v3',repeat('c',64));
insert into public.ap_snapshot_legal_content_receipts(id,legal_acceptance_id,draft_id,snapshot_id,terms_version,terms_content_sha256,
  privacy_version,privacy_content_sha256,acceptance_copy_version,acceptance_copy_sha256,content_canonicalization_version,receipt_schema_version,acceptance_sha256)
select '87500000-0000-4000-8000-000000000001','87400000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000001',
  '87300000-0000-4000-8000-000000000001',terms_version,terms_content_sha256,privacy_version,privacy_content_sha256,
  legal_acceptance_copy_version,legal_acceptance_copy_sha256,legal_content_canonicalization_version,legal_receipt_schema_version,repeat('c',64)
from public.ap_commerce_configuration where singleton;
insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key)
values('87600000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','CREATE_CHECKOUT','stripe',repeat('d',64),'retention-fixture-command');
insert into public.ap_checkout_attempts(id,customer_id,draft_id,command_id)
values('87700000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000001','87600000-0000-4000-8000-000000000001');
-- Only this synthetic superuser fixture seeds a prospective consent binding.
-- Production checkout remains blocked until the separately authorized executor exists.
insert into public.ap_retention_checkout_contracts(checkout_attempt_id,legal_receipt_id,policy_version)
values('87700000-0000-4000-8000-000000000001','87500000-0000-4000-8000-000000000001','one_off_30d_v1');
insert into public.ap_payment_attempts(id,customer_id,draft_id,checkout_attempt_id,provider,amount_cents,currency,settlement,payment_verified_at,immediate_charge_verified)
values('87800000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000001',
  '87700000-0000-4000-8000-000000000001','stripe',1899,'USD','PAID',now()-interval '745 hours',true);
insert into public.orders(id,customer_id,intake_id,product_kind,amount_cents,status,paid_at,delivered_at)
values('87900000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','87100000-0000-4000-8000-000000000001','job_search',1899,'delivered',now()-interval '745 hours',now()-interval '744 hours'),
('87900000-0000-4000-8000-000000000002','87000000-0000-4000-8000-000000000002',null,'job_search',1899,'delivered',now()-interval '1500 hours',now()-interval '1499 hours');
insert into public.ap_search_services(id,legacy_order_id,customer_id,winning_payment_attempt_id,original_snapshot_id,active_snapshot_id,fulfillment,legacy_record)
values('87a00000-0000-4000-8000-000000000001','87900000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001',
  '87800000-0000-4000-8000-000000000001','87300000-0000-4000-8000-000000000001','87300000-0000-4000-8000-000000000001','DELIVERED',true),
('87a00000-0000-4000-8000-000000000002','87900000-0000-4000-8000-000000000002','87000000-0000-4000-8000-000000000002',null,null,null,'DELIVERED',true);
insert into public.ap_releases(id,customer_id,order_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by)
values('87b00000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','87900000-0000-4000-8000-000000000001','SEARCH_EXACT_TEN',
  now()-interval '744 hours',now()-interval '743 hours','{}','87000000-0000-4000-8000-000000000003');
insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,
  assertion_control_id,source_locator,verification,catalog_version,schema_version)
values('87c00000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','87300000-0000-4000-8000-000000000001',
  'synthetic','text','{"text":"synthetic private fact"}','CUSTOMER_ASSERTION','87300000-0000-4000-8000-000000000001','synthetic','synthetic','CUSTOMER_CONFIRMED','v1','v1');
insert into public.ap_reference_records(id,customer_id) values('87d00000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001');
insert into public.jobs(id,company,title,source_url,checked_at) values('87e00000-0000-4000-8000-000000000001','Synthetic employer','Synthetic position','https://example.invalid/job',now());
insert into public.job_matches(id,search_order_id,job_id,position,fit_summary,delivered_at)
values('87f00000-0000-4000-8000-000000000001','87900000-0000-4000-8000-000000000001','87e00000-0000-4000-8000-000000000001',1,'Synthetic private fit',now()-interval '744 hours');



commit;
-- This fixture is only selected by the isolated native PostgreSQL runner. Two
-- real independent connections race against the actual durable-claim guards.
do $$begin if current_setting('listen_addresses')<>'127.0.0.1' then raise exception 'native_loopback_fixture_required'; end if; end$$;
create extension if not exists dblink with schema extensions;
select extensions.dblink_connect('retention_racer','host=127.0.0.1 port='||current_setting('port')||' dbname='||current_database()||' user=postgres application_name=applypack_retention_racer');
create function public.retention_fixture_hold_delay() returns text language plpgsql as $$begin
 perform public.ap_set_service_retention_hold('87900000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000003','LEGAL_REQUIREMENT');
 perform pg_sleep(2); return 'held';
end$$;
create function public.retention_fixture_claim_delay() returns text language plpgsql as $$declare result jsonb; begin
 result:=public.ap_claim_expired_service_retention(5); perform pg_sleep(2); return result::text;
end$$;
create function pg_temp.wait_for_retention_lock(minimum_locks integer default 1) returns void language plpgsql as $$begin
 for attempt in 1..100 loop
   if (select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='applypack_retention_racer' and l.locktype='advisory' and l.granted)>=minimum_locks then return; end if;
   perform pg_sleep(0.02);
 end loop;
 raise exception 'concurrent_fixture_never_acquired_lock';
end$$;
select extensions.dblink_send_query('retention_racer','select public.retention_fixture_hold_delay()');
select pg_temp.wait_for_retention_lock();
select pg_temp.assert_retention(jsonb_array_length(public.ap_claim_expired_service_retention(5))=0,'concurrent hold wins before claim');
select result from extensions.dblink_get_result('retention_racer') as r(result text);
select result from extensions.dblink_get_result('retention_racer') as r(result text);
select public.ap_set_service_retention_hold('87900000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000003','LEGAL_REQUIREMENT',(select id from public.ap_service_retention_holds where released_at is null),true);
select extensions.dblink_send_query('retention_racer','select public.retention_fixture_claim_delay()');
select pg_temp.wait_for_retention_lock(2);
select pg_temp.retention_error($q$insert into public.intakes(id,customer_id,email,direction,dealbreakers,location_preference,schedule_preference,experience_summary,resume_path) values('89100000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002','retention-old@example.invalid','Historical','Historical','Remote','Day','Historical','synthetic/resume.pdf')$q$,'service_retention_object_removal_committed');
select result from extensions.dblink_get_result('retention_racer') as r(result text);
select result from extensions.dblink_get_result('retention_racer') as r(result text);
select pg_temp.assert_retention((select count(*)=1 from public.ap_service_retention_claims where state='PENDING'),'only one durable claim');
select pg_temp.assert_retention(not exists(select 1 from public.intakes where id='89100000-0000-4000-8000-000000000001'),'late shared alias not attached');
create function public.retention_fixture_legacy_delay() returns text language plpgsql as $$begin
 if not public.ap_legacy_retention_object_allowed('customer-source-documents','synthetic/legacy-race.pdf') then raise exception 'legacy_claim_failed'; end if;
 perform pg_sleep(2); return 'claimed';
end$$;
select extensions.dblink_send_query('retention_racer','select public.retention_fixture_legacy_delay()');
select pg_temp.wait_for_retention_lock();
select pg_temp.retention_error($q$insert into public.intakes(id,customer_id,email,direction,dealbreakers,location_preference,schedule_preference,experience_summary,resume_path) values('89100000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002','retention-old@example.invalid','Historical','Historical','Remote','Day','Historical','synthetic/legacy-race.pdf')$q$,'service_retention_object_removal_committed');
select result from extensions.dblink_get_result('retention_racer') as r(result text);
select result from extensions.dblink_get_result('retention_racer') as r(result text);
select pg_temp.assert_retention((select count(*)=1 from public.ap_retention_legacy_object_intents),'legacy retry path preserves durable alias fence');
select extensions.dblink_disconnect('retention_racer');
drop function public.retention_fixture_hold_delay();
drop function public.retention_fixture_claim_delay();
drop function public.retention_fixture_legacy_delay();
select 'SERVICE_RETENTION_CONCURRENT_OK';
