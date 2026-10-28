-- Retained owner work may be leased by the real global outbox scheduler below,
-- but it is never dispatched. The rollback must restore its exact prior state.
create temporary table notice_serial_prior_rows as
 select 'jobs'::text kind,to_jsonb(j) body from public.ap_material_draft_jobs j
 union all select 'versions',to_jsonb(v) from public.ap_material_draft_versions v
 union all select 'attempts',to_jsonb(a) from public.ap_material_draft_attempts a
 union all select 'reconciliations',to_jsonb(r) from public.ap_material_draft_reconciliations r
 union all select 'outbox',to_jsonb(o) from public.ap_outbox_messages o
 union all select 'notices',to_jsonb(n) from public.ap_material_draft_owner_notices n;
begin;
\ir owner-draft-notices-fixture.sql
select owner_notice_fixture.assert_true(public.ap_owner_draft_notices_schema_installed(),'106 notice schema is incomplete');
select owner_notice_fixture.assert_true('SUPPRESSED'::public.ap_outbox_state::text='SUPPRESSED','new state must be usable after migration commit');
select owner_notice_fixture.assert_true(not has_function_privilege('authenticated','public.ap_prepare_owner_draft_notification(uuid,text,text)','execute') and not has_table_privilege('service_role','public.ap_material_draft_owner_notices','update'),'notice authority became client writable');
select owner_notice_fixture.seed('a106');
select owner_notice_fixture.seed('b106');
create temporary table notice_serial_jobs as select job_id from owner_notice_fixture.state where namespace in('a106','b106');
select owner_notice_fixture.assert_true((select count(*)=2 from public.ap_material_draft_owner_notices where job_id in(select job_id from notice_serial_jobs)),'validated model results did not atomically create one notice each');
select owner_notice_fixture.assert_true((select count(*)=2 from public.ap_scheduled_jobs s join public.ap_material_draft_owner_notices n on n.message_id=s.reference_id where s.job_kind='OUTBOX_SEND' and n.job_id in(select job_id from notice_serial_jobs)),'notice scheduling is not atomic');
select public.ap_enqueue_owner_draft_notice(job_id) from notice_serial_jobs;
select owner_notice_fixture.assert_true((select count(*)=2 from public.ap_material_draft_owner_notices where job_id in(select job_id from notice_serial_jobs)),'repeat readiness duplicated notices');
update public.ap_commerce_configuration set provider_idempotent_email_approved=true,provider_email_approval_reference='fictional owner notice SQL test' where singleton;
select count(*) from public.ap_claim_outbox_messages('notice-worker',25);
-- Preparing pins the recipient, but without an envelope no provider dispatch is authorized.
select public.ap_prepare_owner_draft_notification(message_id,'notice-worker','old-owner@example.invalid') from public.ap_material_draft_owner_notices where job_id=(select job_id from owner_notice_fixture.state where namespace='b106');
create temporary table notice_originals as select n.*,m.provider_idempotency_key,m.first_submitted_at,m.provider_idempotency_expires_at from public.ap_material_draft_owner_notices n join public.ap_outbox_messages m on m.id=n.message_id where n.job_id in(select job_id from notice_serial_jobs);
do $$ declare n public.ap_material_draft_owner_notices; response jsonb; begin
 select * into n from public.ap_material_draft_owner_notices where job_id=(select job_id from owner_notice_fixture.state where namespace='a106');
 perform owner_notice_fixture.reject(format('select public.ap_prepare_owner_draft_notification(%L,%L,%L)',n.message_id,'wrong-worker','owner@example.invalid'),'owner_notice_lease_invalid');
 perform owner_notice_fixture.reject(format('select public.ap_prepare_owner_draft_notification(%L,%L,%L)',n.message_id,'notice-worker','owner@example.invalid,other@example.invalid'),'owner_notice_recipient_invalid');
 response:=public.ap_prepare_owner_draft_notification(n.message_id,'notice-worker','owner@example.invalid');
 perform owner_notice_fixture.assert_true(response->>'disposition'='SEND' and response->>'phase'='SOURCE_READY' and response->>'jobId'=n.job_id::text and response->>'draftVersionId'=n.draft_version_id::text,'strict source notice identity missing');
 perform public.ap_pin_owner_draft_delivery(n.message_id,'notice-worker','owner@example.invalid',repeat('a1',32));
 perform public.ap_pin_owner_draft_delivery(n.message_id,'notice-worker','owner@example.invalid',repeat('a1',32));
 perform owner_notice_fixture.reject(format('select public.ap_pin_owner_draft_delivery(%L,%L,%L,%L)',n.message_id,'notice-worker','changed@example.invalid',repeat('a1',32)),'owner_notice_recipient_changed');
 perform owner_notice_fixture.reject(format('select public.ap_pin_owner_draft_delivery(%L,%L,%L,%L)',n.message_id,'notice-worker','owner@example.invalid',repeat('a2',32)),'owner_notice_envelope_changed');
 perform public.ap_fail_outbox_message(n.message_id,'notice-worker','FICTIONAL_UNKNOWN_OUTCOME',clock_timestamp(),false);
