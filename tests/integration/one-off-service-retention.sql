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

do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations)='202610240087' then
    perform pg_temp.assert_retention(not public.ap_one_off_retention_schema_installed(),'unfinished historical087 cleanup must not be schema-ready');
    perform pg_temp.assert_retention((public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion')='202610240087','historical087 schema floor');
    perform pg_temp.assert_retention(not (public.ap_manual_launch_schema_readiness()->>'ready')::boolean,'historical087 schema not ready');
    perform pg_temp.retention_error($q$select public.ap_record_manual_launch_activation('PUBLIC',repeat('a',40),'{}',gen_random_uuid())$q$,
      'service_retention_cleanup_unavailable');
  else
    perform pg_temp.assert_retention((select max(version) from supabase_migrations.schema_migrations) in ('202610250091','202610250092','202610250093','202610250094','202610250095','202610250096'),'exact current schema');
    perform pg_temp.assert_retention(public.ap_one_off_retention_schema_installed(),'current cleanup installed');
    perform pg_temp.assert_retention((public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion') in ('202610250091','202610250092','202610250093','202610250094','202610250095','202610250096'),'current schema floor');
    perform pg_temp.assert_retention((public.ap_manual_launch_schema_readiness()->>'ready')::boolean,'current schema controls installed');
    perform pg_temp.assert_retention(exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED'),'checkout stays locked');
    perform pg_temp.assert_retention(exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled),'purchasing stays disabled');
  end if;
end $$;
select pg_temp.assert_retention(not has_function_privilege('authenticated','public.ap_set_service_retention_hold(uuid,uuid,text,uuid,boolean)','execute'),'hold is service-only');
select pg_temp.assert_retention(not has_table_privilege('service_role','public.ap_retention_redaction_permits','insert'),'no caller-created immutability permits');

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

select pg_temp.assert_retention((select count(*)=1 from public.ap_order_retention_contracts where order_id='87900000-0000-4000-8000-000000000001'),'new bound payment enrolls');
select pg_temp.assert_retention(not exists(select 1 from public.ap_order_retention_contracts where order_id='87900000-0000-4000-8000-000000000002'),'history not backfilled');
select pg_temp.assert_retention(public.ap_service_retention_access_allowed('87900000-0000-4000-8000-000000000002'),'historical access preserved');
select pg_temp.assert_retention(not public.ap_service_retention_access_allowed('87900000-0000-4000-8000-000000000001'),'expired search denied');
select pg_temp.assert_retention(not public.ap_legacy_intake_retention_allowed('87100000-0000-4000-8000-000000000001'),'old source cleanup cannot bypass new contract');
select pg_temp.retention_error($q$update public.ap_order_retention_contracts set policy_version='one_off_30d_v1' where order_id='87900000-0000-4000-8000-000000000001'$q$,'service_retention_history_immutable');
select pg_temp.retention_error($q$update public.job_matches set customer_decision='selected' where id='87f00000-0000-4000-8000-000000000001'$q$,'service_retention_action_expired');
select pg_temp.retention_error($q$insert into public.conflict_reviews(job_match_id,customer_id,explanation,criteria_version) values('87f00000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','Synthetic late claim',1)$q$,'service_retention_action_expired');
select pg_temp.retention_error($q$select public.ap_set_service_retention_hold('87900000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','LEGAL_REQUIREMENT')$q$,'service_retention_hold_invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.assert_retention((select count(*)=0 from public.ap_intake_snapshots where id='87300000-0000-4000-8000-000000000001'),'expired direct snapshot RLS');
select pg_temp.assert_retention((select count(*)=0 from public.ap_candidate_facts where id='87c00000-0000-4000-8000-000000000001'),'expired direct fact RLS');
select pg_temp.assert_retention((select count(*)=0 from public.intake_answers where intake_id='87100000-0000-4000-8000-000000000001'),'expired direct answers RLS');
select pg_temp.assert_retention((select count(*)=0 from public.ap_reference_records where id='87d00000-0000-4000-8000-000000000001'),'expired direct reference RLS');
select pg_temp.assert_retention((select count(*)=0 from public.job_matches where id='87f00000-0000-4000-8000-000000000001'),'expired direct match RLS');
select pg_temp.assert_retention(not public.ap_customer_private_retention_access('87000000-0000-4000-8000-000000000001'),'expired admin-client private DTO gate');
select pg_temp.retention_error($q$select public.ap_customer_retention_access('87000000-0000-4000-8000-000000000002')$q$,'service_retention_owner_required');
reset role;

-- A finite prospective path must not override any historical alias. Exercise
-- artifact provenance plus legacy final, editable and revision paths separately.
savepoint shared_path_proof;
insert into public.ap_generated_artifacts(id,customer_id,order_id,artifact_type,source_snapshot_id,claim_provenance,generator_version)
values('88400000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','87900000-0000-4000-8000-000000000001',
  'RESUME','87300000-0000-4000-8000-000000000001','{"editableSource":{"storageBucket":"operator-drafts","storagePath":"synthetic/shared-artifact.docx"}}','synthetic-historical-generator'),
('88400000-0000-4000-8000-000000000002','87000000-0000-4000-8000-000000000001','87900000-0000-4000-8000-000000000001',
  'COVER_LETTER','87300000-0000-4000-8000-000000000001','{"editableSource":{"storageBucket":"operator-drafts","storagePath":"synthetic/shared-legacy-draft.docx"}}','synthetic-historical-generator');
insert into public.ap_generated_file_versions(id,artifact_id,version,storage_bucket,storage_path,checksum_sha256,mime_type,size_bytes)
values('88500000-0000-4000-8000-000000000001','88400000-0000-4000-8000-000000000001',1,'customer-deliveries','synthetic/shared-final.pdf',repeat('a',64),'application/pdf',100),
('88500000-0000-4000-8000-000000000002','88400000-0000-4000-8000-000000000001',2,'customer-deliveries','synthetic/shared-revision.pdf',repeat('b',64),'application/pdf',100);
select pg_temp.assert_retention((select count(*)=4 and bool_and(not (p->>'protected')::boolean and (p->>'retentionExpiresAt')::timestamptz<now())
  from jsonb_array_elements(public.ap_service_retention_object_policies()) p
  where p->>'bucket' in('customer-deliveries','operator-drafts')),'unshared prospective aliases have finite expired policy');
insert into public.orders(id,customer_id,product_kind,amount_cents,status)
values('87900000-0000-4000-8000-000000000004','87000000-0000-4000-8000-000000000001','job_search',1899,'delivered');
insert into public.ap_generated_artifacts(id,customer_id,order_id,artifact_type,source_snapshot_id,claim_provenance,generator_version)
values('88400000-0000-4000-8000-000000000003','87000000-0000-4000-8000-000000000001','87900000-0000-4000-8000-000000000004',
  'RESUME','87300000-0000-4000-8000-000000000001','{"editableSource":{"storageBucket":"operator-drafts","storagePath":"synthetic/shared-artifact.docx"}}','synthetic-historical-generator');
insert into public.apply_pack_items(id,order_id,job_match_id,resume_path,draft_resume_path)
values('88600000-0000-4000-8000-000000000001','87900000-0000-4000-8000-000000000004','87f00000-0000-4000-8000-000000000001',
  'synthetic/shared-final.pdf','synthetic/shared-legacy-draft.docx');
insert into public.apply_pack_delivery_revisions(apply_pack_item_id,version,resume_path,cover_letter_path,delivered_at)
values('88600000-0000-4000-8000-000000000001',1,'synthetic/shared-revision.pdf','synthetic/historical-only.pdf',now()-interval '900 hours');
select pg_temp.assert_retention((select count(*)=4 and bool_and((p->>'protected')::boolean and p->'retentionExpiresAt'='null'::jsonb)
  from jsonb_array_elements(public.ap_service_retention_object_policies()) p
  where p->>'bucket' in('customer-deliveries','operator-drafts')),'historical artifact, final, draft and revision aliases each veto expiry');
select pg_temp.assert_retention(not exists(select 1 from jsonb_array_elements(public.ap_service_retention_object_policies()) p
  where p->>'pathSha256'=encode(extensions.digest('synthetic/historical-only.pdf','sha256'),'hex')),'unrelated historical paths receive no new policy');
rollback to savepoint shared_path_proof;

-- Required holds preserve bytes without extending customer access.
select public.ap_set_service_retention_hold('87900000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000003','LEGAL_REQUIREMENT');
select pg_temp.assert_retention(public.ap_service_retention_order_protected('87900000-0000-4000-8000-000000000001'),'hold protects');
select pg_temp.assert_retention(not public.ap_service_retention_access_allowed('87900000-0000-4000-8000-000000000001'),'hold does not reopen access');
select public.ap_set_service_retention_hold('87900000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000003','LEGAL_REQUIREMENT',
  (select id from public.ap_service_retention_holds where order_id='87900000-0000-4000-8000-000000000001'),true);
select pg_temp.assert_retention((select count(*)=1 from public.ap_service_retention_holds where released_at is not null),'hold release preserves history');

-- A paid pack still in progress after search day30 retains input access, while
-- search results/actions remain expired. No fictional delivery is introduced.
insert into public.ap_payment_attempts(id,customer_id,provider,amount_cents,currency,settlement,payment_verified_at)
values('88000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','stripe',799,'USD','PAID',now()-interval '25 hours');
insert into public.ap_material_purchases(id,customer_id,payment_attempt_id,amount_cents,currency)
values('88100000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001',799,'USD');
insert into public.ap_material_lines(id,purchase_id,delivered_order_id,delivered_match_id,payment_attempt_id,payment_allocation_key,allocated_amount_cents,fulfillment,materials_payment_verified_at)
values('88200000-0000-4000-8000-000000000001','88100000-0000-4000-8000-000000000001','87900000-0000-4000-8000-000000000001',
  '87f00000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001','retention-paid-line',799,'PAID',now()-interval '25 hours');
set local role authenticated;
select pg_temp.assert_retention(public.ap_customer_private_retention_access('87000000-0000-4000-8000-000000000001'),'pending paid input remains accessible');
select pg_temp.assert_retention((select count(*)=1 from public.ap_candidate_facts where id='87c00000-0000-4000-8000-000000000001'),'pending paid fact RLS');
select pg_temp.assert_retention((select count(*)=1 from public.ap_material_lines where id='88200000-0000-4000-8000-000000000001'),'pending paid material RLS');
select pg_temp.assert_retention((select count(*)=0 from public.job_matches where id='87f00000-0000-4000-8000-000000000001'),'pending pack does not reopen expired search');
reset role;
select pg_temp.assert_retention(public.ap_service_retention_customer_protected('87000000-0000-4000-8000-000000000001'),'pending paid work vetoes purge');

-- Invoke the real download RPC during the final five minutes. All existing
-- ownership, release, provenance and render checks remain active.
update public.ap_commerce_configuration set download_ttl_seconds=900,reauthentication_window_seconds=900 where singleton;
insert into public.ap_releases(id,customer_id,order_id,material_line_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by)
values('88700000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','87900000-0000-4000-8000-000000000001',
  '88200000-0000-4000-8000-000000000001','MATERIAL_PAIR',now()-interval '720 hours'+interval '5 minutes',now(),'{}','87000000-0000-4000-8000-000000000003');
insert into public.ap_generated_artifacts(id,customer_id,order_id,material_line_id,artifact_type,source_snapshot_id,claim_provenance,generator_version,current_file_version)
values('88400000-0000-4000-8000-000000000004','87000000-0000-4000-8000-000000000001','87900000-0000-4000-8000-000000000001',
  '88200000-0000-4000-8000-000000000001','RESUME','87300000-0000-4000-8000-000000000001',
  '{"sourceBinding":{"candidateFactIds":["87c00000-0000-4000-8000-000000000001"]}}',
  'applypack-documents|content=applypack-content-2026-09-22.1|template=applypack-template-2026-09-22.1|exporter=libreoffice-tagged-pdf-2026-09-22.1',1);
insert into public.ap_generated_file_versions(id,artifact_id,version,storage_bucket,storage_path,checksum_sha256,mime_type,size_bytes,safe_filename)
values('88500000-0000-4000-8000-000000000004','88400000-0000-4000-8000-000000000004',1,'customer-deliveries','synthetic/near-deadline.pdf',repeat('a',64),'application/pdf',100,'resume.pdf');
insert into public.ap_artifact_quality_reviews(file_version_id,binding_sha256,structural_checks,provenance_checks,extracted_text_sha256,
  rendered_page_count,renderer_identity,render_preview_bucket,render_preview_path,render_preview_sha256,rendered_page_sha256,
  document_font_family,document_font_sha256,document_font_resolved,document_safety_policy)
values('88500000-0000-4000-8000-000000000004',repeat('a',64),'{}','{}',repeat('b',64),1,'synthetic-verified-renderer',
  'operator-render-previews','synthetic/near-deadline.png',repeat('c',64),array[repeat('c',64)],'Liberation Sans',repeat('d',64),true,'NOT_SCANNED:generated-structural-v1');
insert into public.ap_release_members(release_id,member_type,member_id)
values('88700000-0000-4000-8000-000000000001','GENERATED_ARTIFACT','88400000-0000-4000-8000-000000000004');
select pg_temp.assert_retention((public.ap_authorize_material_download('87000000-0000-4000-8000-000000000001',
  '88400000-0000-4000-8000-000000000004','88500000-0000-4000-8000-000000000004',clock_timestamp())->>'expiresAt')::timestamptz
  =public.ap_material_retention_deadline('88200000-0000-4000-8000-000000000001'),'near-deadline download authorization succeeds and caps expiry');
select pg_temp.assert_retention((select count(*)=1 and bool_and(expires_at>issued_at and expires_at<issued_at+interval '6 minutes')
  from public.ap_material_download_audits where file_version_id='88500000-0000-4000-8000-000000000004'),'shortened authorization audit persisted');

-- Actual functions use elapsed hours even across both New York DST boundaries.
set local timezone='America/New_York';
insert into public.orders(id,customer_id,product_kind,amount_cents,status)
values('87900000-0000-4000-8000-000000000003','87000000-0000-4000-8000-000000000002','job_search',1899,'delivered');
insert into public.ap_releases(id,customer_id,order_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by)
values('88300000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002','87900000-0000-4000-8000-000000000002','SEARCH_EXACT_TEN','2026-03-01T12:00:00-05:00','2026-03-01T13:00:00-05:00','{}','87000000-0000-4000-8000-000000000003'),
('88300000-0000-4000-8000-000000000002','87000000-0000-4000-8000-000000000002','87900000-0000-4000-8000-000000000003','SEARCH_EXACT_TEN','2026-10-24T12:00:00-04:00','2026-10-24T13:00:00-04:00','{}','87000000-0000-4000-8000-000000000003');
select pg_temp.assert_retention((select extract(epoch from(action_expires_at-'2026-03-01T12:00:00-05:00'::timestamptz))=2592000
  from public.ap_service_retention_deadlines('87900000-0000-4000-8000-000000000002')),'spring DST elapsed30day contract');
select pg_temp.assert_retention((select extract(epoch from(access_expires_at-'2026-10-24T12:00:00-04:00'::timestamptz))=2592000
  from public.ap_service_retention_deadlines('87900000-0000-4000-8000-000000000003')),'fall DST elapsed30day contract');
select pg_temp.assert_retention(public.ap_export_service_retention_overlay()=public.ap_export_service_retention_overlay(),'stable complete overlay');
select pg_temp.assert_retention((public.ap_export_service_retention_overlay()->'orders'->0->>'policyVersion') is null,'overlay has only frozen keys');
select 'ONE_OFF_SERVICE_RETENTION_OK';
rollback;
