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
  prior_cover_letter_use,targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at,preferred_work_mode,preferred_employment_type,work_condition_preferences)
values('87300000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000001','87100000-0000-4000-8000-000000000001',
  '87000000-0000-4000-8000-000000000001',1,'INITIAL','retention-new@example.invalid','["synthetic private activity"]','[]','[]','[]','[]',
  'ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','["FULL_TIME"]','[]','{}','{}','[]',false,
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',repeat('b',64),'applypack-c14n-v1','applypack-intake-v3',now(),'REMOTE','FULL_TIME','{"fictionalPrivatePreference":"quiet environment"}');
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
insert into public.ap_feasibility_requests(draft_id,snapshot_id,idempotency_key,request_version)
values('87200000-0000-4000-8000-000000000001','87300000-0000-4000-8000-000000000001','retention-feasibility','v1');


-- The real cleanup schema must install every declared private-column patch.
select pg_temp.assert_retention(not exists(select 1 from public.ap_retention_private_tables p cross join lateral jsonb_object_keys(p.redaction_patch) k where not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=p.table_name::text and c.column_name=k)), 'redaction manifest has exact live columns');
select pg_temp.assert_retention(public.ap_one_off_retention_schema_installed(),'cleanup schema connected');
select pg_temp.assert_retention(not has_function_privilege('authenticated','public.ap_claim_expired_service_retention(integer)','execute'),'customer cannot claim cleanup');
select pg_temp.assert_retention(not has_function_privilege('service_role','public.ap_redact_service_retention_claim(uuid)','execute'),'raw redactor is private');
select pg_temp.assert_retention(not has_table_privilege('service_role','public.ap_retention_redaction_permits','insert'),'no forgeable exact-row permit');
savepoint before_cleanup;
select pg_temp.assert_retention(not public.ap_legacy_retention_object_allowed('customer-source-documents','synthetic/resume.pdf'),'legacy cleanup cannot claim a prospective shared path');
select pg_temp.assert_retention(public.ap_legacy_retention_object_allowed('customer-source-documents','synthetic/legacy-only.pdf'),'legacy cleanup commits an exact path intent');
select pg_temp.retention_error($q$insert into public.intakes(id,customer_id,email,direction,dealbreakers,location_preference,schedule_preference,experience_summary,resume_path) values('89100000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','retention-new@example.invalid','New','New','Remote','Day','New','synthetic/legacy-only.pdf')$q$,'service_retention_object_removal_committed');
rollback to savepoint before_cleanup;
insert into public.intakes(id,customer_id,email,direction,dealbreakers,location_preference,schedule_preference,experience_summary,resume_path)
values('89100000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002','retention-old@example.invalid','Historical','Historical','Remote','Day','Historical','synthetic/resume.pdf');
select pg_temp.assert_retention(jsonb_array_length(public.ap_claim_expired_service_retention(5))=0,'shared historical object vetoes cleanup');
rollback to savepoint before_cleanup;
insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,catalog_version,schema_version)
values('89c00000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002','87300000-0000-4000-8000-000000000001','shared','text','{"text":"shared synthetic fact"}','CUSTOMER_ASSERTION','87300000-0000-4000-8000-000000000001','shared','shared','CUSTOMER_CONFIRMED','v1','v1');
select pg_temp.assert_retention(jsonb_array_length(public.ap_claim_expired_service_retention(5))=0,'cross-customer private row vetoes cleanup');
rollback to savepoint before_cleanup;
-- A verification source may be owned by one customer while a fact using it
-- belongs to another. Ownership follows the actual FK before cleanup claims.
insert into public.ap_sensitive_payloads(id,customer_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
values('89d00000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001',decode('01','hex'),'AES-256-GCM',decode('01','hex'),decode(repeat('00',12),'hex'),decode(repeat('00',16),'hex'),repeat('a',64),'fictional-local-key','fictional-v1',repeat('b',64));
insert into public.ap_independent_verification_sources(id,customer_id,encrypted_payload_id,source_type,source_locator,content_sha256,reviewer_id,verified_at)
values('89e00000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','89d00000-0000-4000-8000-000000000001','fictional','fictional private verification',repeat('c',64),'87000000-0000-4000-8000-000000000003',now());
insert into public.ap_candidate_facts(id,customer_id,semantic_key,value_kind,typed_value,source_kind,supplied_source_id,human_reviewer_id,source_locator,verification,catalog_version,schema_version)
values('89c00000-0000-4000-8000-000000000002','87000000-0000-4000-8000-000000000002','shared-verification','text','{"text":"fictional shared verification"}','HUMAN_VERIFICATION','89e00000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000003','fictional','HUMAN_VERIFIED','v1','v1');
select pg_temp.assert_retention((select cardinality(public.ap_retention_row_customers('ap_candidate_facts',to_jsonb(f)))=2 from public.ap_candidate_facts f where id='89c00000-0000-4000-8000-000000000002'),'verification-source ownership traverses to both customers');
select pg_temp.assert_retention(jsonb_array_length(public.ap_claim_expired_service_retention(5))=0,'shared independent verification source vetoes cleanup');
rollback to savepoint before_cleanup;
insert into public.ap_payment_attempts(id,customer_id,draft_id,provider,amount_cents,currency,settlement)
values('89800000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','87200000-0000-4000-8000-000000000001','stripe',1899,'USD','PROCESSING');
select pg_temp.assert_retention(jsonb_array_length(public.ap_claim_expired_service_retention(5))=0,'unresolved payment prevents cleanup');
rollback to savepoint before_cleanup;
select public.ap_set_service_retention_hold('87900000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000003','LEGAL_REQUIREMENT');
select pg_temp.assert_retention(jsonb_array_length(public.ap_claim_expired_service_retention(5))=0,'held expired family cannot be claimed');
rollback to savepoint before_cleanup;
select pg_temp.assert_retention(jsonb_array_length(public.ap_claim_expired_service_retention(5))=1,'expired completed family is claimed');
select pg_temp.assert_retention((select state='PURGING' from public.ap_order_retention_contracts where order_id='87900000-0000-4000-8000-000000000001'),'durable purge intent');
select pg_temp.assert_retention((select count(*)=1 from public.ap_service_retention_objects),'complete object graph');
select pg_temp.assert_retention(not public.ap_finish_service_retention_claim((select id from public.ap_service_retention_claims)),'unfinished removal cannot redact');
select pg_temp.retention_error($q$insert into public.intake_answers(intake_id,customer_id,answers) values('87100000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','{"private":"late"}')$q$,'service_retention_purge_committed');
select pg_temp.retention_error($q$select public.ap_set_service_retention_hold('87900000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000003','LEGAL_REQUIREMENT')$q$,'service_retention_purge_committed');
select pg_temp.retention_error($q$insert into public.intakes(id,customer_id,email,direction,dealbreakers,location_preference,schedule_preference,experience_summary,resume_path) values('89100000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002','retention-old@example.invalid','Historical','Historical','Remote','Day','Historical','synthetic/resume.pdf')$q$,'service_retention_object_removal_committed');
select pg_temp.assert_retention(public.ap_authorize_service_retention_object((select id from public.ap_service_retention_claims),(select id from public.ap_service_retention_objects))->>'path'='synthetic/resume.pdf','per-object authorization resolves exact owned path');
-- The storage acknowledgement is simulated here; API failure/retry is tested by
-- the worker test. This engine test does not claim hosted byte removal.
select pg_temp.assert_retention(public.ap_finish_service_retention_object((select id from public.ap_service_retention_claims),(select id from public.ap_service_retention_objects)),'successful acknowledgement');
select pg_temp.assert_retention(public.ap_finish_service_retention_claim((select id from public.ap_service_retention_claims)),'all private rows redacted');
select pg_temp.assert_retention((select typed_value='{}'::jsonb from public.ap_candidate_facts where id='87c00000-0000-4000-8000-000000000001'),'fact body removed');
select pg_temp.assert_retention((select desired_activities='[]'::jsonb from public.ap_intake_snapshots where id='87300000-0000-4000-8000-000000000001'),'snapshot body removed');
select pg_temp.assert_retention((select preferred_work_mode is null and preferred_employment_type is null and work_condition_preferences='{}'::jsonb from public.ap_intake_snapshots where id='87300000-0000-4000-8000-000000000001'),'private work preferences removed');
select pg_temp.assert_retention((select fit_summary='removed' from public.job_matches where id='87f00000-0000-4000-8000-000000000001'),'matching body removed');
select pg_temp.assert_retention((select answers='{}'::jsonb from public.intake_answers where intake_id='87100000-0000-4000-8000-000000000001'),'redundant answers removed');
select pg_temp.assert_retention((select state='STALE' and stale_reason='SERVICE_CONTENT_REMOVED' from public.ap_feasibility_requests),'purged research cannot remain an active queue item');
select pg_temp.assert_retention((select count(*)=1 from public.ap_payment_attempts where amount_cents=1899 and settlement='PAID'),'financial evidence retained');
select pg_temp.assert_retention((select acceptance_sha256=repeat('c',64) from public.ap_snapshot_legal_content_receipts),'consent evidence unchanged');
select pg_temp.assert_retention((select state='PURGED' from public.ap_order_retention_contracts where order_id='87900000-0000-4000-8000-000000000001'),'purge completes');
select pg_temp.assert_retention(public.ap_finish_service_retention_claim((select id from public.ap_service_retention_claims)),'complete retry idempotent');
select pg_temp.assert_retention((select count(*)=0 from public.ap_retention_redaction_permits),'no residual permit');
select pg_temp.assert_retention(public.ap_service_retention_access_allowed('87900000-0000-4000-8000-000000000002'),'historical entitlement preserved');

-- Restore the stale synthetic database state before deletion, then apply the
-- current source overlay using the actual SQL sanitizer. No dummy RPC is used.
rollback to savepoint before_cleanup;
create function pg_temp.apply_overlay(value jsonb) returns jsonb language sql as $$
 select public.ap_apply_retention_restore_overlay(value::text,encode(extensions.digest(value::text,'sha256'),'hex'));
$$;
create temp table current_overlay as select public.ap_export_service_retention_overlay() value;
select pg_temp.retention_error($q$select public.ap_apply_retention_restore_overlay((select value::text from current_overlay),repeat('f',64))$q$,'retention_restore_digest_invalid');
select pg_temp.retention_error($q$select pg_temp.apply_overlay((select value-'schemaVersion' from current_overlay))$q$,'retention_restore_overlay_invalid');
select pg_temp.retention_error($q$select pg_temp.apply_overlay((select jsonb_set(value,'{orders}','[]') from current_overlay))$q$,'retention_restore_contract_coverage_missing');
select pg_temp.retention_error($q$select pg_temp.apply_overlay((select jsonb_set(value,'{sourceWatermark}','"2000-01-01T00:00:00Z"') from current_overlay))$q$,'retention_restore_stale');
select pg_temp.assert_retention((pg_temp.apply_overlay((select value from current_overlay))->>'ordersSanitized')::integer=1,'real stale-database sanitation');
select pg_temp.assert_retention((pg_temp.apply_overlay((select value from current_overlay))->>'ordersSanitized')::integer=1,'restore retries return the same durable receipt');
select pg_temp.assert_retention((select typed_value='{}' from public.ap_candidate_facts where id='87c00000-0000-4000-8000-000000000001'),'stale restored private facts removed');
select pg_temp.assert_retention((select count(*)=1 from public.ap_retention_restored_object_policies),'expiry exclusion persisted for subsequent backups');
select pg_temp.assert_retention((select locked from public.ap_retention_restore_lock),'restore remains locked');
select pg_temp.assert_retention(not public.ap_service_retention_access_allowed('87900000-0000-4000-8000-000000000002'),'restore lock covers historical direct access');
select pg_temp.assert_retention((select count(*)=1 from public.ap_payment_attempts where amount_cents=1899 and settlement='PAID'),'restore preserves payments');
select 'SERVICE_RETENTION_CLEANUP_OK';
rollback;