end $$;
-- A lost provider response retains the exact key, recipient, body and first window.
select count(*) from public.ap_claim_outbox_messages('notice-retry',25);
select owner_notice_fixture.to_review('a106');
select owner_notice_fixture.to_review('b106');
select owner_notice_fixture.assert_true((select count(*)=4 from public.ap_material_draft_owner_notices where job_id in(select job_id from notice_serial_jobs)),'registered pairs did not create exact REVIEW_READY events');
do $$ declare n public.ap_material_draft_owner_notices; response jsonb; begin
 select * into n from public.ap_material_draft_owner_notices where job_id=(select job_id from owner_notice_fixture.state where namespace='a106') and phase='SOURCE_READY';
 response:=public.ap_prepare_owner_draft_notification(n.message_id,'notice-retry','owner@example.invalid');
 perform owner_notice_fixture.assert_true(response->>'disposition'='SEND' and response->>'phase'='SOURCE_READY','pinned unknown outcome was reclassified as a new action');
 perform owner_notice_fixture.reject(format('select public.ap_suppress_owner_draft_notification(%L,%L)',n.message_id,'notice-retry'),'owner_notice_outcome_unconfirmed');
 perform public.ap_complete_outbox_message(n.message_id,'notice-retry','fictional-provider-accepted-a106');
 select * into n from public.ap_material_draft_owner_notices where job_id=(select job_id from owner_notice_fixture.state where namespace='b106') and phase='SOURCE_READY';
 response:=public.ap_prepare_owner_draft_notification(n.message_id,'notice-worker','owner@example.invalid');
 perform owner_notice_fixture.assert_true(response->>'disposition'='OBSOLETE' and response->>'reason'='PHASE_COMPLETED','unsubmitted obsolete phase should not send');
 response:=public.ap_suppress_owner_draft_notification(n.message_id,'notice-worker');
 perform owner_notice_fixture.assert_true(response->>'disposition'='SUPPRESSED' and response->>'reason'='PHASE_COMPLETED','suppression receipt is not truthful');
 perform owner_notice_fixture.assert_true((select state::text='SUPPRESSED' and provider_message_id is null and reconciliation_state='NOT_REQUIRED' and lease_owner is null and next_attempt_at is null from public.ap_outbox_messages where id=n.message_id),'suppression was recorded as provider acceptance');
 perform owner_notice_fixture.reject(format('update public.ap_outbox_messages set state=''SENT'',provider_message_id=''fabricated'' where id=%L',n.message_id),'owner_notice_identity_immutable');
