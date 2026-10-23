-- Executed only inside the runner's disposable rollback-only 085 -> 086 test.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('86ff0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'historical-activation@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='86ff0000-0000-4000-8000-000000000001';
insert into public.ap_manual_launch_activations(id,release_sha,health_evidence_reference,database_evidence_reference,
  payment_evidence_reference,email_evidence_reference,kms_evidence_reference,worker_evidence_reference,
  maintenance_evidence_reference,backup_restore_evidence_reference,inventory_evidence_reference,
  accessibility_evidence_reference,product_supervisor_reference,security_supervisor_reference,operations_supervisor_reference,
  tenth_man_supervisor_reference,accepted_p2_disposition_reference,unresolved_p0_count,unresolved_p1_count,
  canary_reconciliation_reference,canary_reconciled_amount_cents,worker_network_attestation_sha256,evidence_bundle_sha256,approved_by)
values('86ff0000-0000-4000-8000-000000000011',repeat('f',40),'historical-evidence','historical-evidence','historical-evidence',
  'historical-evidence','historical-evidence','historical-evidence','historical-evidence','historical-evidence',
  'historical-evidence','historical-evidence','historical-evidence','historical-evidence','historical-evidence',
  'historical-evidence','historical-evidence',0,0,'historical-refund-reconciliation',2698,repeat('f',64),repeat('e',64),
  '86ff0000-0000-4000-8000-000000000001');
insert into public.ap_payment_attempts(id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,payment_verified_at)
values('86ff0000-0000-4000-8000-000000000021','86ff0000-0000-4000-8000-000000000001','stripe','pi_Historical086',1899,'USD','PAID','NONE',clock_timestamp());
insert into public.ap_refund_operations(id,customer_id,payment_attempt_id,scope,amount_cents,currency,idempotency_key,state,required,reason_code)
values('86ff0000-0000-4000-8000-000000000031','86ff0000-0000-4000-8000-000000000001','86ff0000-0000-4000-8000-000000000021',
  'FULL_SEARCH',1899,'USD','historical-canary-086-refund','PENDING',true,'MANUAL_LAUNCH_CANARY');
create temporary table activation_before_086 as select to_jsonb(a) as value from public.ap_manual_launch_activations a
  where id='86ff0000-0000-4000-8000-000000000011';
create temporary table payment_before_086 as select to_jsonb(p) as value from public.ap_payment_attempts p
  where id='86ff0000-0000-4000-8000-000000000021';
create temporary table refund_before_086 as select to_jsonb(r) as value from public.ap_refund_operations r
  where id='86ff0000-0000-4000-8000-000000000031';
