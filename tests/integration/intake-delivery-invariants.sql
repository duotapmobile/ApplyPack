begin;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('13000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delivery-owner@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('13000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delivery-admin@example.invalid', '', now(), '{}', '{}', now(), now());
update public.profiles set role = 'admin' where id = '13000000-0000-0000-0000-000000000002';

insert into public.intake_drafts(id, customer_id, email, current_step, answers, resume_document)
values (
  '23000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000001',
  'delivery-owner@example.invalid',
  6,
  '{"criteriaApproved":true}',
  '{"path":"13000000-0000-0000-0000-000000000001/drafts/23000000-0000-0000-0000-000000000001/resume.pdf"}'
);

do $$
declare
  result text;
begin
  result := public.create_completed_intake(
    '23000000-0000-0000-0000-000000000002',
    '13000000-0000-0000-0000-000000000001',
    'delivery-owner@example.invalid',
    'Delivery Owner',
    jsonb_build_object(
      'direction', 'Operations',
      'priorities', jsonb_build_array('Full-time'),
      'dealbreakers', 'No sales',
      'location_preference', 'Remote US',
      'schedule_preference', 'Weekdays',
      'minimum_salary', '$55,000',
      'cover_letter_path', '',
      'experience_summary', 'Customer-confirmed operations experience.',
      'notes', '',
      'resume_path', '13000000-0000-0000-0000-000000000001/drafts/23000000-0000-0000-0000-000000000001/resume.pdf',
      'source_retention_due_at', (now() + interval '30 days')::text
    ),
    '{"criteriaApproved":true,"neverInclude":["Sales"]}',
    jsonb_build_array(jsonb_build_object(
      'document_kind', 'resume',
      'storage_path', '13000000-0000-0000-0000-000000000001/drafts/23000000-0000-0000-0000-000000000001/resume.pdf',
      'size_bytes', 512,
      'claimed_mime_type', 'application/pdf',
      'verified_mime_type', 'application/pdf',
      'sha256', repeat('b', 64),
      'scan_status', 'clean',
      'scan_provider', 'document_validation',
      'scan_provider_reference', 'document_validation:structure',
      'scan_error_code', '',
      'scan_attempts', 1,
      'scanned_at', now()::text
    )),
    '23000000-0000-0000-0000-000000000001'
  );
  if result <> 'clean' then raise exception 'atomic intake did not return clean status'; end if;
  if (select status from public.intakes where id = '23000000-0000-0000-0000-000000000002') <> 'ready_for_payment' then
    raise exception 'atomic intake did not reach ready_for_payment';
  end if;
  if exists(select 1 from public.intake_drafts where id = '23000000-0000-0000-0000-000000000001') then
    raise exception 'completed intake draft was not removed atomically';
  end if;
  if (select count(*) from public.source_documents where intake_id = '23000000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'source document record was not created atomically';
  end if;
end;
$$;

insert into public.orders(id, customer_id, intake_id, product_kind, amount_cents, status, paid_at, delivered_at)
values (
  '33000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000002',
  'job_search',
  2000,
  'delivered',
  now() - interval '1 hour',
  now()
);
insert into public.jobs(id, company, title, source_url, checked_at, listing_status, review_status)
values (
  '43000000-0000-0000-0000-000000000001',
  'Example Employer',
  'Operations Coordinator',
  'https://example.invalid/jobs/operations',
  now(),
  'open',
  'approved'
);
insert into public.job_matches(id, search_order_id, job_id, position, fit_summary, delivered_at)
values (
  '53000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000001',
  '43000000-0000-0000-0000-000000000001',
  1,
  'Synthetic reviewed match for transaction testing.',
  now()
);
insert into public.orders(
  id, customer_id, parent_order_id, product_kind, amount_cents, status,
  paid_at, processing_previous_status, processing_started_at
) values (
  '33000000-0000-0000-0000-000000000002',
  '13000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000001',
  'apply_pack',
  800,
  'delivery_processing',
  now(),
  'paid',
  now()
);
insert into public.apply_pack_items(id, order_id, job_match_id, status, delivery_claimed_at)
values (
  '63000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000002',
  '53000000-0000-0000-0000-000000000001',
  'delivery_processing',
  now()
);

do $$
declare
  completed boolean;
  correction_id uuid := '73000000-0000-0000-0000-000000000001';
begin
  completed := public.complete_apply_pack_item_delivery(
    '63000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000002',
    'owner/orders/pack/resume-v1.docx',
    'owner/orders/pack/resume-v1.pdf',
    'owner/orders/pack/cover-v1.docx',
    'owner/orders/pack/cover-v1.pdf',
    '{
      "factsVerified":true,
      "jobTargetConfirmed":true,
      "noInventedClaims":true,
      "resumeReviewed":true,
      "coverLetterReviewed":true,
      "humanReleaseApproved":true,
      "reviewerNote":"Verified both files against the confirmed customer facts."
    }',
    now()
  );
  if not completed then raise exception 'initial Apply Pack delivery failed'; end if;
  if (select count(*) from public.apply_pack_delivery_revisions where apply_pack_item_id = '63000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'initial delivery revision was not recorded';
  end if;
  if exists(select 1 from public.apply_pack_delivery_revisions where apply_pack_item_id = '63000000-0000-0000-0000-000000000001' and (resume_pdf_path is null or cover_letter_pdf_path is null)) then
    raise exception 'initial delivery PDF paths were not recorded';
  end if;

  insert into public.correction_requests(id, apply_pack_item_id, customer_id, correction_text)
  values (
    correction_id,
    '63000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000001',
    'Correct the customer-provided employment date.'
  );
  completed := public.complete_correction_delivery(
    correction_id,
    '13000000-0000-0000-0000-000000000002',
    'owner/orders/pack/corrections/resume-v2.docx',
    'owner/orders/pack/corrections/resume-v2.pdf',
    'owner/orders/pack/corrections/cover-v2.docx',
    'owner/orders/pack/corrections/cover-v2.pdf',
    'Verified the corrected date against the original intake.',
    now()
  );
  if not completed then raise exception 'correction delivery failed'; end if;
  if (select count(*) from public.apply_pack_delivery_revisions where apply_pack_item_id = '63000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'correction did not preserve both delivery revisions';
  end if;
  if (select version from public.apply_pack_delivery_revisions where correction_request_id = correction_id) <> 2 then
    raise exception 'correction revision number is wrong';
  end if;
  if (select status from public.correction_requests where id = correction_id) <> 'resolved' then
    raise exception 'correction request did not resolve atomically';
  end if;
  if exists(select 1 from public.apply_pack_delivery_revisions where apply_pack_item_id = '63000000-0000-0000-0000-000000000001' and (resume_pdf_path is null or cover_letter_pdf_path is null)) then
    raise exception 'corrected delivery PDF paths were not recorded';
  end if;
end;
$$;

rollback;
