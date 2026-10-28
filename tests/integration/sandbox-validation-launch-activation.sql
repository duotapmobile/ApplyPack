begin;
create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception '%',message; end if; end $$;
create function pg_temp.expect_error(statement text,expected_error text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'expected_error_not_raised:%',expected_error;
exception when others then if sqlerrm<>expected_error then raise; end if;
end $$;

select pg_temp.assert_true(public.ap_manual_launch_schema_readiness()->>'ready'='true'
  and public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'='202610230086'
  and jsonb_array_length(public.ap_manual_launch_schema_readiness()->'requiredMigrations')=10,
  '086 schema and every prior identity checkpoint must be ready');
savepoint before_checkpoint_removal;
delete from public.ap_migration_checkpoints where migration_id='202610230086';
select pg_temp.assert_true(public.ap_manual_launch_schema_readiness()->>'ready'='false','missing086 checkpoint accepted');
rollback to savepoint before_checkpoint_removal;
savepoint before_trigger_removal;
alter table public.ap_manual_launch_activations disable trigger ap_prepare_sandbox_launch_activation;
select pg_temp.assert_true(public.ap_manual_launch_schema_readiness()->>'ready'='false','disabled086 import guard accepted');
rollback to savepoint before_trigger_removal;
savepoint before_canary_guard_removal;
alter table public.ap_refund_operations disable trigger ap_guard_staging_canary_refund;
select pg_temp.assert_true(public.ap_manual_launch_schema_readiness()->>'ready'='false','disabled production refund guard accepted');
rollback to savepoint before_canary_guard_removal;
savepoint before_constraint_removal;
alter table public.ap_manual_launch_activations drop constraint ap_manual_launch_activation_contract_check;
select pg_temp.assert_true(public.ap_manual_launch_schema_readiness()->>'ready'='false','missing086 constraint accepted');
rollback to savepoint before_constraint_removal;
savepoint before_insert_grant;
grant insert on public.ap_manual_launch_activations to service_role;
select pg_temp.assert_true(public.ap_manual_launch_schema_readiness()->>'ready'='false','direct import grant accepted');
rollback to savepoint before_insert_grant;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('86000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'sandbox-proof-admin@example.invalid','',now(),'{}','{}',now(),now()),
  ('86000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'sandbox-proof-customer@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='86000000-0000-4000-8000-000000000001';
update public.ap_commerce_configuration set canonical_site_url='https://applypack.work',
  tax_treatment='TAX_INCLUSIVE_NO_ADDED_AMOUNT',tax_inclusive=true,currency='USD',
  search_price_cents=1899,material_line_price_cents=799 where singleton;

create function pg_temp.receipt() returns jsonb language sql as $$
  select jsonb_build_object('schemaVersion','applypack-sandbox-validation-v1',
    'sourceEnvironment','staging','sourceProjectRef','fmugizadzdnqfckujqlw',
    'sourceOrigin','https://applypack-staging-staging.up.railway.app','stripeAccountId','acct_1UTeOMJBHv2xRTvu',
    'livemode',false,'currency','USD','releaseSha',repeat('a',40),
    'verifiedAt',to_char(clock_timestamp()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'proofBundleSha256',repeat('b',64),'purchases',jsonb_build_array(
      jsonb_build_object('productKind','SEARCH','units',1,'amountCents',1899,
        'paymentAttemptId','86000000-0000-4000-8000-000000000011','checkoutSessionId','cs_test_Search',
        'paymentIntentId','pi_Search','checkoutCompletedEventId','evt_Search',
        'deliveredReleaseId','86000000-0000-4000-8000-000000000021','refundId','re_Search',
        'refundAmountCents',1899,'refundStatus','succeeded'),
      jsonb_build_object('productKind','MATERIALS','units',1,'amountCents',799,
        'paymentAttemptId','86000000-0000-4000-8000-000000000012','checkoutSessionId','cs_test_Materials',
        'paymentIntentId','pi_Materials','checkoutCompletedEventId','evt_Materials',
        'deliveredReleaseId','86000000-0000-4000-8000-000000000022','refundId','re_Materials',
        'refundAmountCents',799,'refundStatus','succeeded')));
$$;
create function pg_temp.evidence(receipt jsonb) returns jsonb language plpgsql as $$
declare result jsonb:=jsonb_build_object('activationContractVersion','sandbox-proof-live-pilot-v1',
  'sandboxValidation',receipt,'workerNetworkAttestationSha256',repeat('c',64),'evidenceBundleSha256',repeat('d',64));
  name text;
begin
  foreach name in array array['healthEvidenceReference','databaseEvidenceReference','paymentEvidenceReference',
    'emailEvidenceReference','kmsEvidenceReference','workerEvidenceReference','maintenanceEvidenceReference',
    'backupRestoreEvidenceReference','inventoryEvidenceReference','accessibilityEvidenceReference','productSupervisorReference',
    'securitySupervisorReference','operationsSupervisorReference','tenthManSupervisorReference',
    'acceptedP2DispositionReference','legacySubscriptionRetirementReference'] loop
    result:=result||jsonb_build_object(name,'reviewed-fixture-evidence');
  end loop;
  return result;
end $$;
create temporary table proof_fixture as select pg_temp.receipt() as receipt;
select pg_temp.assert_true(public.ap_sandbox_validation_receipt_valid((select receipt from proof_fixture),repeat('a',40),clock_timestamp()),
  'valid strict sandbox evidence rejected');

-- Every malformed receipt must fail at the database boundary, including keys
-- that a stale or compromised API could submit directly.
do $$ declare candidate jsonb; path text[]; replacement jsonb; duplicate_key text; receipt jsonb:=(select receipt from proof_fixture); begin
  for path,replacement in select * from (values
    (array['schemaVersion'],'"legacy"'::jsonb),(array['sourceEnvironment'],'"production"'::jsonb),
    (array['sourceProjectRef'],'"differentproject"'::jsonb),(array['sourceOrigin'],'"https://applypack.work"'::jsonb),
    (array['stripeAccountId'],'"acct_Wrong"'::jsonb),(array['livemode'],'true'::jsonb),
    (array['currency'],'"usd"'::jsonb),(array['releaseSha'],to_jsonb(repeat('e',40))),
    (array['verifiedAt'],to_jsonb(to_char(clock_timestamp()-interval '25 hours','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
    (array['verifiedAt'],to_jsonb(to_char(clock_timestamp()+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
    (array['verifiedAt'],'"2026-02-30T00:00:00Z"'::jsonb),(array['proofBundleSha256'],'"missingdigest"'::jsonb),
    (array['purchases'],'{}'::jsonb),(array['purchases','0','amountCents'],'2000'::jsonb),
    (array['purchases','1','amountCents'],'800'::jsonb),(array['purchases','0','units'],'2'::jsonb),
    (array['purchases','1','units'],'"1"'::jsonb),(array['purchases','0','refundAmountCents'],'1898'::jsonb),
    (array['purchases','1','refundStatus'],'"pending"'::jsonb),(array['purchases','0','checkoutSessionId'],'"cs_live_Wrong"'::jsonb),
    (array['purchases','0','paymentAttemptId'],'"not-a-uuid"'::jsonb),(array['purchases','0','extra'],'true'::jsonb),
    (array['extra'],'true'::jsonb)) changes(path,replacement)
  loop
    candidate:=jsonb_set(receipt,path,replacement);
    perform pg_temp.assert_true(not public.ap_sandbox_validation_receipt_valid(candidate,repeat('a',40),clock_timestamp()),
      'invalid receipt accepted at '||array_to_string(path,'.'));
    begin
      perform public.ap_record_manual_launch_activation('PUBLIC',repeat('a',40),pg_temp.evidence(candidate),
        '86000000-0000-4000-8000-000000000001');
      raise exception 'invalid_receipt_imported';
    exception when others then if sqlerrm<>'manual_launch_sandbox_validation_invalid' then raise; end if; end;
  end loop;
  foreach duplicate_key in array array['productKind','paymentAttemptId','checkoutSessionId','paymentIntentId',
    'checkoutCompletedEventId','deliveredReleaseId','refundId'] loop
    candidate:=jsonb_set(receipt,array['purchases','1',duplicate_key],receipt->'purchases'->0->duplicate_key);
    perform pg_temp.assert_true(not public.ap_sandbox_validation_receipt_valid(candidate,repeat('a',40),clock_timestamp()),
      'duplicate purchase identity accepted:'||duplicate_key);
  end loop;
  perform pg_temp.assert_true(not public.ap_sandbox_validation_receipt_valid(receipt-'schemaVersion',repeat('a',40),clock_timestamp()),'missing schema version accepted');
  perform pg_temp.assert_true(not public.ap_sandbox_validation_receipt_valid(receipt,repeat('e',40),clock_timestamp()),'wrong release accepted');
  perform pg_temp.assert_true(not public.ap_sandbox_validation_receipt_valid(receipt,repeat('a',40),clock_timestamp()+interval '25 hours'),'expired import accepted');
end $$;
select pg_temp.assert_true(not exists(select 1 from public.ap_manual_launch_activations),'negative imports created evidence');

select pg_temp.expect_error(format('select public.ap_record_manual_launch_activation(''PUBLIC'',%L,%L::jsonb,%L::uuid)',
  repeat('a',40),pg_temp.evidence((select receipt from proof_fixture))-'activationContractVersion','86000000-0000-4000-8000-000000000001'),
  'manual_launch_activation_input_invalid');
select pg_temp.expect_error(format('select public.ap_record_manual_launch_activation(''PUBLIC'',%L,%L::jsonb,%L::uuid)',
  repeat('a',40),pg_temp.evidence((select receipt from proof_fixture)),'86000000-0000-4000-8000-000000000002'),
  'manual_launch_activation_admin_required');
select pg_temp.expect_error(format('select public.ap_record_manual_launch_activation(''PUBLIC'',%L,%L::jsonb,%L::uuid)',
  repeat('a',40),pg_temp.evidence((select receipt from proof_fixture))-'securitySupervisorReference','86000000-0000-4000-8000-000000000001'),
  'manual_launch_activation_evidence_incomplete');

-- No request parameters, direct row writes, or generic refund reason may
-- create a production canary or special production test refund.
select pg_temp.expect_error(format('select public.ap_record_manual_launch_activation(''CANARY'',%L,%L::jsonb,%L::uuid)',
  repeat('a',40),pg_temp.evidence((select receipt from proof_fixture)),'86000000-0000-4000-8000-000000000001'),
  'manual_launch_production_canary_retired');
select pg_temp.expect_error('select public.ap_set_checkout_mode(''CANARY'',repeat(''a'',40),''86000000-0000-4000-8000-000000000001'',''fixture-production-canary-blocked'')',
  'manual_launch_production_canary_retired');
select pg_temp.expect_error('select public.ap_authorize_scoped_manual_launch_canary_checkout(repeat(''a'',40),''SEARCH'',null,null,null,''fixture'',clock_timestamp(),null,null)',
  'manual_launch_production_canary_retired');
select pg_temp.expect_error('select public.ap_bind_manual_launch_canary_payment(null,repeat(''a'',40))','manual_launch_production_canary_retired');
select pg_temp.expect_error('select public.ap_queue_manual_launch_canary_refund(null,null,''fixture'')','manual_launch_production_canary_retired');
select pg_temp.expect_error('select public.ap_queue_manual_launch_canary_refund(null,null,''fixture'',repeat(''a'',40))','manual_launch_production_canary_retired');
select pg_temp.expect_error('insert into public.ap_refund_operations(reason_code) values(''MANUAL_LAUNCH_CANARY'')','manual_launch_production_canary_retired');
select pg_temp.expect_error('insert into public.ap_manual_launch_canary_authorizations(release_sha) values(repeat(''a'',40))','manual_launch_production_canary_retired');

savepoint before_wrong_environment;
update public.ap_commerce_configuration set canonical_site_url='https://applypack-staging-staging.up.railway.app' where singleton;
select pg_temp.expect_error(format('select public.ap_record_manual_launch_activation(''PUBLIC'',%L,%L::jsonb,%L::uuid)',
  repeat('a',40),pg_temp.evidence((select receipt from proof_fixture)),'86000000-0000-4000-8000-000000000001'),
  'manual_launch_fixed_total_configuration_required');
rollback to savepoint before_wrong_environment;

create temporary table activation_fixture as select public.ap_record_manual_launch_activation('PUBLIC',repeat('a',40),
  pg_temp.evidence((select receipt from proof_fixture)),'86000000-0000-4000-8000-000000000001') as id;
select pg_temp.assert_true((select activation_contract_version='sandbox-proof-live-pilot-v1' and activation_phase='PUBLIC'
    and canary_reconciled_amount_cents=0 and canary_reconciliation_reference is null
    and sandbox_validation=(select receipt from proof_fixture)
    and sandbox_validation_digest=encode(extensions.digest(convert_to(sandbox_validation::text,'UTF8'),'sha256'),'hex')
  from public.ap_manual_launch_activations where id=(select id from activation_fixture)),
  'new activation fabricated live canary totals or lost immutable receipt/digest');
select pg_temp.assert_true(public.ap_record_manual_launch_activation('PUBLIC',repeat('a',40),
  pg_temp.evidence((select receipt from proof_fixture)),'86000000-0000-4000-8000-000000000001')=(select id from activation_fixture),
  'activation replay must return the same immutable record');
select pg_temp.assert_true((select count(*)=1 from public.ap_audit_events where action='MANUAL_LAUNCH_ACTIVATION_RECORDED'),
  'activation replay duplicated audit');
select pg_temp.expect_error('update public.ap_manual_launch_activations set sandbox_validation_digest=repeat(''f'',64)',
  'manual_launch_activation_is_immutable');
select pg_temp.expect_error('delete from public.ap_manual_launch_activations','manual_launch_activation_is_immutable');
select pg_temp.expect_error(format('select public.ap_record_manual_launch_activation(''PUBLIC'',%L,%L::jsonb,%L::uuid)',
  repeat('a',40),pg_temp.evidence(jsonb_set((select receipt from proof_fixture),'{proofBundleSha256}',to_jsonb(repeat('f',64)))),
  '86000000-0000-4000-8000-000000000001'),'manual_launch_activation_evidence_phase_conflict');

select public.ap_set_checkout_mode('PUBLIC',repeat('a',40),'86000000-0000-4000-8000-000000000001','reviewed-production-pilot-open');
select pg_temp.assert_true(public.ap_assert_checkout_initiation_authorized('PUBLIC',
  '86000000-0000-4000-8000-000000000002',repeat('a',40),null,'SEARCH',gen_random_uuid(),null) is null,
  'PUBLIC authorization did not accept fresh reviewed sandbox activation');
select pg_temp.expect_error('select public.ap_assert_checkout_initiation_authorized(''PUBLIC'',null,repeat(''b'',40),null,''SEARCH'',null,null)',
  'checkout_database_mode_denied');
select pg_temp.expect_error('select public.ap_assert_checkout_initiation_authorized(''CANARY'',null,repeat(''a'',40),null,''SEARCH'',null,null)',
  'manual_launch_production_canary_retired');
select pg_temp.assert_true((select public.ap_sandbox_validation_receipt_valid(sandbox_validation,release_sha,created_at)
  from public.ap_manual_launch_activations where id=(select id from activation_fixture)),
  'persisted proof must be evaluated at activation time rather than daily checkout time');

rollback;
