-- Included by the real search fixture after its intake, consent, feasibility,
-- source authorization and capacity setup. Every mutation is rolled back.
savepoint before_rehearsal_checkout_attempts;
create temporary table rehearsal_initial_mode as select generation from public.ap_checkout_mode_configuration where singleton;
do $$ declare upgraded boolean:=to_regprocedure('public.ap_sandbox_activation_schema_installed()') is not null; begin
  if public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from
      (case when upgraded then '202610230086' else '202610220085' end)
    or public.ap_manual_launch_schema_readiness()->'requiredMigrations' is distinct from (jsonb_build_array(
      '202610040077','202610040078','202610040079','202610040080','202610190081',
      '202610190082','202610190083','202610190084','202610220085')
      ||case when upgraded then '["202610230086"]'::jsonb else '[]'::jsonb end)
    then raise exception 'rehearsal_required_migrations_contract_failed'; end if;
end $$;
update public.ap_commerce_configuration set
  canonical_site_url='https://applypack-staging-staging.up.railway.app',
  sales_activation_approved=false,sales_activation_reference=null,
  launch_activation_id=null,launch_release_sha=null where singleton;
select public.ap_set_checkout_mode('REHEARSAL',repeat('a',40),
  '14000000-0000-4000-8000-000000000003','fixture-rehearsal-mode-authorization');

do $$ begin
  perform public.ap_authorize_staging_rehearsal_checkout(repeat('a',40),'SEARCH',
    '14000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001',null,
    '14000000-0000-4000-8000-000000000003','fixture-rehearsal-expiry-over-limit',clock_timestamp()+interval '31 minutes');
  raise exception 'rehearsal_overlong_authorization_accepted';
exception when raise_exception then
  if sqlerrm<>'staging_rehearsal_authorization_invalid' then raise; end if;
end $$;
do $$ begin
  perform public.ap_authorize_staging_rehearsal_checkout(repeat('a',40),'SEARCH',
    '14000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000001',null,
    '14000000-0000-4000-8000-000000000003','fixture-rehearsal-wrong-customer',clock_timestamp()+interval '10 minutes');
  raise exception 'rehearsal_wrong_customer_accepted';
exception when raise_exception then
  if sqlerrm<>'staging_rehearsal_search_customer_mismatch' then raise; end if;
end $$;

create temporary table rehearsal_fixture_authorization as select public.ap_authorize_staging_rehearsal_checkout(
  repeat('a',40),'SEARCH','14000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000001',null,'14000000-0000-4000-8000-000000000003',
  'fixture-rehearsal-exact-customer-draft',clock_timestamp()+interval '10 minutes') as id;
select public.ap_issue_search_checkout_invitation(
  'e4300000-0000-4000-8000-000000000085','34000000-0000-4000-8000-000000000001',
  '54000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',
  repeat('7',64),clock_timestamp()+interval '20 minutes','14000000-0000-4000-8000-000000000003',
  'Authorized rehearsal still requires a real capacity reservation and invitation.');

create function pg_temp.begin_rehearsal_checkout(request_sha text default repeat('6',64))
returns jsonb language sql as $$
  select to_jsonb(result) from public.ap_begin_authorized_search_checkout(
    'e4300000-0000-4000-8000-000000000085',repeat('7',64),
    '34000000-0000-4000-8000-000000000001',repeat('a',64),
    '54000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',
    'rehearsal-provider-retry','e4200000-0000-4000-8000-000000000085',request_sha,
    'e4300000-0000-4000-8000-000000000086','search-checkout/rehearsal-provider-retry',
    'e4400000-0000-4000-8000-000000000085','e4500000-0000-4000-8000-000000000085',
    repeat('5',64),repeat('4',64),'REHEARSAL','14000000-0000-4000-8000-000000000001',repeat('a',40),
    (select id from rehearsal_fixture_authorization),'5a000000-0000-4000-8000-000000000001') result;
$$;
create temporary table rehearsal_fixture_result as select pg_temp.begin_rehearsal_checkout() result;
create function pg_temp.apply_rehearsal_payment(session_id text,event_id text,payment_id text)
returns jsonb language sql as $$
  select public.ap_apply_verified_search_payment(
    event_id,'checkout.session.completed',repeat('e',64),clock_timestamp(),statement_timestamp()-interval '1 minute',
    session_id,payment_id,'succeeded','card',1899,'USD','fixture-payer@example.invalid',
    '14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000085',
    '94000000-0000-4000-8000-000000000085','a4600000-0000-4000-8000-000000000085',
    'a4700000-0000-4000-8000-000000000085',repeat('d',64),
    'a4800000-0000-4000-8000-000000000085','a4800000-0000-4000-8000-000000000086',
    'a4900000-0000-4000-8000-000000000085','a4900000-0000-4000-8000-000000000086');
