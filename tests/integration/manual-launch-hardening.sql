begin;

create function pg_temp.assert_true(value boolean, failure_message text)
returns void language plpgsql as $$
begin
  if value is not true then raise exception '%', failure_message; end if;
end;
$$;

select pg_temp.assert_true(
  (select search_price_cents=1899 and material_line_price_cents=799
    and pricing_version='manual-launch-pricing-2026-10-02-v2'
    and launch_product_scope='MANUAL_ONLY'
    and not sales_activation_approved and sales_activation_reference is null
    and not tax_configuration_approved and tax_approval_reference is null
    and launch_activation_id is null and launch_release_sha is null
    and document_worker_network_attestation_sha256 is null
    and not checkout_enabled
   from public.ap_commerce_configuration where singleton),
  'manual launch must migrate to current prices while remaining locked'
);

select pg_temp.assert_true(
  (select pg_get_constraintdef(oid) like '%1899%2000%'
   from pg_constraint where conrelid='public.ap_quotes'::regclass and conname='ap_quotes_price_cents_check'),
  'search quote constraint must preserve only current and historical prices'
);
select pg_temp.assert_true(
  (select pg_get_constraintdef(oid) like '%799%800%'
   from pg_constraint where conrelid='public.ap_material_lines'::regclass and conname='ap_material_lines_allocated_amount_cents_check'),
  'Apply Pack line constraint must preserve only current and historical prices'
);

select pg_temp.assert_true(
  (select relrowsecurity from pg_class where oid='public.ap_search_checkout_invitations'::regclass),
  'checkout invitations must have RLS enabled'
);
select pg_temp.assert_true(not has_table_privilege('anon','public.ap_search_checkout_invitations','select'), 'anonymous invitation access exposed');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ap_search_checkout_invitations','select'), 'customer invitation access exposed');
select pg_temp.assert_true(not has_function_privilege('anon','public.ap_issue_search_checkout_invitation(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text)','execute'), 'anonymous invitation issuance exposed');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.ap_begin_invited_search_checkout(uuid,text,uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)','execute'), 'customer invitation checkout exposed');
select pg_temp.assert_true(not has_function_privilege('service_role','public.ap_begin_search_checkout(uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)','execute'), 'service role can bypass invitation wrapper');
select pg_temp.assert_true(has_function_privilege('service_role','public.ap_begin_invited_search_checkout(uuid,text,uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)','execute'), 'service role cannot call invitation wrapper');
select pg_temp.assert_true(not has_function_privilege('service_role','public.ap_record_search_refund_result(uuid,text,text,text,text,text,timestamptz,text)','execute'), 'service role can bypass verified refund binding');
select pg_temp.assert_true(has_function_privilege('service_role','public.ap_record_search_refund_result_verified(uuid,text,text,text,integer,text,uuid,text,text,text,timestamptz,text)','execute'), 'verified refund binding unavailable');

select pg_temp.assert_true(
  (select relrowsecurity from pg_class where oid='public.ap_manual_launch_activations'::regclass)
  and has_table_privilege('service_role','public.ap_manual_launch_activations','select')
  and has_table_privilege('service_role','public.ap_manual_launch_activations','insert')
  and not has_table_privilege('service_role','public.ap_manual_launch_activations','update')
  and not has_table_privilege('service_role','public.ap_manual_launch_activations','delete'),
  'manual launch activation evidence must be immutable and private'
);

select pg_temp.assert_true(
  exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='ap_manual_launch_activations'
      and column_name='legacy_subscription_retirement_reference'),
  'manual launch activation must record provider-side legacy subscription retirement evidence'
);

select pg_temp.assert_true(
  position(
    'manual_launch_rolling_capacity_unavailable'
    in pg_get_functiondef('public.ap_reserve_capacity(uuid,public.ap_capacity_resource,integer,text,timestamptz,jsonb,uuid)'::regprocedure)
  ) > 0
  and position(
    'search-invitation:'
    in pg_get_functiondef('public.ap_reserve_capacity(uuid,public.ap_capacity_resource,integer,text,timestamptz,jsonb,uuid)'::regprocedure)
  ) > 0
  and position(
    'materials-checkout:'
    in pg_get_functiondef('public.ap_reserve_capacity(uuid,public.ap_capacity_resource,integer,text,timestamptz,jsonb,uuid)'::regprocedure)
  ) > 0
  and position(
    '24 hours'
    in pg_get_functiondef('public.ap_reserve_capacity(uuid,public.ap_capacity_resource,integer,text,timestamptz,jsonb,uuid)'::regprocedure)
  ) > 0
  and position(
    'search-invitation:'
    in pg_get_functiondef('public.ap_manual_launch_capacity_readiness()'::regprocedure)
  ) > 0
  and position(
    'materials-checkout:'
    in pg_get_functiondef('public.ap_manual_launch_capacity_readiness()'::regprocedure)
  ) > 0
  and position(
    'rollingUnits'
    in pg_get_functiondef('public.ap_manual_launch_capacity_readiness()'::regprocedure)
  ) > 0
  and position(
    '''available'''
    in pg_get_functiondef('public.ap_manual_launch_capacity_readiness()'::regprocedure)
  ) > 0
  and not has_function_privilege('service_role','public.ap_reserve_capacity(uuid,public.ap_capacity_resource,integer,text,timestamptz,jsonb,uuid)','execute'),
  'authoritative capacity must enforce and report the rolling 1/2 manual launch limits'
);

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  'f1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','manual-launch-capacity@example.invalid','',now(),'{}','{}',now(),now()
);
insert into public.ap_capacity_pools(id,resource,enabled,configuration_version) values
  ('f2000000-0000-4000-8000-000000000001','SEARCH',true,'manual-launch-readiness-v1'),
  ('f2000000-0000-4000-8000-000000000002','MATERIALS',true,'manual-launch-readiness-v1');
