-- Runs inside chunk4 after its real paid, human-reviewed exact-ten release.
savepoint before_rehearsal_material_checkout;
create temporary table rehearsal_material_selections as
select match.position,jsonb_build_object('matchId',match.id,
  'lineId',('e8500000-0000-4000-8000-'||lpad(match.position::text,12,'0'))::uuid,
  'revisionId',('e8600000-0000-4000-8000-'||lpad(match.position::text,12,'0'))::uuid,
  'entitlementId',('e8700000-0000-4000-8000-'||lpad(match.position::text,12,'0'))::uuid,
  'ruleId',('e8800000-0000-4000-8000-'||lpad(match.position::text,12,'0'))::uuid,
  'selectedReferenceSheet',false) as selection
from public.job_matches match where match.search_order_id='94000000-0000-4000-8000-000000000001'::uuid and match.position<=2;
create function pg_temp.material_resource_hash(selection_count integer) returns text language sql as $$
  select encode(extensions.digest(convert_to(string_agg(lower(selection->>'matchId'),',' order by lower(selection->>'matchId')),
    'UTF8'),'sha256'),'hex') from rehearsal_material_selections where position<=selection_count;
$$;

savepoint before_material_canary_scope;
select public.ap_set_checkout_mode('CANARY',repeat('a',40),'14000000-0000-4000-8000-000000000003','fixture-canary-material-scope-mode');
create temporary table material_canary_scope as select public.ap_authorize_scoped_manual_launch_canary_checkout(
  repeat('a',40),'MATERIALS','14000000-0000-4000-8000-000000000001',null,
  '14000000-0000-4000-8000-000000000003','fixture-exact-material-release-and-one-job',clock_timestamp()+interval '20 minutes',
  'a4b00000-0000-4000-8000-000000000001',pg_temp.material_resource_hash(1)) as id;
select pg_temp.assert_true(public.ap_assert_checkout_initiation_authorized('CANARY',
  '14000000-0000-4000-8000-000000000001',repeat('a',40),(select id from material_canary_scope),
  'MATERIALS','a4b00000-0000-4000-8000-000000000001',pg_temp.material_resource_hash(1))=(select id from material_canary_scope),
  'exact material canary resource was not authorized');
do $$ begin
  perform public.ap_assert_checkout_initiation_authorized('CANARY','14000000-0000-4000-8000-000000000001',repeat('a',40),
    (select id from material_canary_scope),'MATERIALS','a4b00000-0000-4000-8000-000000000001',pg_temp.material_resource_hash(2));
  raise exception 'one-pack-canary-authorized-a-different-cart';
exception when raise_exception then if sqlerrm<>'checkout_canary_authorization_denied' then raise; end if; end $$;
rollback to savepoint before_material_canary_scope;

update public.ap_commerce_configuration set canonical_site_url='https://applypack-staging-staging.up.railway.app',
  sales_activation_approved=false,sales_activation_reference=null,launch_activation_id=null,launch_release_sha=null,
  materials_generation_approved=true,materials_generation_approval_reference='fixture-isolated-structural-rendering',
  materials_rule_ttl_seconds=3600,
  material_output_formats=array['PDF'],document_renderer_identity='fixture-tagged-pdf-renderer',
  document_font_family='Liberation Sans',document_font_sha256='76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8',
  document_font_manifest_sha256='d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb',
  document_safety_policy='generated-structural-v1' where singleton;
select public.ap_set_checkout_mode('REHEARSAL',repeat('a',40),'14000000-0000-4000-8000-000000000003','fixture-rehearsal-material-mode');
do $$ begin
  perform public.ap_authorize_staging_rehearsal_checkout(repeat('a',40),'MATERIALS',
    '14000000-0000-4000-8000-000000000002','a4b00000-0000-4000-8000-000000000001',pg_temp.material_resource_hash(2),
    '14000000-0000-4000-8000-000000000003','fixture-other-customer-cannot-use-release',clock_timestamp()+interval '10 minutes');
  raise exception 'other-customer-authorized-delivered-release';
exception when raise_exception then
  if sqlerrm<>'staging_rehearsal_material_resource_mismatch' then raise; end if;
end $$;
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ap_search_services','INSERT')
  and not has_table_privilege('authenticated','public.ap_search_services','UPDATE')
  and not has_table_privilege('anon','public.ap_search_services','INSERT'),
  'customer could forge anonymous-snapshot ownership through a delivered service');