$$;
select pg_temp.assert_true(
  (select result=pg_temp.begin_rehearsal_checkout() from rehearsal_fixture_result),
  'ambiguous-response retry did not return the exact persisted command/deadline');
select pg_temp.assert_true(
  (select count(*)=1 from public.ap_checkout_initiations where request_key='rehearsal-provider-retry')
  and (select count(*)=1 from public.ap_payment_attempts where id='e4500000-0000-4000-8000-000000000085')
  and (select count(*)=1 from public.ap_capacity_allocations
    where request_key='search-checkout:rehearsal-provider-retry'),
  'retry duplicated durable attempt/payment/reservation');
select pg_temp.assert_true(
  (select initiation.provider_session_deadline>authz.expires_at+interval '24 minutes'
    and allocation.expires_at=initiation.provider_session_deadline
    and quote.expires_at=initiation.provider_session_deadline
    from public.ap_checkout_initiations initiation
      join public.ap_staging_rehearsal_authorizations authz on authz.id=initiation.authorization_id
      join public.ap_capacity_allocations allocation on allocation.id=initiation.capacity_allocation_id
      join public.ap_checkout_attempts checkout on checkout.id=initiation.id
      join public.ap_quotes quote on quote.id=checkout.quote_id
    where initiation.id='e4400000-0000-4000-8000-000000000085'),
  'authorization-to-initiate expiry was incorrectly used as the Session deadline');
do $$ begin
  perform pg_temp.begin_rehearsal_checkout(repeat('f',64));
  raise exception 'rehearsal_conflicting_retry_accepted';
exception when raise_exception then
  if sqlerrm<>'checkout_initiation_replay_conflict' then raise; end if;
end $$;

savepoint before_rehearsal_absence_reconciliation;
select public.ap_revoke_staging_rehearsal_checkout((select id from rehearsal_fixture_authorization),
  '14000000-0000-4000-8000-000000000003','fixture-crash-before-provider-create');
do $$ begin
  perform public.ap_reconcile_checkout_initiation_absence('e4400000-0000-4000-8000-000000000085',clock_timestamp(),repeat('b',64));
  raise exception 'provider_absence_accepted_before_session_deadline';
exception when raise_exception then
  if sqlerrm<>'checkout_provider_absence_reconciliation_denied' then raise; end if;
end $$;
-- Disposable PostgreSQL clock fixture only: age the persisted initiation with
-- its immutability trigger disabled, then restore that trigger before any RPC.
-- Production callers cannot update these fields or disable triggers.
alter table public.ap_checkout_initiations disable trigger ap_checkout_initiations_history;
update public.ap_checkout_initiations set initiated_at=initiated_at-interval '42 minutes',
  provider_session_deadline=provider_session_deadline-interval '42 minutes'
  where id='e4400000-0000-4000-8000-000000000085';
alter table public.ap_checkout_initiations enable trigger ap_checkout_initiations_history;
do $$ begin
  perform public.ap_reconcile_checkout_initiation_absence('e4400000-0000-4000-8000-000000000085',clock_timestamp(),repeat('b',64));
  raise exception 'provider_absence_accepted_without_durable_listing_receipt';
exception when raise_exception then
  if sqlerrm<>'checkout_provider_absence_reconciliation_denied' then raise; end if;
end $$;
insert into public.audit_logs(action,entity_type,entity_id,details)
select 'checkout_provider_absence_observed','checkout_initiation',id::text,
  jsonb_build_object('attemptId',id,'observedAt',clock_timestamp(),'evidenceSha256',repeat('b',64),
    'created',jsonb_build_object('gte',floor(extract(epoch from initiated_at))::bigint-5,
      'lte',floor(extract(epoch from provider_session_deadline))::bigint),
    'requests',jsonb_build_array(jsonb_build_object('requestId','req_fixture_complete_listing','count',0,'hasMore',false)))
from public.ap_checkout_initiations where id='e4400000-0000-4000-8000-000000000085';
select public.ap_reconcile_checkout_initiation_absence('e4400000-0000-4000-8000-000000000085',
  (select (details->>'observedAt')::timestamptz from public.audit_logs
    where action='checkout_provider_absence_observed' and entity_id='e4400000-0000-4000-8000-000000000085'),repeat('b',64));