insert into public.ap_capacity_buckets(id,pool_id,starts_at,ends_at,total_units,staffing_version) values
  ('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',
    clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 days',1,'manual-launch-readiness-v1'),
  ('f3000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000002',
    clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 days',2,'manual-launch-readiness-v1');
select pg_temp.assert_true(
  public.ap_manual_launch_capacity_readiness()->>'ready'='true'
  and public.ap_manual_launch_capacity_readiness()->>'available'='true',
  'configured capacity with room must be healthy and available'
);
select public.ap_reserve_capacity(
  'f1000000-0000-4000-8000-000000000001','SEARCH',1,
  'search-invitation:f4000000-0000-4000-8000-000000000001',
  clock_timestamp()+interval '30 minutes','[]'
);
select pg_temp.assert_true(
  public.ap_manual_launch_capacity_readiness()->>'ready'='true'
  and public.ap_manual_launch_capacity_readiness()->>'available'='false',
  'full rolling capacity must keep health true while blocking a new checkout'
);

select pg_temp.assert_true(
  exists(select 1 from pg_trigger where tgrelid='public.ap_board_subscriptions'::regclass
    and tgname='ap_retire_board_subscription_state' and not tgisinternal),
  'retired board access requires a fail-closed database trigger'
);

select pg_temp.assert_true(
  (select pg_get_functiondef('public.ap_issue_search_checkout_invitation(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text)'::regprocedure)
     like '%ap_reserve_capacity%SEARCH%search-invitation:%'
     and pg_get_functiondef('public.ap_issue_search_checkout_invitation(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text)'::regprocedure)
     like '%expires_at<=now_at%revoked_at=now_at%'),
  'invitation issuance must reserve search capacity atomically and retire expired invitations'
);
select pg_temp.assert_true(
  (select pg_get_functiondef('public.ap_begin_invited_search_checkout(uuid,text,uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)'::regprocedure)
     like '%consumed_at is not null%checkout_invitation_invalid%'
     and pg_get_functiondef('public.ap_begin_invited_search_checkout(uuid,text,uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)'::regprocedure)
     like '%checkout_invitation_capacity_invalid%ap_begin_search_checkout%consumed_at=clock_timestamp()%'),
  'invited checkout must reject consumed or invalid capacity and consume once'
);
select pg_temp.assert_true(
  (select pg_get_functiondef('public.ap_begin_search_checkout(uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)'::regprocedure)
     like '%checkout_invitation_required%configuration.search_price_cents%'),
  'authoritative checkout must require invitation context and current configured price'
);

select pg_temp.assert_true(
  (select pg_get_functiondef('public.ap_commit_exact_ten_release(uuid,uuid,uuid,jsonb,jsonb,text,uuid,uuid)'::regprocedure)
     like '%array_remove(array[left_job.canonical_employer_listing_url,left_job.canonical_application_url],null)%'
     and pg_get_functiondef('public.ap_commit_exact_ten_release(uuid,uuid,uuid,jsonb,jsonb,text,uuid,uuid)'::regprocedure)
     like '%array_remove(array[right_job.canonical_employer_listing_url,right_job.canonical_application_url],null)%'
     and pg_get_functiondef('public.ap_commit_exact_ten_release(uuid,uuid,uuid,jsonb,jsonb,text,uuid,uuid)'::regprocedure)
     like '%left_job.external_job_id is null and left_job.canonical_employer_listing_url is null and left_job.canonical_application_url is null%'
     and pg_get_functiondef('public.ap_commit_exact_ten_release(uuid,uuid,uuid,jsonb,jsonb,text,uuid,uuid)'::regprocedure)
     like '%right_job.external_job_id is null and right_job.canonical_employer_listing_url is null and right_job.canonical_application_url is null%'),
  'exact-ten release must compare cross-field URL sets and limit fingerprint fallback'
);

select pg_temp.assert_true(
  (select pg_get_functiondef('public.ap_queue_search_refund(uuid,uuid,public.ap_refund_scope,text)'::regprocedure)
     like '%payment_row.amount_cents%'),
  'refunds must use the immutable historical or current paid amount'
);

rollback;
