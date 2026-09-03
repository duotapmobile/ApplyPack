begin;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-one@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('11000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@example.invalid', '', now(), '{}', '{}', now(), now());

update public.profiles set role = 'admin' where id = '11000000-0000-0000-0000-000000000002';

insert into public.intakes(
  id, customer_id, email, direction, dealbreakers, location_preference,
  schedule_preference, experience_summary, resume_path, status, source_scan_status
) values
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'owner-one@example.invalid', 'Operations', 'Sales', 'Remote US', 'Weekdays', 'Confirmed experience one.', 'one/resume.pdf', 'ready_for_payment', 'clean'),
  ('21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', 'admin@example.invalid', 'Support', 'Commission', 'Remote US', 'Weekdays', 'Confirmed experience two.', 'two/resume.pdf', 'ready_for_payment', 'clean');

select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
do $$
begin
  if public.is_admin() then raise exception 'customer was treated as admin'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'customer profile isolation failed'; end if;
  if (select count(*) from public.intakes) <> 1 then raise exception 'customer intake isolation failed'; end if;
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
do $$
begin
  if public.is_admin() then raise exception 'AAL1 admin bypassed MFA'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'AAL1 admin saw privileged rows'; end if;
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
do $$
begin
  if not public.is_admin() then raise exception 'AAL2 admin was not recognized'; end if;
  if (select count(*) from public.profiles) <> 2 then raise exception 'AAL2 admin could not inspect profiles'; end if;
end;
$$;
reset role;

insert into public.orders(id, customer_id, intake_id, product_kind, amount_cents, status, paid_at)
values
  ('31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'job_search', 2000, 'paid', now()),
  ('31000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', null, 'job_search', 2000, 'paid', now());

insert into public.payments(order_id, provider, provider_checkout_id, provider_payment_id, amount_cents, status)
values
  ('31000000-0000-0000-0000-000000000001', 'stripe', 'cs_test_refund_one', 'pi_test_refund_one', 2000, 'paid'),
  ('31000000-0000-0000-0000-000000000002', 'stripe', 'cs_test_delivery_two', 'pi_test_delivery_two', 2000, 'paid');

do $$
declare
  refund_row record;
begin
  select * into refund_row from public.begin_order_refund(
    '31000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000002',
    'duplicate_or_incorrect_charge',
    'Duplicate charge confirmed by the operator.'
  );
  if refund_row.refund_id is null then raise exception 'refund was not created'; end if;
  if public.claim_order_delivery('31000000-0000-0000-0000-000000000001', 'job_search') then
    raise exception 'refund-pending order was claimed for delivery';
  end if;
  perform public.finalize_order_refund(refund_row.refund_id, 're_test_one', 'succeeded', null);
  if (select status from public.orders where id = '31000000-0000-0000-0000-000000000001') <> 'refunded' then
    raise exception 'successful refund did not finalize order';
  end if;
  if (select status from public.payments where order_id = '31000000-0000-0000-0000-000000000001') <> 'refunded' then
    raise exception 'successful refund did not finalize payment';
  end if;

  if not public.claim_order_delivery('31000000-0000-0000-0000-000000000002', 'job_search') then
    raise exception 'paid order could not be claimed for delivery';
  end if;
  begin
    perform public.begin_order_refund(
      '31000000-0000-0000-0000-000000000002',
      '11000000-0000-0000-0000-000000000002',
      'duplicate_or_incorrect_charge',
      'Duplicate charge confirmed by the operator.'
    );
    raise exception 'delivery-processing order was accepted for refund';
  exception
    when others then
      if sqlerrm = 'delivery-processing order was accepted for refund' then raise; end if;
  end;
end;
$$;

insert into public.source_documents(
  id, intake_id, customer_id, document_kind, storage_path, size_bytes,
  claimed_mime_type, verified_mime_type, sha256, scan_status
) values (
  '41000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'resume',
  'one/pending-resume.pdf',
  128,
  'application/pdf',
  'application/pdf',
  repeat('a', 64),
  'pending'
);

do $$
declare
  claimed integer;
begin
  select count(*) into claimed from public.claim_source_document_scans(5);
  if claimed <> 1 then raise exception 'pending scan was not claimed exactly once'; end if;
  select count(*) into claimed from public.claim_source_document_scans(5);
  if claimed <> 0 then raise exception 'active scan claim was duplicated'; end if;
  update public.source_documents set scan_claimed_at = now() - interval '16 minutes'
    where id = '41000000-0000-0000-0000-000000000001';
  select count(*) into claimed from public.claim_source_document_scans(5);
  if claimed <> 1 then raise exception 'stale scan claim was not recovered'; end if;
  if (select scan_attempts from public.source_documents where id = '41000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'scan attempts were not counted atomically';
  end if;
end;
$$;

rollback;