select pg_temp.assert_true(
  (select state='EXPIRED' and provider_session_id is null from public.ap_checkout_initiations
    where id='e4400000-0000-4000-8000-000000000085')
  and (select lifecycle in ('RELEASED','EXPIRED') and debit_disposition='RETURNED' from public.ap_capacity_allocations
    where request_key='search-checkout:rehearsal-provider-retry'),
  'complete provider absence did not close the uncharged attempt and release capacity');
select public.ap_bind_checkout_initiation('e4400000-0000-4000-8000-000000000085','cs_absence_late_paid',
  (select provider_session_deadline from public.ap_checkout_initiations where id='e4400000-0000-4000-8000-000000000085'));
select pg_temp.assert_true(
  pg_temp.apply_rehearsal_payment('cs_absence_late_paid','evt_absence_late_paid','pi_absence_late_paid')->>'outcome'='STALE_REFUND_PENDING',
  'late verified payment after absence cleanup did not receive the full-refund remedy');
select pg_temp.assert_true(
  (select settlement='PAID' from public.ap_payment_attempts where id='e4500000-0000-4000-8000-000000000085')
  and (select amount_cents=1899 and state='PENDING' from public.ap_refund_operations
    where payment_attempt_id='e4500000-0000-4000-8000-000000000085'),
  'absence cleanup lost a later payment or its refund obligation');
rollback to savepoint before_rehearsal_absence_reconciliation;

savepoint before_rehearsal_late_binding;
select public.ap_release_unconsumed_capacity(
  (select capacity_allocation_id from public.ap_checkout_initiations where id='e4400000-0000-4000-8000-000000000085'),
  'FIXTURE_RESERVATION_LOST_BEFORE_PROVIDER_RESPONSE');
create temporary table rehearsal_late_binding_result as select
  public.ap_bind_checkout_initiation('e4400000-0000-4000-8000-000000000085','cs_rehearsal_late',
    (select provider_session_deadline from public.ap_checkout_initiations
      where id='e4400000-0000-4000-8000-000000000085')) as result;
select pg_temp.assert_true(
  (select (result->>'expirationRequired')::boolean from rehearsal_late_binding_result)
  and (select provider_checkout_session_id='cs_rehearsal_late' from public.ap_checkout_attempts
    where id='e4400000-0000-4000-8000-000000000085'),
  'late provider observation lost the binding required for verified payment/refund accounting');
select pg_temp.assert_true(
  pg_temp.apply_rehearsal_payment('cs_rehearsal_late','evt_rehearsal_late','pi_rehearsal_late')->>'outcome'='STALE_REFUND_PENDING',
  'late paid Session was not accounted for by the existing full-refund remedy');
select pg_temp.assert_true(
  (select settlement='PAID' from public.ap_payment_attempts where id='e4500000-0000-4000-8000-000000000085')
  and (select amount_cents=1899 and state='PENDING' from public.ap_refund_operations
    where payment_attempt_id='e4500000-0000-4000-8000-000000000085'),
  'late observation did not persist payment and exact refund obligation');
rollback to savepoint before_rehearsal_late_binding;

select public.ap_revoke_staging_rehearsal_checkout((select id from rehearsal_fixture_authorization),
  '14000000-0000-4000-8000-000000000003','fixture-revoked-during-provider-call');
select pg_temp.assert_true(
  (public.ap_bind_checkout_initiation('e4400000-0000-4000-8000-000000000085','cs_rehearsal_race',
    (select provider_session_deadline from public.ap_checkout_initiations
      where id='e4400000-0000-4000-8000-000000000085'))->>'expirationRequired')::boolean,
  'revoke/create race did not preserve the Session and require expiration');
select pg_temp.assert_true(
  (select provider_checkout_session_id='cs_rehearsal_race' and state='OPEN'
    from public.ap_checkout_attempts where id='e4400000-0000-4000-8000-000000000085'),
  'webhook-before-response cannot find the promoted underlying checkout');
do $$ begin
  perform public.ap_bind_checkout_initiation('e4400000-0000-4000-8000-000000000085','cs_second_session',
    (select provider_session_deadline from public.ap_checkout_initiations
      where id='e4400000-0000-4000-8000-000000000085'));
  raise exception 'second_session_binding_accepted';
exception when raise_exception then
  if sqlerrm<>'checkout_initiation_provider_binding_invalid' then raise; end if;
