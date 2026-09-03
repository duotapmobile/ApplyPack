begin;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'checkout-test@example.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

update public.profiles set display_name = 'Checkout Test'
where id = '10000000-0000-0000-0000-000000000001';

insert into public.intakes(
  id, customer_id, email, direction, dealbreakers, location_preference,
  schedule_preference, experience_summary, resume_path, status, source_scan_status
) values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'checkout-test@example.invalid', 'Customer operations', '', 'Remote US',
  'Full-time', 'Customer-provided support experience.', 'test/resume.docx',
  'ready_for_payment', 'clean'
);

do $$
declare
  first_order uuid;
  second_order uuid;
  first_reservation uuid;
  second_reservation uuid;
  test_job uuid;
  test_match uuid;
  first_cart uuid;
  second_cart uuid;
  first_cart_reservation uuid;
  second_cart_reservation uuid;
begin
  select order_id, reservation_id into first_order, first_reservation
    from public.prepare_search_checkout(
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001'
    );
  select order_id, reservation_id into second_order, second_reservation
    from public.prepare_search_checkout(
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001'
    );
  if first_order is distinct from second_order or first_reservation is distinct from second_reservation then
    raise exception 'search checkout retry created duplicate state';
  end if;
  if (select count(*) from public.orders where intake_id = '20000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'search checkout order count was not one';
  end if;

  update public.orders set status = 'delivered', delivered_at = now() where id = first_order;
  insert into public.jobs(company, title, source_url, checked_at, review_status)
    values ('Example Employer', 'Support Coordinator', 'https://example.invalid/jobs/1', now(), 'approved')
    returning id into test_job;
  insert into public.job_matches(search_order_id, job_id, position, fit_summary)
    values (first_order, test_job, 1, 'Synthetic integration fixture only.')
    returning id into test_match;

  select cart_id, reservation_id into first_cart, first_cart_reservation
    from public.prepare_apply_pack_checkout(
      '10000000-0000-0000-0000-000000000001', first_order, array[test_match], '',
      jsonb_build_array(jsonb_build_object('jobMatchId', test_match, 'emphasisNotes', '', 'doNotMentionNotes', ''))
    );
  select cart_id, reservation_id into second_cart, second_cart_reservation
    from public.prepare_apply_pack_checkout(
      '10000000-0000-0000-0000-000000000001', first_order, array[test_match], '',
      jsonb_build_array(jsonb_build_object('jobMatchId', test_match, 'emphasisNotes', '', 'doNotMentionNotes', ''))
    );
  if first_cart is distinct from second_cart or first_cart_reservation is distinct from second_cart_reservation then
    raise exception 'Apply Pack checkout retry created duplicate state';
  end if;
  if (select count(*) from public.apply_pack_carts where customer_id = '10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'Apply Pack cart count was not one';
  end if;
  if (select count(*) from public.apply_pack_cart_items where cart_id = first_cart) <> 1 then
    raise exception 'Apply Pack cart item count was not one';
  end if;
end;
$$;

rollback;