insert into public.ap_capacity_pools(id,resource,enabled,configuration_version)
values('e8900000-0000-4000-8000-000000000001','MATERIALS',true,'fixture-durable-material-capacity')
on conflict(resource) do update set enabled=true,configuration_version=excluded.configuration_version;
insert into public.ap_capacity_buckets(id,pool_id,starts_at,ends_at,total_units,staffing_version)
values('e8a00000-0000-4000-8000-000000000001',(select id from public.ap_capacity_pools where resource='MATERIALS'),
  clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 days',2,'fixture-durable-material-staffing');
insert into public.ap_sensitive_payloads(id,customer_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,
  content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
values('e8b00000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001',decode('0102','hex'),'AES-256-GCM',
  decode(repeat('11',32),'hex'),decode(repeat('22',12),'hex'),decode(repeat('33',16),'hex'),repeat('2',64),'fixture-kms','1',repeat('3',64));
insert into public.ap_employer_submission_rules(id,job_snapshot_id,content_sha256,source_evidence_ids,resume_requirement,
  cover_letter_requirement,allowed_formats,resume_page_limit,cover_letter_page_limit,reference_timing,submission_channel,
  parser_version,injection_scan_state,human_confirmed_by,human_confirmed_at,checked_at)
select (selection->>'ruleId')::uuid,evaluation.job_snapshot_id,repeat('4',64),array[evaluation.job_snapshot_id],
  'REQUIRED','REQUIRED',array['PDF'],2,1,'OPTIONAL_NOW','HTTPS_UPLOAD','fixture-reviewed-material-rules','CLEAR',
  '14000000-0000-4000-8000-000000000003',clock_timestamp(),clock_timestamp()
from rehearsal_material_selections selections join public.job_matches match on match.id=(selection->>'matchId')::uuid
  join public.ap_match_evaluations evaluation on evaluation.id=match.release_evaluation_id;

create function pg_temp.begin_material_rehearsal(authz uuid,selection_count integer) returns jsonb language sql as $$
  select public.ap_begin_authorized_material_checkout('14000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001','a4b00000-0000-4000-8000-000000000001',
    '54000000-0000-4000-8000-000000000001','e8b00000-0000-4000-8000-000000000001',
    'fixture-material-durable-'||selection_count,repeat('8',64),
    (select jsonb_agg(selection order by position) from rehearsal_material_selections where position<=selection_count),
    'KEEP_EXISTING_TIMELINE',null,false,true,true,'REHEARSAL',repeat('a',40),authz);
$$;
savepoint before_one_pack_rehearsal;
create temporary table one_pack_authorization as select public.ap_authorize_staging_rehearsal_checkout(repeat('a',40),'MATERIALS',
  '14000000-0000-4000-8000-000000000001','a4b00000-0000-4000-8000-000000000001',pg_temp.material_resource_hash(1),
  '14000000-0000-4000-8000-000000000003','fixture-one-pack-rehearsal',clock_timestamp()+interval '10 minutes') as id;
create temporary table one_pack_result as select pg_temp.begin_material_rehearsal((select id from one_pack_authorization),1) as result;
select pg_temp.assert_true((select (result->>'amountCents')::integer=799 and (result->>'lineCount')::integer=1 from one_pack_result),
  'one-pack durable checkout did not preserve the 799-cent single-line contract');
rollback to savepoint before_one_pack_rehearsal;

create temporary table two_pack_authorization as select public.ap_authorize_staging_rehearsal_checkout(repeat('a',40),'MATERIALS',
  '14000000-0000-4000-8000-000000000001','a4b00000-0000-4000-8000-000000000001',pg_temp.material_resource_hash(2),
  '14000000-0000-4000-8000-000000000003','fixture-two-pack-rehearsal',clock_timestamp()+interval '10 minutes') as id;
do $$ begin
  perform pg_temp.begin_material_rehearsal((select id from two_pack_authorization),1);
  raise exception 'material-authorization-accepted-different-cart';
exception when raise_exception then if sqlerrm<>'staging_rehearsal_authorization_denied' then raise; end if; end $$;
savepoint before_invalid_material_cart;
update rehearsal_material_selections set selection=jsonb_set(selection,'{ruleId}','"e8800000-0000-4000-8000-000000000099"') where position=2;
do $$ begin
  perform pg_temp.begin_material_rehearsal((select id from two_pack_authorization),2);
  raise exception 'invalid-line-did-not-reject-whole-cart';
exception when raise_exception then if sqlerrm<>'employer_instructions_block_materials' then raise; end if; end $$;
select pg_temp.assert_true(not exists(select 1 from public.ap_checkout_initiations where request_key='fixture-material-durable-2')
  and not exists(select 1 from public.ap_material_checkout_intents where request_key='fixture-material-durable-2'),
  'failed material cart retained a partial intent or durable initiation');
rollback to savepoint before_invalid_material_cart;
create temporary table two_pack_result as select pg_temp.begin_material_rehearsal((select id from two_pack_authorization),2) as result;
select pg_temp.assert_true((select result-'replayed'=pg_temp.begin_material_rehearsal((select id from two_pack_authorization),2)-'replayed' from two_pack_result),
  'material retry changed immutable provider command/deadline');
select pg_temp.assert_true((select (result->>'amountCents')::integer=1598 and (result->>'lineCount')::integer=2 from two_pack_result)
  and (select count(*)=2 from public.ap_material_lines where id in (select (selection->>'lineId')::uuid from rehearsal_material_selections))
  and (select count(*)=1 and sum(units)=2 from public.ap_capacity_allocations where request_key='materials-checkout:fixture-material-durable-2'),
  'two-pack checkout did not reserve the whole cart once at 1598 cents');
do $$ begin
  update public.ap_material_line_revisions set binding_sha256=repeat('f',64)
    where id='e8600000-0000-4000-8000-000000000001';
  raise exception 'revision-content-became-mutable';
exception when raise_exception then if sqlerrm<>'immutable_record' then raise; end if; end $$;
do $$ begin
  update public.ap_material_line_revisions set capacity_allocation_id=null
    where id='e8600000-0000-4000-8000-000000000001';
  raise exception 'revision-capacity-became-rebindable';
exception when raise_exception then if sqlerrm<>'immutable_record' then raise; end if; end $$;
do $$ begin
  update public.ap_material_line_revisions set started_at=clock_timestamp(),due_at=clock_timestamp()+interval '24 hours'
    where id='e8600000-0000-4000-8000-000000000001';
  raise exception 'unpaid-revision-clock-started';
exception when raise_exception then if sqlerrm<>'material_revision_verified_clock_invalid' then raise; end if; end $$;
savepoint before_late_paid_material_session;
select public.ap_bind_checkout_initiation((select (result->>'checkoutIntentId')::uuid from two_pack_result),'cs_material_late_paid',
  (select (result->>'providerSessionDeadline')::timestamptz from two_pack_result));
select public.ap_reconcile_checkout_initiation((select (result->>'checkoutIntentId')::uuid from two_pack_result),
  'cs_material_late_paid','expired','unpaid');
create temporary table late_material_payment as select public.ap_apply_verified_material_payment(
  'evt_material_late_paid','checkout.session.completed',repeat('e',64),clock_timestamp(),
  (select (result->>'checkoutIntentId')::uuid from two_pack_result),'cs_material_late_paid','pi_material_late_paid',
  'paid','card',1598,'USD','fixture-material@example.invalid',statement_timestamp()-interval '1 minute',
  'e8c00000-0000-4000-8000-000000000002') as result;
select pg_temp.assert_true((select result->>'state'='REFUND_PROCESSING' from late_material_payment)
  and (select count(*)=2 and sum(amount_cents)=1598 and bool_and(state='PENDING') from public.ap_refund_operations
    where payment_attempt_id=(select (result->>'paymentAttemptId')::uuid from two_pack_result))
  and (select settlement='PAID' from public.ap_payment_attempts where id=(select (result->>'paymentAttemptId')::uuid from two_pack_result)),
  'late paid two-pack Session did not preserve payment and independent exact line refunds');
rollback to savepoint before_late_paid_material_session;
select public.ap_revoke_staging_rehearsal_checkout((select id from two_pack_authorization),
  '14000000-0000-4000-8000-000000000003','fixture-revoke-material-during-provider-call');
select public.ap_bind_checkout_initiation((select (result->>'checkoutIntentId')::uuid from two_pack_result),'cs_material_rehearsal',
  (select (result->>'providerSessionDeadline')::timestamptz from two_pack_result));
select public.ap_apply_verified_material_payment('evt_material_rehearsal','checkout.session.completed',repeat('e',64),clock_timestamp(),
  (select (result->>'checkoutIntentId')::uuid from two_pack_result),'cs_material_rehearsal','pi_material_rehearsal',
  'paid','card',1598,'USD','fixture-material@example.invalid',statement_timestamp()-interval '1 minute','e8c00000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*)=2 and bool_and(fulfillment='PAID' and allocated_amount_cents=799
  and materials_started_at=greatest(selection_confirmed_at,materials_payment_verified_at)
  and materials_due_at=materials_started_at+interval '24 hours' and materials_started_at<materials_capacity_confirmed_at)
  from public.ap_material_lines where id in (select (selection->>'lineId')::uuid from rehearsal_material_selections)),
  'revoked material authorization lost paid lines or advanced the customer clock to processing time');
do $$ begin
  update public.ap_material_line_revisions set started_at=started_at+interval '1 hour',due_at=due_at+interval '1 hour'
    where id='e8600000-0000-4000-8000-000000000001';
  raise exception 'paid-revision-clock-was-rewritten';
exception when raise_exception then if sqlerrm<>'immutable_record' then raise; end if; end $$;
do $$ begin
  update public.ap_capacity_allocation_members set units=units+1
    where revision_id='e8600000-0000-4000-8000-000000000001';
  raise exception 'capacity-member-identity-became-mutable';
exception when raise_exception then if sqlerrm<>'immutable_capacity_member_identity' then raise; end if; end $$;
do $$ begin
  update public.ap_capacity_allocation_members set member_lifecycle='SUPERSEDED',member_debit_disposition='RETURNED',superseded_at=clock_timestamp()
    where revision_id='e8600000-0000-4000-8000-000000000001';
  raise exception 'spent-material-capacity-was-returned';
exception when raise_exception then if sqlerrm<>'invalid_capacity_member_transition' then raise; end if; end $$;
select 'STAGING_REHEARSAL_MATERIAL_CHECKOUT_OK';
rollback to savepoint before_rehearsal_material_checkout;