end $$;
savepoint before_unverified_provider_paid;
select public.ap_reconcile_checkout_initiation('e4400000-0000-4000-8000-000000000085',
  'cs_rehearsal_race','complete','paid');
select pg_temp.assert_true(
  exists(select 1 from public.ap_checkout_initiations_requiring_reconciliation(100,null)
    where id='e4400000-0000-4000-8000-000000000085')
  and exists(select 1 from public.ap_checkout_initiations_requiring_reconciliation(1,
    (select id from rehearsal_fixture_authorization)) where id='e4400000-0000-4000-8000-000000000085')
  and not exists(select 1 from public.ap_checkout_initiations_requiring_reconciliation(1,
    'e4400000-0000-4000-8000-000000000099')),
  'provider-paid without verified payment disappeared from reconciliation or ignored authorization filter');
select public.ap_set_checkout_mode('LOCKED',repeat('a',40),'14000000-0000-4000-8000-000000000003',
  'fixture-lock-with-unverified-provider-payment');
do $$ begin
  perform public.ap_set_checkout_mode('REHEARSAL',repeat('a',40),'14000000-0000-4000-8000-000000000003',
    'fixture-deny-unlock-with-unverified-payment');
  raise exception 'unverified_provider_payment_permitted_unlock';
exception when raise_exception then
  if sqlerrm<>'checkout_mode_transition_requires_reconciliation' then raise; end if;
end $$;
rollback to savepoint before_unverified_provider_paid;
select pg_temp.assert_true(
  pg_temp.apply_rehearsal_payment('cs_rehearsal_race','evt_rehearsal_race','pi_rehearsal_race')->>'outcome'='SEARCH_ACTIVE',
  'revoked initiating authorization discarded a valid paid Session');
select pg_temp.assert_true(
  (pg_temp.apply_rehearsal_payment('cs_rehearsal_race','evt_rehearsal_race','pi_rehearsal_race')->>'replayed')::boolean,
  'verified paid event replay created duplicate fulfillment');
select pg_temp.assert_true(
  (select service.service_started_at=payment.payment_verified_at
    and service.delivery_due_at=payment.payment_verified_at+interval '24 hours'
    from public.ap_search_services service join public.ap_payment_attempts payment
      on payment.id=service.winning_payment_attempt_id
    where payment.id='e4500000-0000-4000-8000-000000000085'),
  'rehearsal delivery clock moved to webhook-processing time');
select public.ap_reconcile_checkout_initiation('e4400000-0000-4000-8000-000000000085',
  'cs_rehearsal_race','complete','paid');
select public.ap_reconcile_checkout_initiation('e4400000-0000-4000-8000-000000000085',
  'cs_rehearsal_race','expired','unpaid');
select pg_temp.assert_true(
  (select state='PAID' from public.ap_checkout_initiations where id='e4400000-0000-4000-8000-000000000085')
  and not exists(select 1 from public.ap_checkout_initiations_requiring_reconciliation(100,null)
    where id='e4400000-0000-4000-8000-000000000085')
  and (select lifecycle='CONSUMED' and debit_disposition='SPENT' from public.ap_capacity_allocations
    where request_key='search-checkout:rehearsal-provider-retry'),
  'stale unpaid provider event erased a paid observation or released its capacity');
select pg_temp.assert_true(
  not has_table_privilege('anon','public.ap_staging_rehearsal_authorizations','SELECT')
  and not has_table_privilege('authenticated','public.ap_checkout_initiations','SELECT')
  and not has_table_privilege('service_role','public.ap_checkout_initiations','UPDATE')
  and not has_function_privilege('service_role',
    'public.ap_begin_invited_search_checkout(uuid,text,uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)','EXECUTE')
  and not has_function_privilege('service_role',
    'public.ap_begin_material_checkout(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text,text,boolean,boolean,boolean)','EXECUTE')
  and not has_function_privilege('service_role','public.ap_reopen_provisional_search_checkout(uuid)','EXECUTE'),
  'browser access, direct writes, or pre-085 provider initiation bypass is exposed');
select public.ap_set_checkout_mode('LOCKED',repeat('a',40),'14000000-0000-4000-8000-000000000003',
  'fixture-lock-checkout-mode-transition');
select pg_temp.assert_true((select mode='LOCKED' and generation=(select generation+2 from rehearsal_initial_mode) from public.ap_checkout_mode_configuration),
  'authoritative checkout mode did not return through locked');
select 'STAGING_REHEARSAL_CHECKOUT_ATTEMPTS_OK';
rollback to savepoint before_rehearsal_checkout_attempts;