end $$;
select owner_notice_fixture.assert_true(not exists(select 1 from notice_originals n join public.ap_outbox_messages m on m.id=n.message_id where row(m.provider_idempotency_key,m.first_submitted_at,m.provider_idempotency_expires_at) is distinct from row(n.provider_idempotency_key,n.first_submitted_at,n.provider_idempotency_expires_at)),'retry or suppression renewed the original provider window');
select count(*) from public.ap_claim_outbox_messages('review-worker',25);
do $$ declare n public.ap_material_draft_owner_notices; begin
 select * into n from public.ap_material_draft_owner_notices where job_id=(select job_id from owner_notice_fixture.state where namespace='a106') and phase='REVIEW_READY';
 perform owner_notice_fixture.reject(format('select public.ap_complete_outbox_message(%L,%L,%L)',n.message_id,'review-worker','fake-before-pin'),'owner_notice_provider_acceptance_required');
 perform public.ap_pin_owner_draft_delivery(n.message_id,'review-worker','owner@example.invalid',repeat('b1',32));
 perform public.ap_complete_outbox_message(n.message_id,'review-worker','fictional-provider-accepted-review');
 perform owner_notice_fixture.assert_true((select state='SENT' and provider_message_id='fictional-provider-accepted-review' and reconciliation_state='RECONCILED' from public.ap_outbox_messages where id=n.message_id),'accepted review notice was not reconciled');
end $$;
-- Restore, archive, retention and lease checks remain active for historical notices.
savepoint before_notice_fences;
update public.ap_retention_restore_lock set locked=true;
select owner_notice_fixture.reject(format('select public.ap_prepare_owner_draft_notification(%L,%L,%L)',message_id,'review-worker','owner@example.invalid'),'retention_restore_locked') from public.ap_material_draft_owner_notices where job_id=(select job_id from owner_notice_fixture.state where namespace='b106') and phase='REVIEW_READY';
rollback to before_notice_fences;
update public.ap_archive_lifecycle_configuration set enabled=true where singleton;
select public.ap_begin_archive_retention('a106f001-0000-4000-8000-000000000001',repeat('a',40));
select owner_notice_fixture.reject(format('select public.ap_prepare_owner_draft_notification(%L,%L,%L)',message_id,'review-worker','owner@example.invalid'),'archive_maintenance_retry_required') from public.ap_material_draft_owner_notices where job_id=(select job_id from owner_notice_fixture.state where namespace='b106') and phase='REVIEW_READY';
rollback to before_notice_fences;
insert into public.ap_service_retention_claims(customer_id,order_ids) select customer_id,array[(select delivered_order_id from public.ap_material_lines where id=s.line_id)] from owner_notice_fixture.state s where namespace='b106';
select owner_notice_fixture.reject(format('select public.ap_prepare_owner_draft_notification(%L,%L,%L)',message_id,'review-worker','owner@example.invalid'),'owner_notice_content_unavailable') from public.ap_material_draft_owner_notices where job_id=(select job_id from owner_notice_fixture.state where namespace='b106') and phase='REVIEW_READY';
rollback to before_notice_fences;
update public.ap_outbox_messages set lease_expires_at=clock_timestamp()-interval '1 second' where id in(select message_id from public.ap_material_draft_owner_notices where job_id=(select job_id from owner_notice_fixture.state where namespace='b106') and phase='REVIEW_READY');
select owner_notice_fixture.reject(format('select public.ap_prepare_owner_draft_notification(%L,%L,%L)',message_id,'review-worker','owner@example.invalid'),'owner_notice_lease_invalid') from public.ap_material_draft_owner_notices where job_id=(select job_id from owner_notice_fixture.state where namespace='b106') and phase='REVIEW_READY';
rollback to before_notice_fences;
-- Selected references require the actual three-member set and its exact digest.
select owner_notice_fixture.seed('c106',true);
select owner_notice_fixture.to_review('c106');
select owner_notice_fixture.assert_true((select count(*)=3 from public.ap_material_draft_members where draft_version_id=(select version_id from owner_notice_fixture.state where namespace='c106')),'selected reference member was omitted');
select owner_notice_fixture.assert_true((select n.phase='REVIEW_READY' and n.member_set_sha256=v.member_set_sha256 and public.ap_owner_draft_ready_phase(s.job_id)='REVIEW_READY' from owner_notice_fixture.state s join public.ap_material_draft_versions v on v.id=s.version_id join public.ap_material_draft_owner_notices n on n.draft_version_id=v.id and n.phase='REVIEW_READY' where s.namespace='c106'),'reference notice lost the exact registered member binding');
savepoint before_expired_notice;
update public.ap_outbox_messages set state='SENDING',lease_owner='expired-window-worker',lease_expires_at=clock_timestamp()+interval '1 minute',attempts=1,first_submitted_at=clock_timestamp()-interval '25 hours',provider_idempotency_expires_at=clock_timestamp()-interval '1 hour'
 where id in(select n.message_id from public.ap_material_draft_owner_notices n join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='c106' and n.phase='REVIEW_READY');
