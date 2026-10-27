-- Actual payment settlement and replay with a verified intake owner. This
-- rollback-only fixture reuses the reviewed-source/feasibility/capacity setup
-- from chunk4 and the authorized rehearsal checkout path. Its v3 intake is an
-- existing historical intake claimed by the new verified flow; the separate
-- verified-intake-ownership fixture proves new v4 creation and full review.
begin;
create function pg_temp.payment_assert(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception '%',message; end if; end $$;
create function pg_temp.payment_reject(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement; exception when others then if sqlerrm=expected then return; end if; raise; end;
raise exception 'expected rejection: %',expected; end $$;
select set_config('applypack_test.privacy_version',privacy_version,true),set_config('applypack_test.privacy_sha256',privacy_content_sha256,true)
from public.ap_commerce_configuration where singleton;
insert into auth.users(id,email,email_confirmed_at,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a1100001-0000-4000-8000-000000000001','chunk4-customer@example.invalid',now(),false,'{}','{}',now(),now()),
 ('a1100001-0000-4000-8000-000000000002','chunk4-other@example.invalid',now(),false,'{}','{}',now(),now()),
 ('a1100001-0000-4000-8000-000000000003','chunk4-reviewer@example.invalid',now(),false,'{}','{}',now(),now());
update public.profiles set role='admin' where id='a1100001-0000-4000-8000-000000000003';
update public.ap_commerce_configuration set canonical_site_url='https://applypack-staging-staging.up.railway.app',
 sales_activation_approved=false,sales_activation_reference=null,launch_activation_id=null,launch_release_sha=null,
 tax_inclusive=true,tax_treatment='TAX_INCLUSIVE_NO_ADDED_AMOUNT',document_worker_network_attestation_sha256=repeat('b0',32),
 tax_version='tax-inclusive-v1',access_callback_url='https://applypack.work/auth/callback',payment_provider='stripe',
 payment_api_version='2026-08-27.basil',immediate_payment_methods=array['card'],release_verification_ttl_seconds=3600,
 provider_idempotent_email_approved=true,provider_email_approval_reference='rollback-only-owned-payment-fixture' where singleton;
select public.ap_set_checkout_mode('REHEARSAL',repeat('a',40),'a1100001-0000-4000-8000-000000000003','owned-payment-fixture-rehearsal');
select * from public.ap_create_anonymous_draft(
  'a1100002-0000-4000-8000-000000000001',repeat('a0',32),now()+interval '1 day'
);
select * from public.ap_register_anonymous_document(
  'a1100002-0000-4000-8000-000000000001',repeat('a0',32),1,
  'a1100003-0000-4000-8000-000000000001','RESUME','resume.pdf',
  'anonymous/a1100002-0000-4000-8000-000000000001/resume/v1.pdf',128,
  'application/pdf','application/pdf',repeat('10',32)
);
update public.ap_document_versions set processing_state='SCANNING'
where id='a1100003-0000-4000-8000-000000000001';
update public.ap_document_versions set processing_state='EXTRACTING'
where id='a1100003-0000-4000-8000-000000000001';
select pg_temp.payment_assert(public.ap_apply_document_pipeline_result(
  'a1100003-0000-4000-8000-000000000001',1,'READY','CLEAN','SUCCEEDED','CLEAR','CLEAR',
  'fixture-parser','{"pageLimit":20}','fixture-model-policy',null
), 'ready resume pipeline fixture failed');

insert into public.ap_sensitive_payloads(
  id,draft_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,
  content_sha256,kms_key_identity,kms_key_version,encryption_context_hash
) values(
  'a1100004-0000-4000-8000-000000000001','a1100002-0000-4000-8000-000000000001',
  decode('0102','hex'),'AES-256-GCM',decode(repeat('11',32),'hex'),decode(repeat('22',12),'hex'),
  decode(repeat('33',16),'hex'),repeat('20',32),'fixture-kms','1',repeat('30',32)
);

\ir reviewed-source-fixture.sql

insert into public.ap_intake_snapshots(
  id,draft_id,version,snapshot_kind,access_email_normalized,payer_receipt_email,document_contact_email,
  desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,
  blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,
  schedules,travel,benefits,dealbreakers,salary_target_cents,salary_hard_minimum_cents,
  salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,
  salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,
  targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at
) values(
  'a1100005-0000-4000-8000-000000000001','a1100002-0000-4000-8000-000000000001',1,'INITIAL',
  'chunk4-customer@example.invalid',null,'chunk4-customer@example.invalid',
  '["COORDINATING_PROJECTS"]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,
  '["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',7000000,6000000,false,'YEAR','BASE',
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',
  repeat('40',32),'applypack-c14n-v1','applypack-intake-v3',clock_timestamp()-interval '2 minutes'
);
update public.ap_anonymous_drafts set
  state='COMPLETE',finalized_snapshot_id='a1100005-0000-4000-8000-000000000001',
  access_email_normalized='chunk4-customer@example.invalid',current_step=3
where id='a1100002-0000-4000-8000-000000000001';

insert into public.ap_inventory_versions(
  id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256
) values(
  'a1100006-0000-4000-8000-000000000001',clock_timestamp(),'source-auth-v1',
  'responsibility-retrieval-v1','listing-requirements-v3',repeat('50',32)
);
insert into public.ap_feasibility_source_configurations(
  id,source_authorization_id,config_version,pagination_bound,lookback_bound,result_bound,
  release_verification_ttl,parser_version,cutoff_version,content_sha256,approved_by_role,approved_at
)
select
  'a1100007-0000-4000-8000-000000000041',source_auth.id,'chunk4-manual-v1',1,
  interval '30 days',50,interval '1 hour','listing-requirements-v3','current-v1',
  repeat('50',32),'operator',clock_timestamp()
from public.ap_source_authorizations source_auth
where source_auth.source_id='manual-reviewed' and source_auth.authorization_version='zz-chunk-fixture';
insert into public.ap_feasibility_coverage_plans(
  id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256
) values(
  'a1100008-0000-4000-8000-000000000041','a1100005-0000-4000-8000-000000000001',
  'a1100006-0000-4000-8000-000000000001','feasibility-v1',
  '{"requiredFamilyIds":["responsibility-family"],"breadth":"ADJACENT_OPPORTUNITIES"}',
  'REQUIRED',repeat('60',32)
);
insert into public.ap_feasibility_coverage_cells(
  plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,
  result_bound,execution_path,terminal_outcome,cursor_or_stop_reason,result_count,parser_result,
  started_at,completed_at,query_family_id,source_authorization_id,configuration_id,
  configured_bound_satisfied,normalized_and_deduplicated,manual_checklist_complete
)
select
  'a1100008-0000-4000-8000-000000000041','manual-reviewed','AUTHORIZED_MANUAL_ONLY',
  repeat('60',32),1,interval '30 days',50,'MANUAL','SUCCEEDED_WITH_RESULTS',
  'fixture-manual-review-complete',10,'{"status":"COMPLETE"}',clock_timestamp(),clock_timestamp(),
  'responsibility-family',source_auth.id,'a1100007-0000-4000-8000-000000000041',
  true,true,true
from public.ap_source_authorizations source_auth
where source_auth.source_id='manual-reviewed' and source_auth.authorization_version='zz-chunk-fixture';
insert into public.ap_feasibility_assessments(
  id,snapshot_id,coverage_plan_id,state,outcome,resolution_blocker,preliminarily_deliverable_count,
  reviewable_count,excluded_count,reasons,primary_reason,rules_version,expires_at
) values(
  'a1100009-0000-4000-8000-000000000001','a1100005-0000-4000-8000-000000000001',
  'a1100008-0000-4000-8000-000000000041','COMPLETE','LIKELY','NONE',10,0,0,'{}',null,
  'feasibility-worker-v1',clock_timestamp()+interval '1 hour'
);
insert into public.ap_feasibility_requests(
  id,draft_id,snapshot_id,state,request_version,idempotency_key,completed_assessment_id
) values(
  'a110000a-0000-4000-8000-000000000041','a1100002-0000-4000-8000-000000000001',
  'a1100005-0000-4000-8000-000000000001','COMPLETED','feasibility-v1','chunk4-feasibility',
  'a1100009-0000-4000-8000-000000000001'
);

select public.ap_record_snapshot_legal_acceptance(
  'a1100002-0000-4000-8000-000000000001',repeat('a0',32),
  'a1100005-0000-4000-8000-000000000001',(select terms_version from public.ap_commerce_configuration where singleton),current_setting('applypack_test.privacy_version'),repeat('70',32)
);
select public.ap_record_snapshot_legal_content_receipt(
  'a1100002-0000-4000-8000-000000000001',repeat('a0',32),
  'a1100005-0000-4000-8000-000000000001',
  (select id from public.ap_snapshot_legal_acceptances where snapshot_id='a1100005-0000-4000-8000-000000000001'),
  (select terms_version from public.ap_commerce_configuration where singleton),(select terms_content_sha256 from public.ap_commerce_configuration where singleton),
  current_setting('applypack_test.privacy_version'),current_setting('applypack_test.privacy_sha256'),
  (select legal_acceptance_copy_version from public.ap_commerce_configuration where singleton),(select legal_acceptance_copy_sha256 from public.ap_commerce_configuration where singleton),
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('70',32)
);
select pg_temp.payment_assert(
  (public.ap_read_current_feasibility('a1100002-0000-4000-8000-000000000001',repeat('a0',32))->>'checkoutEligible')='false',
  'checkout became eligible without capacity'
);

insert into public.ap_capacity_pools(id,resource,enabled,configuration_version)
values('a110000b-0000-4000-8000-000000000001','SEARCH',true,'chunk4-fixture-v1');
insert into public.ap_capacity_buckets(id,pool_id,starts_at,ends_at,total_units,staffing_version)
values(
  'a110000c-0000-4000-8000-000000000001','a110000b-0000-4000-8000-000000000001',
  clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 days',3,'fixture-staffing-v1'
);
select pg_temp.payment_assert(
  (public.ap_read_current_feasibility('a1100002-0000-4000-8000-000000000001',repeat('a0',32))->>'checkoutEligible')='false',
  'public purchasing unlocked during authorized rehearsal'
);

create function pg_temp.owned_payment_checkout(claimed boolean) returns void language plpgsql as $$
declare authorization_id uuid;
begin
 if claimed then perform public.ap_claim_intake_draft('a1100001-0000-4000-8000-000000000001','chunk4-customer@example.invalid',
  'a1100002-0000-4000-8000-000000000001',repeat('a0',32)); end if;
 authorization_id:=public.ap_authorize_staging_rehearsal_checkout(repeat('a',40),'SEARCH',
  'a1100001-0000-4000-8000-000000000001','a1100002-0000-4000-8000-000000000001',null,
  'a1100001-0000-4000-8000-000000000003','owned-payment-exact-customer-draft',clock_timestamp()+interval '10 minutes');
 perform public.ap_issue_search_checkout_invitation('a1100010-0000-4000-8000-000000000001','a1100002-0000-4000-8000-000000000001',
  'a1100005-0000-4000-8000-000000000001','a1100009-0000-4000-8000-000000000001',repeat('70',32),clock_timestamp()+interval '20 minutes',
  'a1100001-0000-4000-8000-000000000003','Fictional payment ownership verification requires the normal reserved invitation.');
 perform public.ap_begin_authorized_search_checkout('a1100010-0000-4000-8000-000000000001',repeat('70',32),
  'a1100002-0000-4000-8000-000000000001',repeat('a0',32),'a1100005-0000-4000-8000-000000000001','a1100009-0000-4000-8000-000000000001',
  'owned-payment-provider-retry','a1100011-0000-4000-8000-000000000001',repeat('60',32),
  'a1100012-0000-4000-8000-000000000001','search-checkout/owned-payment-retry',
  'a1100013-0000-4000-8000-000000000001','a1100014-0000-4000-8000-000000000001',repeat('50',32),repeat('40',32),
  'REHEARSAL','a1100001-0000-4000-8000-000000000001',repeat('a',40),authorization_id,'a1100004-0000-4000-8000-000000000001');
 perform public.ap_bind_checkout_initiation('a1100013-0000-4000-8000-000000000001','cs_verified_intake_payment',
  (select provider_session_deadline from public.ap_checkout_initiations where id='a1100013-0000-4000-8000-000000000001'));
end $$;
create function pg_temp.apply_owned_payment(customer uuid,event_id text default 'evt_verified_intake_payment') returns jsonb language sql as $$
 select public.ap_apply_verified_search_payment(event_id,'checkout.session.completed',repeat('e0',32),clock_timestamp(),statement_timestamp()-interval '1 minute',
  'cs_verified_intake_payment','pi_verified_intake_payment','succeeded','card',1899,'USD','fictional-payer@example.invalid',customer,
  'a1100020-0000-4000-8000-000000000001','a1100021-0000-4000-8000-000000000001','a1100022-0000-4000-8000-000000000001',
  'a1100023-0000-4000-8000-000000000001',repeat('d0',32),'a1100024-0000-4000-8000-000000000001','a1100025-0000-4000-8000-000000000001',
  'a1100026-0000-4000-8000-000000000001','a1100027-0000-4000-8000-000000000001');
$$;
create function pg_temp.owned_payment_retry() returns jsonb language sql as $$
 select to_jsonb(result) from public.ap_begin_authorized_search_checkout('a1100010-0000-4000-8000-000000000001',repeat('70',32),
  'a1100002-0000-4000-8000-000000000001',repeat('a0',32),'a1100005-0000-4000-8000-000000000001','a1100009-0000-4000-8000-000000000001',
  'owned-payment-provider-retry','a1100011-0000-4000-8000-000000000001',repeat('60',32),
  'a1100012-0000-4000-8000-000000000001','search-checkout/owned-payment-retry',
  'a1100013-0000-4000-8000-000000000001','a1100014-0000-4000-8000-000000000001',repeat('50',32),repeat('40',32),
  'REHEARSAL','a1100001-0000-4000-8000-000000000001',repeat('a',40),
  (select authorization_id from public.ap_checkout_initiations where id='a1100013-0000-4000-8000-000000000001'),
  'a1100004-0000-4000-8000-000000000001') result;
$$;

-- Synthetic notification rows exercise each no-order resolver shape against
-- the actual settled payment and real queued refund above. This does not
-- claim a second provider payment or a delivered refund/email.
create function pg_temp.assert_noorder_payment_notices(claimed boolean) returns void language plpgsql as $$
declare refund_id uuid; kind text; message_id uuid; message_ids uuid[]:='{}'; context_value jsonb; reference_id uuid;
begin
 refund_id:=public.ap_queue_search_refund('a1100014-0000-4000-8000-000000000001',
  'a1100001-0000-4000-8000-000000000001','FULL_SEARCH','FICTIONAL_RECIPIENT_RESOLUTION_PROOF');
 foreach kind in array array['CAPACITY_EXCEPTION_REFUND','DUPLICATE_PAYMENT_REFUND','STALE_PAYMENT_REFUND',
  'REFUND_INITIATED','REFUND_COMPLETED','REFUND_PROCESSING','REFUND_PROBLEM'] loop
  message_id:=gen_random_uuid(); message_ids:=array_append(message_ids,message_id);
  reference_id:=case when kind in('CAPACITY_EXCEPTION_REFUND','DUPLICATE_PAYMENT_REFUND','STALE_PAYMENT_REFUND')
   then 'a1100005-0000-4000-8000-000000000001'::uuid when kind='REFUND_INITIATED'
   then 'a1100014-0000-4000-8000-000000000001'::uuid else refund_id end;
  insert into public.ap_outbox_messages(id,customer_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key)
   values(message_id,'a1100001-0000-4000-8000-000000000001',kind,reference_id::text,
    'fictional-noorder:'||message_id::text,'fictional-noorder:'||message_id::text);
 end loop;
 perform public.ap_claim_outbox_messages('owned-noorder-fixture',25);
 foreach message_id in array message_ids loop
  context_value:=public.ap_prepare_claimed_payment_notification(message_id,'owned-noorder-fixture');
  if claimed then
   perform pg_temp.payment_assert(context_value->>'claimed'='true'
    and context_value->>'customerId'='a1100001-0000-4000-8000-000000000001'
    and context_value->>'rootDraftId'='a1100002-0000-4000-8000-000000000001'
    and context_value->>'recipientEmail'='verified-changed@example.invalid'
    and context_value->'orderId'='null'::jsonb,'claimed no-order refund recipient graph mismatch');
   perform public.ap_pin_claimed_payment_delivery(message_id,'owned-noorder-fixture',repeat('48',32));
   perform pg_temp.payment_reject(format('update public.ap_outbox_messages set provider_idempotency_key=%L where id=%L',
    'forbidden-retarget',message_id),'claimed_delivery_pin_immutable');
  else
   perform pg_temp.payment_assert(context_value='{"claimed":false}'::jsonb,'historical no-order refund lost exact unclaimed receipt');
  end if;
 end loop;
 if claimed then
  message_id:=gen_random_uuid();
  insert into public.ap_outbox_messages(id,customer_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key)
   values(message_id,'a1100001-0000-4000-8000-000000000002','REFUND_INITIATED','a1100014-0000-4000-8000-000000000001',
    'fictional-foreign:'||message_id::text,'fictional-foreign:'||message_id::text);
  perform public.ap_claim_outbox_messages('owned-noorder-fixture',25);
  perform pg_temp.payment_reject(format('select public.ap_prepare_claimed_payment_notification(%L,%L)',message_id,'owned-noorder-fixture'),
   'claimed_payment_owner_mismatch');
 end if;
end $$;

savepoint historical_unclaimed_payment;
select pg_temp.owned_payment_checkout(false);
select pg_temp.payment_assert(public.ap_intake_payment_identity('a1100002-0000-4000-8000-000000000001','a1100005-0000-4000-8000-000000000001')->>'claimed'='false','historical intake unexpectedly claimed');
select pg_temp.payment_assert(pg_temp.apply_owned_payment('a1100001-0000-4000-8000-000000000001')->>'outcome'='SEARCH_ACTIVE','historical unclaimed payment failed');
select pg_temp.assert_noorder_payment_notices(false);
-- Older customer-owned snapshots have no anonymous draft. This valid
-- historical graph must keep the original notification path; null draft is
-- distinct from a missing snapshot or a removed claimed identity.
do $$ declare copied public.ap_intake_snapshots; begin
 select * into strict copied from public.ap_intake_snapshots where id='a1100005-0000-4000-8000-000000000001';
 copied.id:='a1100040-0000-4000-8000-000000000001'; copied.draft_id:=null;
 copied.customer_id:='a1100001-0000-4000-8000-000000000001';
 insert into public.ap_intake_snapshots select copied.*;
end $$;
insert into public.orders(id,customer_id,product_kind,amount_cents,status,paid_at,delivered_at)
 values('a1100041-0000-4000-8000-000000000001','a1100001-0000-4000-8000-000000000001','job_search',1899,'delivered',now(),now());
insert into public.ap_search_services(id,legacy_order_id,customer_id,original_snapshot_id,active_snapshot_id,fulfillment,legacy_record)
 values('a1100042-0000-4000-8000-000000000001','a1100041-0000-4000-8000-000000000001','a1100001-0000-4000-8000-000000000001',
 'a1100040-0000-4000-8000-000000000001','a1100040-0000-4000-8000-000000000001','DELIVERED',true);
insert into public.ap_outbox_messages(id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key)
 values('a1100043-0000-4000-8000-000000000001','a1100001-0000-4000-8000-000000000001','a1100041-0000-4000-8000-000000000001',
 'MATERIALS_DELIVERED','a1100040-0000-4000-8000-000000000001','fictional-historical-no-draft','fictional-historical-no-draft');
select count(*) from public.ap_claim_outbox_messages('historical-no-draft-fixture',25);
select pg_temp.payment_assert(public.ap_prepare_claimed_payment_notification('a1100043-0000-4000-8000-000000000001','historical-no-draft-fixture')='{"claimed":false}'::jsonb,
 'existing historical snapshot without anonymous draft lost its notification path');
rollback to historical_unclaimed_payment;

select pg_temp.owned_payment_checkout(true);
select pg_temp.payment_assert(exists(select 1 from public.ap_checkout_attempts c join public.ap_quotes q on q.id=c.quote_id
 join public.ap_capacity_allocations a on a.id=c.capacity_allocation_id where c.id='a1100013-0000-4000-8000-000000000001'
 and c.state='OPEN' and c.customer_id='a1100001-0000-4000-8000-000000000001'
 and q.customer_id=c.customer_id and a.customer_id=c.customer_id and q.draft_id=c.draft_id and a.draft_id=c.draft_id),
 'claimed checkout quote and capacity did not retain the same verified owner');
create temp table owned_checkout_retry as select pg_temp.owned_payment_retry() result;
select pg_temp.payment_assert((select result=pg_temp.owned_payment_retry() and result->>'access_email'='chunk4-customer@example.invalid' from owned_checkout_retry),'checkout retry changed pinned provider email/body');
create temp table owned_payment_original as select to_jsonb(s) body from public.ap_intake_snapshots s where id='a1100005-0000-4000-8000-000000000001';
update auth.users set email='verified-changed@example.invalid' where id='a1100001-0000-4000-8000-000000000001';
update public.profiles set email='verified-changed@example.invalid' where id='a1100001-0000-4000-8000-000000000001';
update auth.users set email='chunk4-customer@example.invalid' where id='a1100001-0000-4000-8000-000000000002';
update public.profiles set email='chunk4-customer@example.invalid' where id='a1100001-0000-4000-8000-000000000002';
select pg_temp.payment_reject($s$select pg_temp.owned_payment_retry()$s$,'claimed_checkout_recipient_changed_reconcile');
select pg_temp.payment_reject($s$select pg_temp.apply_owned_payment('a1100001-0000-4000-8000-000000000002')$s$,'access_identity_mismatch');
select pg_temp.payment_assert(not exists(select 1 from public.ap_provider_events where provider_event_id='evt_verified_intake_payment'),'rejected owner persisted a partial payment event');

-- Expiry prevents unpaid private access, but it cannot transfer financial
-- ownership or discard a charge that was already accepted by the provider.
update public.ap_anonymous_drafts set expires_at=created_at+interval '1 microsecond' where id='a1100002-0000-4000-8000-000000000001';
select pg_temp.payment_assert(not public.ap_customer_owns_snapshot('a1100001-0000-4000-8000-000000000001','a1100005-0000-4000-8000-000000000001'),'expired unpaid snapshot retained private access');
select pg_temp.payment_assert(public.ap_intake_payment_identity('a1100002-0000-4000-8000-000000000001','a1100005-0000-4000-8000-000000000001')->>'customerId'='a1100001-0000-4000-8000-000000000001','expiry revived email fallback');
select pg_temp.payment_reject($s$select pg_temp.apply_owned_payment('a1100001-0000-4000-8000-000000000002')$s$,'access_identity_mismatch');
create temp table owned_payment_result as select pg_temp.apply_owned_payment('a1100001-0000-4000-8000-000000000001') result;
select pg_temp.payment_assert((select result->>'outcome'='SEARCH_ACTIVE' from owned_payment_result),'claimed payment did not activate stable owner');
select pg_temp.payment_assert((select customer_id='a1100001-0000-4000-8000-000000000001' from public.orders where id='a1100021-0000-4000-8000-000000000001')
 and (select customer_id='a1100001-0000-4000-8000-000000000001' from public.intakes where id='a1100020-0000-4000-8000-000000000001')
 and (select customer_id='a1100001-0000-4000-8000-000000000001' and settlement='PAID' from public.ap_payment_attempts where id='a1100014-0000-4000-8000-000000000001'),
 'settled order/intake/payment transferred to reused email');
select pg_temp.payment_assert(public.ap_customer_owns_snapshot('a1100001-0000-4000-8000-000000000001','a1100005-0000-4000-8000-000000000001'),'real paid access lost when draft expired');
select pg_temp.payment_assert(not public.ap_customer_owns_snapshot('a1100001-0000-4000-8000-000000000002','a1100005-0000-4000-8000-000000000001'),'reused email holder acquired paid private access');
select pg_temp.payment_assert((select body=to_jsonb(s) from owned_payment_original) ,'payment mutated immutable intake') from public.ap_intake_snapshots s where id='a1100005-0000-4000-8000-000000000001';
select pg_temp.payment_assert((select result||jsonb_build_object('replayed',true)=pg_temp.apply_owned_payment('a1100001-0000-4000-8000-000000000001') from owned_payment_result),'same event replay changed result or lost replay marker');
select pg_temp.payment_assert(pg_temp.apply_owned_payment('a1100001-0000-4000-8000-000000000001','evt_verified_intake_payment_reordered')->>'outcome'='SEARCH_ACTIVE','reordered completed event lost payment');
select pg_temp.payment_assert((select count(*)=1 from public.ap_search_services where original_snapshot_id='a1100005-0000-4000-8000-000000000001')
 and (select count(*)=1 from public.orders where stripe_payment_intent_id='pi_verified_intake_payment')
 and (select count(*)=1 from public.ap_capacity_allocations where draft_id='a1100002-0000-4000-8000-000000000001' and debit_disposition='SPENT')
 and (select count(*)=1 from public.ap_outbox_messages where order_id='a1100021-0000-4000-8000-000000000001' and message_kind='PAYMENT_VERIFIED_SEARCH_STARTED'),
 'replay duplicated fulfillment/capacity/start notification');
select pg_temp.payment_assert(not exists(select 1 from public.ap_order_access_capabilities where order_id='a1100021-0000-4000-8000-000000000001' and kind='EMAIL_ACCESS'),'claimed payment issued an emailed bearer capability');
select pg_temp.payment_assert(public.ap_find_latest_access_order('chunk4-customer@example.invalid') is null,'email-only lookup exposed claimed order to reused address');
select pg_temp.payment_reject($s$select public.ap_issue_order_access_capability('a1100021-0000-4000-8000-000000000001',repeat('30',32),
 'a1100030-0000-4000-8000-000000000001','a1100004-0000-4000-8000-000000000001','a1100031-0000-4000-8000-000000000001')$s$,'claimed_order_requires_sign_in');
savepoint historical_claimed_capability;
-- Synthetic pre-existing capability under all normal constraints: the
-- consumer must reject it even though new claimed payments issue none.
insert into public.ap_order_access_capabilities(id,checkout_attempt_id,order_id,customer_id,kind,secret_hash,state,issued_at,expires_at)
 values('a1100030-0000-4000-8000-000000000001','a1100013-0000-4000-8000-000000000001','a1100021-0000-4000-8000-000000000001',
 'a1100001-0000-4000-8000-000000000001','EMAIL_ACCESS',repeat('30',32),'ISSUED',statement_timestamp(),statement_timestamp()+interval '15 minutes');
select pg_temp.payment_reject($s$select public.ap_consume_order_access('a1100030-0000-4000-8000-000000000001',repeat('30',32))$s$,'claimed_order_requires_sign_in');
rollback to historical_claimed_capability;
select count(*) from public.ap_claim_outbox_messages('owned-payment-fixture',25);
select pg_temp.payment_assert(public.ap_prepare_claimed_payment_notification('a1100026-0000-4000-8000-000000000001','owned-payment-fixture')->>'recipientEmail'='verified-changed@example.invalid','paid notice selected old reused email');
select public.ap_pin_claimed_payment_delivery('a1100026-0000-4000-8000-000000000001','owned-payment-fixture',repeat('18',32));
select pg_temp.payment_assert(public.ap_pin_claimed_payment_delivery('a1100026-0000-4000-8000-000000000001','owned-payment-fixture',repeat('18',32))->>'payloadSha256'=repeat('18',32),'same paid envelope replay failed');
select pg_temp.payment_reject($s$select public.ap_pin_claimed_payment_delivery('a1100026-0000-4000-8000-000000000001','owned-payment-fixture',repeat('28',32))$s$,'claimed_payment_envelope_changed');
savepoint after_paid_recipient_pin;
update auth.users set email='verified-changed-again@example.invalid' where id='a1100001-0000-4000-8000-000000000001';
select pg_temp.payment_reject($s$select public.ap_prepare_claimed_payment_notification('a1100026-0000-4000-8000-000000000001','owned-payment-fixture')$s$,'claimed_payment_recipient_changed');
rollback to after_paid_recipient_pin;
select pg_temp.assert_noorder_payment_notices(true);
rollback;




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
values('a1110001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retention-new@example.invalid','',now(),'{}','{}',now(),now()),
('a1110001-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retention-old@example.invalid','',now(),'{}','{}',now(),now()),
('a1110001-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retention-admin@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='a1110001-0000-4000-8000-000000000003';
insert into public.intakes(id,customer_id,email,direction,dealbreakers,location_preference,schedule_preference,experience_summary,resume_path)
values('a1110002-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001','retention-new@example.invalid','Synthetic private direction','Synthetic private constraint','Remote','Day','Synthetic private experience','synthetic/resume.pdf');
insert into public.intake_answers(intake_id,customer_id,answers) values('a1110002-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001','{"private":"synthetic"}');
select * from public.ap_create_anonymous_draft('a1110003-0000-4000-8000-000000000001',repeat('a0',32),now()+interval '1 day');
insert into public.ap_intake_snapshots(id,draft_id,intake_id,customer_id,version,snapshot_kind,access_email_normalized,
  desired_activities,avoided_activities,optional_titles,optional_industries,blocked_industries,search_breadth,guidance_requested,
  work_modes,employment_types,schedules,travel,benefits,dealbreakers,salary_minimum_flexible,salary_overlap_policy,
  salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,
  prior_cover_letter_use,targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at,preferred_work_mode,preferred_employment_type,work_condition_preferences)
values('a1110004-0000-4000-8000-000000000001','a1110003-0000-4000-8000-000000000001','a1110002-0000-4000-8000-000000000001',
  'a1110001-0000-4000-8000-000000000001',1,'INITIAL','retention-new@example.invalid','["synthetic private activity"]','[]','[]','[]','[]',
  'ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','["FULL_TIME"]','[]','{}','{}','[]',false,
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',repeat('b0',32),'applypack-c14n-v1','applypack-intake-v3',now(),'REMOTE','FULL_TIME','{"fictionalPrivatePreference":"quiet environment"}');
insert into public.ap_snapshot_legal_acceptances(id,draft_id,snapshot_id,terms_version,privacy_version,acceptance_sha256)
values('a1110005-0000-4000-8000-000000000001','a1110003-0000-4000-8000-000000000001','a1110004-0000-4000-8000-000000000001',
  'manual-launch-terms-2026-10-24-v3','privacy-2026-10-24-v3',repeat('c0',32));
insert into public.ap_snapshot_legal_content_receipts(id,legal_acceptance_id,draft_id,snapshot_id,terms_version,terms_content_sha256,
  privacy_version,privacy_content_sha256,acceptance_copy_version,acceptance_copy_sha256,content_canonicalization_version,receipt_schema_version,acceptance_sha256)
select 'a1110006-0000-4000-8000-000000000001','a1110005-0000-4000-8000-000000000001','a1110003-0000-4000-8000-000000000001',
  'a1110004-0000-4000-8000-000000000001',terms_version,terms_content_sha256,privacy_version,privacy_content_sha256,
  legal_acceptance_copy_version,legal_acceptance_copy_sha256,legal_content_canonicalization_version,legal_receipt_schema_version,repeat('c0',32)
from public.ap_commerce_configuration where singleton;
-- This second rollback-only phase uses the established expired paid-family
-- retention fixture with every guard enabled. It proves minimization/restore
-- of the new immutable claim, independently of the fresh settlement above.
update auth.users set is_anonymous=false where id='a1110001-0000-4000-8000-000000000001';
update public.ap_anonymous_drafts set state='COMPLETE',finalized_snapshot_id='a1110004-0000-4000-8000-000000000001',access_email_normalized='retention-new@example.invalid'
 where id='a1110003-0000-4000-8000-000000000001';
select public.ap_claim_intake_draft('a1110001-0000-4000-8000-000000000001','retention-new@example.invalid','a1110003-0000-4000-8000-000000000001',repeat('a0',32));
update public.ap_anonymous_drafts set expires_at=created_at+interval '1 microsecond' where id='a1110003-0000-4000-8000-000000000001';
insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key)
values('a1110007-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001','CREATE_CHECKOUT','stripe',repeat('d0',32),'retention-fixture-command');
insert into public.ap_checkout_attempts(id,customer_id,draft_id,command_id)
values('a1110008-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001','a1110003-0000-4000-8000-000000000001','a1110007-0000-4000-8000-000000000001');
-- Only this synthetic superuser fixture seeds a prospective consent binding.
-- Production checkout remains blocked until the separately authorized executor exists.
insert into public.ap_retention_checkout_contracts(checkout_attempt_id,legal_receipt_id,policy_version)
values('a1110008-0000-4000-8000-000000000001','a1110006-0000-4000-8000-000000000001','one_off_30d_v1');
insert into public.ap_payment_attempts(id,customer_id,draft_id,checkout_attempt_id,provider,amount_cents,currency,settlement,payment_verified_at,immediate_charge_verified)
values('a1110009-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001','a1110003-0000-4000-8000-000000000001',
  'a1110008-0000-4000-8000-000000000001','stripe',1899,'USD','PAID',now()-interval '745 hours',true);
insert into public.orders(id,customer_id,intake_id,product_kind,amount_cents,status,paid_at,delivered_at)
values('a111000a-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001','a1110002-0000-4000-8000-000000000001','job_search',1899,'delivered',now()-interval '745 hours',now()-interval '744 hours'),
('a111000a-0000-4000-8000-000000000002','a1110001-0000-4000-8000-000000000002',null,'job_search',1899,'delivered',now()-interval '1500 hours',now()-interval '1499 hours');
insert into public.ap_search_services(id,legacy_order_id,customer_id,winning_payment_attempt_id,original_snapshot_id,active_snapshot_id,fulfillment,legacy_record)
values('a111000b-0000-4000-8000-000000000001','a111000a-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001',
  'a1110009-0000-4000-8000-000000000001','a1110004-0000-4000-8000-000000000001','a1110004-0000-4000-8000-000000000001','DELIVERED',true),
('a111000b-0000-4000-8000-000000000002','a111000a-0000-4000-8000-000000000002','a1110001-0000-4000-8000-000000000002',null,null,null,'DELIVERED',true);
insert into public.ap_releases(id,customer_id,order_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by)
values('a111000c-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001','a111000a-0000-4000-8000-000000000001','SEARCH_EXACT_TEN',
  now()-interval '744 hours',now()-interval '743 hours','{}','a1110001-0000-4000-8000-000000000003');
insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,
  assertion_control_id,source_locator,verification,catalog_version,schema_version)
values('a111000d-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001','a1110004-0000-4000-8000-000000000001',
  'synthetic','text','{"text":"synthetic private fact"}','CUSTOMER_ASSERTION','a1110004-0000-4000-8000-000000000001','synthetic','synthetic','CUSTOMER_CONFIRMED','v1','v1');
insert into public.ap_reference_records(id,customer_id) values('a111000e-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001');
insert into public.jobs(id,company,title,source_url,checked_at) values('a111000f-0000-4000-8000-000000000001','Synthetic employer','Synthetic position','https://example.invalid/job',now());
insert into public.job_matches(id,search_order_id,job_id,position,fit_summary,delivered_at)
values('a1110010-0000-4000-8000-000000000001','a111000a-0000-4000-8000-000000000001','a111000f-0000-4000-8000-000000000001',1,'Synthetic private fit',now()-interval '744 hours');
insert into public.ap_feasibility_requests(draft_id,snapshot_id,idempotency_key,request_version)
values('a1110003-0000-4000-8000-000000000001','a1110004-0000-4000-8000-000000000001','retention-feasibility','v1');

-- Synthetic existing notice graph under normal constraints, used only to
-- prove the paid-family redaction/restore registry. Actual v4 question issuance
-- and its transactional notice are separately proved by the ownership fixture;
-- this historical v3 paid-family seed does not claim that issuance journey.
insert into public.ap_job_snapshots(id,origin,discovery_source,canonical_application_url,application_host_type,source_url,company,exact_title,
 normalized_fingerprint,captured_listing,retrieved_at,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256,legacy_compatibility)
 values('a1110030-0000-4000-8000-000000000001','APPLYPACK_FOUND','manual-reviewed','https://retention.example.invalid/apply','EMPLOYER_HOSTED',
 'https://retention.example.invalid/job','Fictional Employer','Support',repeat('58',32),'{}',now(),true,now(),'{}','fixture-v1',repeat('58',32),true);
insert into public.ap_requirement_nodes(id,job_snapshot_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,
 source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,human_correction_history)
 values('a1110031-0000-4000-8000-000000000001','a1110030-0000-4000-8000-000000000001',0,'CRITERION','WORK_MODE',
 'a1110031-0000-4000-8000-000000000001','work-mode','INFORMATIONAL','line:1',1,'fixture-v1','{"kind":"WORK_MODE","modes":["REMOTE"]}',
 'Remote work','fixture-v1','[]');
insert into public.ap_candidate_questions(id,snapshot_id,job_snapshot_id,requirement_node_id,prompt,issued_by)
 values('a1110032-0000-4000-8000-000000000001','a1110004-0000-4000-8000-000000000001','a1110030-0000-4000-8000-000000000001',
 'a1110031-0000-4000-8000-000000000001','Synthetic private question for retention coverage.','a1110001-0000-4000-8000-000000000003');
insert into public.ap_outbox_messages(id,customer_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,provider_message_id)
 values('a1110033-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001','INTAKE_CLARIFICATION_REQUIRED',
 'a1110032-0000-4000-8000-000000000001',
 'intake-clarification:a1110003-0000-4000-8000-000000000001:a1110032-0000-4000-8000-000000000001:v1',
 'intake-clarification:a1110003-0000-4000-8000-000000000001:a1110032-0000-4000-8000-000000000001:v1','SENT','fictional-prior-notice');
insert into public.ap_intake_clarification_notices(message_id,question_id,root_draft_id,customer_id,recipient_email,delivery_envelope_sha256)
 values('a1110033-0000-4000-8000-000000000001','a1110032-0000-4000-8000-000000000001','a1110003-0000-4000-8000-000000000001',
 'a1110001-0000-4000-8000-000000000001','retention-new@example.invalid',repeat('68',32));

-- Fictional local configuration for exercising the leased database outbox;
-- no provider is configured or called by this rollback-only fixture.
update public.ap_commerce_configuration set provider_idempotent_email_approved=true,
 provider_email_approval_reference='fictional-owned-retention-fixture' where singleton;
insert into public.ap_outbox_messages(id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key)
 values('a1110020-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001','a111000a-0000-4000-8000-000000000001',
 'MATERIALS_DELIVERED','a111000c-0000-4000-8000-000000000001','owned-retention-notice','owned-retention-notice');
select count(*) from public.ap_claim_outbox_messages('owned-retention-fixture',25);
select pg_temp.assert_retention(public.ap_prepare_claimed_payment_notification('a1110020-0000-4000-8000-000000000001','owned-retention-fixture')->>'recipientEmail'='retention-new@example.invalid','retention fixture paid recipient not pinned');
select public.ap_pin_claimed_payment_delivery('a1110020-0000-4000-8000-000000000001','owned-retention-fixture',repeat('38',32));
-- Engine-only provider acknowledgement; this does not claim mailbox delivery.
select public.ap_complete_outbox_message('a1110020-0000-4000-8000-000000000001','owned-retention-fixture','fictional-retention-provider-id');
savepoint before_owned_retention;
select pg_temp.assert_retention(jsonb_array_length(public.ap_claim_expired_service_retention(5))=1,'owned expired paid family claimed');
do $$ declare c uuid; object record; begin
 select id into strict c from public.ap_service_retention_claims where customer_id='a1110001-0000-4000-8000-000000000001';
 for object in select id from public.ap_service_retention_objects where claim_id=c loop
  perform public.ap_authorize_service_retention_object(c,object.id);
  -- Synthetic storage acknowledgement only; no provider or real deletion.
  perform public.ap_finish_service_retention_object(c,object.id);
 end loop;
 perform pg_temp.assert_retention(public.ap_finish_service_retention_claim(c),'owned private graph redaction completed');
end $$;
select pg_temp.assert_retention((select customer_id='a1110001-0000-4000-8000-000000000001' and access_email_normalized='removed@retention.invalid'
 from public.ap_intake_account_claims where root_draft_id='a1110003-0000-4000-8000-000000000001'),'claim was not minimized with stable owner');
select pg_temp.assert_retention(exists(select 1 from public.ap_retention_row_receipts where table_name='ap_intake_account_claims' and row_id='a1110003-0000-4000-8000-000000000001'),'claim redaction receipt missing');
select pg_temp.assert_retention(public.ap_intake_payment_identity('a1110003-0000-4000-8000-000000000001','a1110004-0000-4000-8000-000000000001')->>'customerId'='a1110001-0000-4000-8000-000000000001','minimized claim revived email fallback');
select pg_temp.assert_retention(not public.ap_customer_owns_snapshot('a1110001-0000-4000-8000-000000000001','a1110004-0000-4000-8000-000000000001'),'minimized claim authorized private access');
select pg_temp.assert_retention((select count(*)=1 from public.ap_payment_attempts where amount_cents=1899 and settlement='PAID'),'redaction lost paid ledger');
select pg_temp.assert_retention((select claimed_customer_email is null from public.ap_checkout_attempts where id='a1110008-0000-4000-8000-000000000001')
 and (select claimed_recipient_email is null and claimed_delivery_envelope_sha256=repeat('38',32) from public.ap_outbox_messages where id='a1110020-0000-4000-8000-000000000001'),'redaction failed to minimize provider recipient pins');
select pg_temp.assert_retention((select recipient_email='removed@retention.invalid' and delivery_envelope_sha256=repeat('68',32)
 from public.ap_intake_clarification_notices where message_id='a1110033-0000-4000-8000-000000000001')
 and exists(select 1 from public.ap_retention_row_receipts where table_name='ap_intake_clarification_notices' and row_id='a1110033-0000-4000-8000-000000000001'),
 'paid-family cleanup did not minimize clarification notice with receipt and retained envelope digest');
rollback to before_owned_retention;
create temp table owned_retention_overlay as select public.ap_export_service_retention_overlay() value;
select public.ap_apply_retention_restore_overlay(value::text,encode(extensions.digest(value::text,'sha256'),'hex')) from owned_retention_overlay;
select pg_temp.assert_retention((select access_email_normalized='removed@retention.invalid' from public.ap_intake_account_claims where root_draft_id='a1110003-0000-4000-8000-000000000001'),'restore revived claim contact');
select pg_temp.assert_retention((select claimed_customer_email is null from public.ap_checkout_attempts where id='a1110008-0000-4000-8000-000000000001')
 and (select claimed_recipient_email is null from public.ap_outbox_messages where id='a1110020-0000-4000-8000-000000000001'),'restore revived provider recipient pins');
select pg_temp.assert_retention((select recipient_email='removed@retention.invalid' and delivery_envelope_sha256=repeat('68',32)
 from public.ap_intake_clarification_notices where message_id='a1110033-0000-4000-8000-000000000001')
 and exists(select 1 from public.ap_retention_row_receipts where table_name='ap_intake_clarification_notices' and row_id='a1110033-0000-4000-8000-000000000001'),
 'restore revived clarification notice recipient or lost minimization receipt/digest');
select pg_temp.assert_retention(public.ap_intake_payment_identity('a1110003-0000-4000-8000-000000000001','a1110004-0000-4000-8000-000000000001')->>'customerId'='a1110001-0000-4000-8000-000000000001','restore lost durable payment owner');
select pg_temp.assert_retention(not public.ap_customer_owns_snapshot('a1110001-0000-4000-8000-000000000001','a1110004-0000-4000-8000-000000000001'),'restore reopened private source');
select pg_temp.assert_retention((select locked from public.ap_retention_restore_lock),'restore did not stay locked');
rollback;
select 'VERIFIED_INTAKE_PAYMENT_OK';
