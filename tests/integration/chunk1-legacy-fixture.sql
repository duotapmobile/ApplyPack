begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('a0000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','legacy@example.invalid','',now(),'{}','{}',now(),now());
insert into public.intakes(id,customer_id,email,direction,dealbreakers,location_preference,schedule_preference,experience_summary,resume_path,status,source_scan_status)
values ('a1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','legacy@example.invalid','Operations','None','Remote','Weekdays','Confirmed','legacy/resume.pdf','paid','clean');
insert into public.orders(id,customer_id,intake_id,product_kind,amount_cents,status,stripe_checkout_session_id,stripe_payment_intent_id,paid_at)
values ('a2000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','job_search',2000,'paid','cs_legacy_chunk1','pi_legacy_chunk1',now());
insert into public.payments(id,order_id,provider,provider_checkout_id,provider_payment_id,amount_cents,status)
values ('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','stripe','cs_legacy_chunk1','pi_legacy_chunk1',2000,'paid');
commit;