do $$ declare message uuid; begin
 select n.message_id into message from public.ap_material_draft_owner_notices n join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='c106' and n.phase='REVIEW_READY';
 perform owner_notice_fixture.reject(format('select public.ap_prepare_owner_draft_notification(%L,%L,%L)',message,'expired-window-worker','owner@example.invalid'),'owner_notice_lease_invalid');
 perform public.ap_fail_outbox_message(message,'expired-window-worker','PROVIDER_WINDOW_EXPIRED',clock_timestamp(),false);
 perform owner_notice_fixture.assert_true((select state='DEAD_LETTER' and reconciliation_state='FAILED' and first_submitted_at<clock_timestamp()-interval '24 hours' from public.ap_outbox_messages where id=message),'expired unknown outcome received a fresh retry window');
end $$;
rollback to before_expired_notice;
-- A real owner-created successor must not emit another automatic source event.
do $$ declare s owner_notice_fixture.state; payload uuid; replacement uuid; begin
 select * into s from owner_notice_fixture.state where namespace='c106';
 select id into payload from public.ap_sensitive_payloads where customer_id=s.customer_id and content_sha256=repeat('4',64);
 replacement:=public.ap_revise_material_draft_source(s.version_id,repeat('2',64),payload,repeat('4',64),s.operator_id);
 perform owner_notice_fixture.assert_true(replacement<>s.version_id and not exists(select 1 from public.ap_material_draft_owner_notices where draft_version_id=replacement),'owner revision created a redundant source-ready notification');
 perform owner_notice_fixture.reject(format('select public.ap_prepare_owner_draft_notification(%L,%L,%L)',gen_random_uuid(),'review-worker','owner@example.invalid'),'owner_notice_unavailable');
end $$;
select owner_notice_fixture.assert_true(not exists(select 1 from owner_notice_fixture.state s join public.ap_material_lines l on l.id=s.line_id where l.materials_due_at is distinct from s.deadline),'notice processing changed the paid deadline');
select owner_notice_fixture.assert_true(not exists(select 1 from public.ap_material_draft_versions v join owner_notice_fixture.state s on s.job_id=v.job_id where v.approved_at is not null),'notice invented owner approval');
-- This independent prospective family is originally INSERTed near its fixed
-- 720-hour search-access expiry. No historical timestamp or deadline is edited.
-- Provider refund/email receipts below are explicitly fictional SQL inputs.
select owner_notice_fixture.seed('d107',false,true);
select owner_notice_fixture.assert_true((select
 d.created_at<=snap.finalized_at and snap.finalized_at<=legal.accepted_at
 and legal.accepted_at=content.accepted_at and content.accepted_at<=checkout.created_at
 and checkout.created_at<=search_payment.payment_verified_at and o.paid_at=search_payment.payment_verified_at
 and o.amount_cents=search_payment.amount_cents and o.delivery_deadline=o.paid_at+interval '24 hours'
 and o.paid_at<=release.committed_at and release.committed_at<=o.delivery_deadline
 and release.active_due_at=o.delivery_deadline and release.committed_at<=line.selection_confirmed_at
 and pack_checkout.created_at<=pack_payment.payment_verified_at
 and pack_payment.payment_verified_at=pack_checkout.completed_at and purchase.completed_at=pack_checkout.completed_at
 and pack_checkout.completed_at<=line.materials_started_at
 and line.materials_due_at=line.materials_started_at+interval '24 hours'
from owner_notice_fixture.state s
join public.ap_material_lines line on line.id=s.line_id
join public.ap_material_purchases purchase on purchase.id=line.purchase_id
join public.ap_material_checkout_intents pack_checkout on pack_checkout.id=purchase.checkout_intent_id
join public.ap_payment_attempts pack_payment on pack_payment.id=line.payment_attempt_id
join public.orders o on o.id=line.delivered_order_id
join public.ap_releases release on release.id=pack_checkout.delivered_release_id
join public.ap_search_services service on service.legacy_order_id=o.id
join public.ap_payment_attempts search_payment on search_payment.id=service.winning_payment_attempt_id
join public.ap_checkout_attempts checkout on checkout.id=search_payment.checkout_attempt_id
join public.ap_intake_snapshots snap on snap.id=service.original_snapshot_id
join public.ap_anonymous_drafts d on d.id=snap.draft_id
join public.ap_snapshot_legal_acceptances legal on legal.snapshot_id=snap.id
join public.ap_snapshot_legal_content_receipts content on content.legal_acceptance_id=legal.id
where s.namespace='d107'),
 'historical retention fixture has an impossible consent, payment, delivery or pack chronology');
