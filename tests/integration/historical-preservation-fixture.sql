insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '12000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'historical@example.invalid', '', now(),
  '{}', '{}', now(), now()
);

insert into public.intakes(
  id, customer_id, email, direction, dealbreakers, location_preference,
  schedule_preference, experience_summary, resume_path, status,
  source_scan_status, criteria_approved_at, created_at, updated_at
) values (
  '22000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'historical@example.invalid',
  'Historical operations direction',
  'No sales',
  'Remote',
  'Weekdays',
  'Historical confirmed experience.',
  'historical/private-resume.pdf',
  'paid',
  'clean',
  now() - interval '10 days',
  now() - interval '10 days',
  now() - interval '10 days'
);

insert into public.orders(
  id, customer_id, intake_id, product_kind, amount_cents, status,
  stripe_checkout_session_id, stripe_payment_intent_id, paid_at, delivery_deadline,
  created_at, updated_at
) values (
  '32000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  '22000000-0000-0000-0000-000000000001',
  'job_search',
  2000,
  'paid',
  'cs_test_historical',
  'pi_test_historical',
  now() - interval '10 days',
  now() - interval '9 days',
  now() - interval '10 days',
  now() - interval '10 days'
);

insert into public.payments(
  id, order_id, provider, provider_checkout_id, provider_payment_id,
  amount_cents, status, created_at
) values (
  '42000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  'stripe',
  'cs_test_historical',
  'pi_test_historical',
  2000,
  'paid',
  now() - interval '10 days'
);

insert into public.jobs(
  id, company, title, source_url, location_text, salary_text,
  checked_at, listing_status, created_at
) values (
  '52000000-0000-0000-0000-000000000001',
  'Historical Acme Company',
  'Historical Operations Coordinator',
  'https://historical.example/jobs/operations',
  'Remote',
  '$55,000',
  now() - interval '10 days',
  'open',
  now() - interval '10 days'
);