select count(*) from public.ap_claim_outbox_messages('retention-notice-worker',25);
do $$ declare s owner_notice_fixture.state; message uuid; refund uuid; payment public.ap_payment_attempts; begin
 select * into s from owner_notice_fixture.state where namespace='d107';
 select message_id into message from public.ap_material_draft_owner_notices where job_id=s.job_id;
 perform public.ap_prepare_owner_draft_notification(message,'retention-notice-worker','retention-owner@example.invalid');
 perform owner_notice_fixture.assert_true(public.ap_retention_cleanup_blocked(s.customer_id),'unfinished paid obligation must still prevent cleanup');
 refund:=public.ap_start_material_line_refund(s.line_id,s.customer_id,'FICTIONAL_NOTICE_RETENTION_TEST',false);
 select p.* into payment from public.ap_payment_attempts p join public.ap_material_lines l on l.payment_attempt_id=p.id where l.id=s.line_id;
 perform public.ap_record_search_refund_result_verified(refund,'re_fictional_notice_retention','succeeded',payment.provider_payment_id,799,'USD',refund,'evt_fictional_notice_retention',null,repeat('d7',32),clock_timestamp(),'refund.updated');
 perform owner_notice_fixture.assert_true(public.ap_prepare_owner_draft_notification(message,'retention-notice-worker','different-configured-owner@example.invalid')->>'reason'='OBLIGATION_INACTIVE','canceled unpinned notice did not become obsolete');
 perform public.ap_suppress_owner_draft_notification(message,'retention-notice-worker');
end $$;
select count(*) from public.ap_claim_outbox_messages('retention-refund-worker',25);
select public.ap_complete_outbox_message(m.id,'retention-refund-worker','fictional-refund-email-'||m.id::text) from public.ap_outbox_messages m join owner_notice_fixture.state s on s.customer_id=m.customer_id where s.namespace='d107' and m.message_kind in('REFUND_INITIATED','REFUND_COMPLETED');
do $$ declare expires_at timestamptz; wait_seconds double precision; begin
 select d.family_expires_at into expires_at from owner_notice_fixture.state s join public.ap_material_lines l on l.id=s.line_id cross join lateral public.ap_service_retention_deadlines(l.delivered_order_id) d where s.namespace='d107';
 wait_seconds:=greatest(0,extract(epoch from expires_at-clock_timestamp())+0.05);
 perform owner_notice_fixture.assert_true(expires_at is not null and wait_seconds<=25,'fictional fixed-expiry wait must remain bounded');
 perform pg_sleep(wait_seconds);
end $$;
select owner_notice_fixture.assert_true(not public.ap_retention_cleanup_blocked(customer_id),'valid terminal suppression incorrectly blocks completed family cleanup') from owner_notice_fixture.state where namespace='d107';
create temporary table notice_retention_financial as select jsonb_build_object('payment',to_jsonb(p),'purchase',to_jsonb(pu),'refund',to_jsonb(r),'deadline',l.materials_due_at) body from owner_notice_fixture.state s join public.ap_material_lines l on l.id=s.line_id join public.ap_material_purchases pu on pu.id=l.purchase_id join public.ap_payment_attempts p on p.id=l.payment_attempt_id join public.ap_refund_operations r on r.material_line_id=l.id where s.namespace='d107';
savepoint before_notice_purge;
select owner_notice_fixture.assert_true(jsonb_array_length(public.ap_claim_expired_service_retention(5))=1,'expired completed notice family was not claimed');
select owner_notice_fixture.assert_true(not exists(select 1 from public.ap_service_retention_objects o join public.ap_service_retention_claims c on c.id=o.claim_id join owner_notice_fixture.state s on s.customer_id=c.customer_id where s.namespace='d107'),'text-only fictional graph unexpectedly requires external byte deletion');
select owner_notice_fixture.assert_true(public.ap_finish_service_retention_claim(c.id),'actual notice-family redaction failed') from public.ap_service_retention_claims c join owner_notice_fixture.state s on s.customer_id=c.customer_id where s.namespace='d107';
select owner_notice_fixture.assert_true(n.recipient_email is null and n.suppressed_at is not null and m.state::text='SUPPRESSED' and m.provider_message_id is null and exists(select 1 from public.ap_retention_row_receipts r where r.table_name='ap_material_draft_owner_notices' and r.row_id=n.message_id::text),'actual redactor did not remove recipient while preserving suppression evidence') from public.ap_material_draft_owner_notices n join public.ap_outbox_messages m on m.id=n.message_id join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='d107';
select owner_notice_fixture.assert_true((select body from notice_retention_financial)=jsonb_build_object('payment',to_jsonb(p),'purchase',to_jsonb(pu),'refund',to_jsonb(r),'deadline',l.materials_due_at),'notice redaction altered financial history or paid deadline') from owner_notice_fixture.state s join public.ap_material_lines l on l.id=s.line_id join public.ap_material_purchases pu on pu.id=l.purchase_id join public.ap_payment_attempts p on p.id=l.payment_attempt_id join public.ap_refund_operations r on r.material_line_id=l.id where s.namespace='d107';
select owner_notice_fixture.reject(format('update public.ap_material_draft_owner_notices set recipient_email=%L where message_id=%L','resurrected@example.invalid',n.message_id),'owner_notice_lease_invalid') from public.ap_material_draft_owner_notices n join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='d107';
-- Restore the pre-purge fictional rows, then apply the actual expiry overlay.
rollback to before_notice_purge;
do $$ declare overlay jsonb; receipt jsonb; begin
 overlay:=public.ap_export_service_retention_overlay();
 receipt:=public.ap_apply_retention_restore_overlay(overlay::text,encode(extensions.digest(overlay::text,'sha256'),'hex'));
 perform owner_notice_fixture.assert_true((receipt->>'ordersSanitized')::integer=1,'restore overlay failed to sanitize the expired notice family');
end $$;
select owner_notice_fixture.assert_true(n.recipient_email is null and n.suppression_reason='OBLIGATION_INACTIVE' and exists(select 1 from public.ap_retention_restore_lock where singleton and locked),'restore resurrected an owner recipient or unlocked the service') from public.ap_material_draft_owner_notices n join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='d107';
select owner_notice_fixture.assert_true((select body from notice_retention_financial)=jsonb_build_object('payment',to_jsonb(p),'purchase',to_jsonb(pu),'refund',to_jsonb(r),'deadline',l.materials_due_at),'restore sanitation altered financial history or paid deadline') from owner_notice_fixture.state s join public.ap_material_lines l on l.id=s.line_id join public.ap_material_purchases pu on pu.id=l.purchase_id join public.ap_payment_attempts p on p.id=l.payment_attempt_id join public.ap_refund_operations r on r.material_line_id=l.id where s.namespace='d107';
set constraints all immediate;
rollback;
do $$ begin
 if exists(select * from notice_serial_prior_rows except all
  (select 'jobs'::text,to_jsonb(j) from public.ap_material_draft_jobs j
   union all select 'versions',to_jsonb(v) from public.ap_material_draft_versions v
   union all select 'attempts',to_jsonb(a) from public.ap_material_draft_attempts a
   union all select 'reconciliations',to_jsonb(r) from public.ap_material_draft_reconciliations r
   union all select 'outbox',to_jsonb(o) from public.ap_outbox_messages o
   union all select 'notices',to_jsonb(n) from public.ap_material_draft_owner_notices n))
 then raise exception 'serial fixture changed retained owner work'; end if;
end $$;
drop table notice_serial_prior_rows;
select 'OWNER_DRAFT_READY_NOTICES_CONTRACT_OK';
