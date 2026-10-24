begin;

-- The approved October 23 contract uses reviewed sandbox evidence followed by
-- genuine customer service. Old activation/payment/refund rows remain history.
-- This is an operator attestation, not a provider-signed Stripe attestation.
alter table public.ap_manual_launch_activations
  add column activation_contract_version text not null default 'legacy-production-canary-v1',
  add column sandbox_validation jsonb,
  add column sandbox_validation_digest text;
alter table public.ap_manual_launch_activations
  alter column canary_reconciliation_reference drop not null,
  drop constraint ap_manual_launch_activations_canary_reconciled_amount_phase_check;

create function public.ap_sandbox_validation_receipt_valid(
  p_receipt jsonb,p_release_sha text,p_at timestamptz
) returns boolean language plpgsql immutable set search_path='' as $$
declare purchase jsonb; verified_at timestamptz; expected_amount integer; key_name text;
  root_keys text[]:=array['schemaVersion','sourceEnvironment','sourceProjectRef','sourceOrigin','stripeAccountId','livemode',
    'currency','releaseSha','verifiedAt','proofBundleSha256','purchases'];
  purchase_keys text[]:=array['productKind','units','amountCents','paymentAttemptId','checkoutSessionId',
    'paymentIntentId','checkoutCompletedEventId','deliveredReleaseId','refundId','refundAmountCents','refundStatus'];
begin
  if p_receipt is null or jsonb_typeof(p_receipt)<>'object' or p_at is null
    or p_release_sha is null or p_release_sha !~ '^[0-9a-f]{40}$'
    or not(p_receipt ?& root_keys) or (p_receipt-root_keys)<>'{}'::jsonb
    or p_receipt->'schemaVersion' is distinct from '"applypack-sandbox-validation-v1"'::jsonb
    or p_receipt->'sourceEnvironment' is distinct from '"staging"'::jsonb
    or p_receipt->'sourceProjectRef' is distinct from '"fmugizadzdnqfckujqlw"'::jsonb
    or p_receipt->'sourceOrigin' is distinct from '"https://applypack-staging-staging.up.railway.app"'::jsonb
    or p_receipt->'stripeAccountId' is distinct from '"acct_1UTeOMJBHv2xRTvu"'::jsonb
    or p_receipt->'livemode' is distinct from 'false'::jsonb
    or p_receipt->'currency' is distinct from '"USD"'::jsonb
    or p_receipt->'releaseSha' is distinct from to_jsonb(p_release_sha)
    or jsonb_typeof(p_receipt->'verifiedAt') is distinct from 'string'
    or (p_receipt->>'verifiedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
    or jsonb_typeof(p_receipt->'proofBundleSha256') is distinct from 'string'
    or (p_receipt->>'proofBundleSha256') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_receipt->'purchases') is distinct from 'array'
    then return false; end if;
  verified_at:=(p_receipt->>'verifiedAt')::timestamptz;
  if verified_at>p_at or verified_at<p_at-interval '24 hours'
    or jsonb_array_length(p_receipt->'purchases')<>2 then return false; end if;
  for purchase in select value from jsonb_array_elements(p_receipt->'purchases') loop
    if jsonb_typeof(purchase)<>'object' or not(purchase ?& purchase_keys)
      or (purchase-purchase_keys)<>'{}'::jsonb
      or purchase->'productKind' not in ('"SEARCH"'::jsonb,'"MATERIALS"'::jsonb)
      or purchase->'units' is distinct from '1'::jsonb
      or purchase->'refundStatus' is distinct from '"succeeded"'::jsonb
      then return false; end if;
    expected_amount:=case purchase->>'productKind' when 'SEARCH' then 1899 else 799 end;
    if purchase->'amountCents' is distinct from to_jsonb(expected_amount)
      or purchase->'refundAmountCents' is distinct from to_jsonb(expected_amount)
      then return false; end if;
    foreach key_name in array array['paymentAttemptId','deliveredReleaseId'] loop
      if jsonb_typeof(purchase->key_name) is distinct from 'string'
        or (purchase->>key_name) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then return false; end if;
    end loop;
    foreach key_name in array array['checkoutSessionId','paymentIntentId','checkoutCompletedEventId','refundId'] loop
      if jsonb_typeof(purchase->key_name) is distinct from 'string'
        or length(purchase->>key_name)>255 then return false; end if;
    end loop;
    if (purchase->>'checkoutSessionId') !~ '^cs_test_[A-Za-z0-9]+$'
      or (purchase->>'paymentIntentId') !~ '^pi_[A-Za-z0-9]+$'
      or (purchase->>'checkoutCompletedEventId') !~ '^evt_[A-Za-z0-9]+$'
      or (purchase->>'refundId') !~ '^re_[A-Za-z0-9]+$' then return false; end if;
  end loop;
  foreach key_name in array array['productKind','paymentAttemptId','checkoutSessionId','paymentIntentId',
    'checkoutCompletedEventId','deliveredReleaseId','refundId'] loop
    if (select count(distinct value->>key_name) from jsonb_array_elements(p_receipt->'purchases'))<>2
      then return false; end if;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
revoke all on function public.ap_sandbox_validation_receipt_valid(jsonb,text,timestamptz)
  from public,anon,authenticated,service_role;

alter table public.ap_manual_launch_activations add constraint ap_manual_launch_activation_contract_check check (
  (activation_contract_version='legacy-production-canary-v1' and sandbox_validation is null
    and sandbox_validation_digest is null and canary_reconciliation_reference is not null
    and ((activation_phase='CANARY' and canary_reconciled_amount_cents=0)
      or (activation_phase='PUBLIC' and canary_reconciled_amount_cents=2698)))
  or
  (activation_contract_version='sandbox-proof-live-pilot-v1' and activation_phase='PUBLIC'
    and canary_reconciled_amount_cents=0 and canary_reconciliation_reference is null
    and sandbox_validation is not null and sandbox_validation_digest is not null
    and sandbox_validation_digest=encode(extensions.digest(convert_to(sandbox_validation::text,'UTF8'),'sha256'),'hex')
    and public.ap_sandbox_validation_receipt_valid(sandbox_validation,release_sha,created_at))
);

create function public.ap_staging_canary_operations_allowed()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.ap_commerce_configuration where singleton
    and canonical_site_url='https://applypack-staging-staging.up.railway.app');
$$;
revoke all on function public.ap_staging_canary_operations_allowed() from public,anon,authenticated,service_role;

create function public.ap_prepare_sandbox_launch_activation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=new.approved_by and role='admin')
    then raise exception 'manual_launch_activation_admin_required'; end if;
  new.created_at:=clock_timestamp();
  if new.activation_phase='CANARY' then
    if not public.ap_staging_canary_operations_allowed() or new.activation_contract_version<>'legacy-production-canary-v1'
      then raise exception 'manual_launch_production_canary_retired'; end if;
    return new;
  end if;
  if new.activation_phase<>'PUBLIC' or new.activation_contract_version<>'sandbox-proof-live-pilot-v1'
    then raise exception 'manual_launch_activation_contract_required'; end if;
  if not exists(select 1 from public.ap_commerce_configuration where singleton and canonical_site_url='https://applypack.work')
    then raise exception 'manual_launch_public_production_required'; end if;
  if not public.ap_sandbox_validation_receipt_valid(new.sandbox_validation,new.release_sha,new.created_at)
    then raise exception 'manual_launch_sandbox_validation_invalid'; end if;
  new.sandbox_validation_digest:=encode(extensions.digest(convert_to(new.sandbox_validation::text,'UTF8'),'sha256'),'hex');
  return new;
end $$;
revoke all on function public.ap_prepare_sandbox_launch_activation() from public,anon,authenticated,service_role;
create trigger ap_prepare_sandbox_launch_activation before insert on public.ap_manual_launch_activations
  for each row execute function public.ap_prepare_sandbox_launch_activation();
revoke insert on public.ap_manual_launch_activations from service_role;

create or replace function public.ap_record_manual_launch_activation(
  p_activation_phase text,
  p_release_sha text,
  p_evidence jsonb,
  p_actor_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  activation_id uuid:=gen_random_uuid();
  existing_id uuid;
  existing_phase text;
  existing_receipt jsonb;
  existing_contract text;
  receipt_digest text;
  required_reference text;
begin
  if p_activation_phase is null or p_activation_phase not in ('PUBLIC','CANARY')
    or (p_activation_phase='PUBLIC' and (p_evidence->>'activationContractVersion' is distinct from 'sandbox-proof-live-pilot-v1'
      or p_evidence ? 'canaryReconciliationReference'))
    or p_release_sha is null or p_release_sha !~ '^[0-9a-f]{40}$'
    or jsonb_typeof(p_evidence) is distinct from 'object'
    or coalesce(p_evidence->>'workerNetworkAttestationSha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_evidence->>'evidenceBundleSha256','') !~ '^[0-9a-f]{64}$' then
    raise exception 'manual_launch_activation_input_invalid';
  end if;
  if p_activation_phase='CANARY' and not public.ap_staging_canary_operations_allowed()
    then raise exception 'manual_launch_production_canary_retired'; end if;
  if p_activation_phase='CANARY' and length(btrim(coalesce(p_evidence->>'canaryReconciliationReference',''))) not between 12 and 500
    then raise exception 'manual_launch_activation_evidence_incomplete'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then
    raise exception 'manual_launch_activation_admin_required';
  end if;
  if not exists(
    select 1 from public.ap_commerce_configuration
    where singleton
      and ((p_activation_phase='PUBLIC' and canonical_site_url='https://applypack.work')
        or (p_activation_phase='CANARY' and canonical_site_url='https://applypack-staging-staging.up.railway.app'))
      and tax_treatment='TAX_INCLUSIVE_NO_ADDED_AMOUNT'
      and tax_inclusive
      and currency='USD'
      and search_price_cents=1899
      and material_line_price_cents=799
  ) then
    raise exception 'manual_launch_fixed_total_configuration_required';
  end if;
  foreach required_reference in array array[
    'healthEvidenceReference','databaseEvidenceReference','paymentEvidenceReference',
    'emailEvidenceReference','kmsEvidenceReference','workerEvidenceReference',
    'maintenanceEvidenceReference','backupRestoreEvidenceReference','inventoryEvidenceReference',
    'accessibilityEvidenceReference','productSupervisorReference','securitySupervisorReference',
    'operationsSupervisorReference','tenthManSupervisorReference','acceptedP2DispositionReference',
    'legacySubscriptionRetirementReference'
  ] loop
    if length(btrim(coalesce(p_evidence->>required_reference,''))) not between 12 and 500 then
      raise exception 'manual_launch_activation_evidence_incomplete';
    end if;
  end loop;

  if p_activation_phase='PUBLIC' then
    if not public.ap_sandbox_validation_receipt_valid(p_evidence->'sandboxValidation',p_release_sha,clock_timestamp())
      then raise exception 'manual_launch_sandbox_validation_invalid'; end if;
    receipt_digest:=encode(extensions.digest(convert_to((p_evidence->'sandboxValidation')::text,'UTF8'),'sha256'),'hex');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('manual-launch-activation:'||p_release_sha||':'||p_activation_phase,0)
  );
  select id,activation_phase,sandbox_validation,activation_contract_version
    into existing_id,existing_phase,existing_receipt,existing_contract from public.ap_manual_launch_activations
    where release_sha=p_release_sha
      and evidence_bundle_sha256=p_evidence->>'evidenceBundleSha256';
  if existing_id is not null then
    if existing_phase<>p_activation_phase or (p_activation_phase='PUBLIC' and
      (existing_contract<>'sandbox-proof-live-pilot-v1' or existing_receipt is distinct from p_evidence->'sandboxValidation')) then
      raise exception 'manual_launch_activation_evidence_phase_conflict';
    end if;
    return existing_id;
  end if;

  insert into public.ap_manual_launch_activations(
    id,release_sha,health_evidence_reference,database_evidence_reference,
    payment_evidence_reference,email_evidence_reference,kms_evidence_reference,
    worker_evidence_reference,maintenance_evidence_reference,backup_restore_evidence_reference,
    inventory_evidence_reference,accessibility_evidence_reference,product_supervisor_reference,
    security_supervisor_reference,operations_supervisor_reference,tenth_man_supervisor_reference,
    accepted_p2_disposition_reference,unresolved_p0_count,unresolved_p1_count,
    canary_reconciliation_reference,canary_reconciled_amount_cents,
    worker_network_attestation_sha256,evidence_bundle_sha256,approved_by,
    legacy_subscription_retirement_reference,activation_phase,activation_contract_version,sandbox_validation,sandbox_validation_digest
  ) values(
    activation_id,p_release_sha,p_evidence->>'healthEvidenceReference',
    p_evidence->>'databaseEvidenceReference',p_evidence->>'paymentEvidenceReference',
    p_evidence->>'emailEvidenceReference',p_evidence->>'kmsEvidenceReference',
    p_evidence->>'workerEvidenceReference',p_evidence->>'maintenanceEvidenceReference',
    p_evidence->>'backupRestoreEvidenceReference',p_evidence->>'inventoryEvidenceReference',
    p_evidence->>'accessibilityEvidenceReference',p_evidence->>'productSupervisorReference',
    p_evidence->>'securitySupervisorReference',p_evidence->>'operationsSupervisorReference',
    p_evidence->>'tenthManSupervisorReference',p_evidence->>'acceptedP2DispositionReference',
    0,0,case when p_activation_phase='CANARY' then p_evidence->>'canaryReconciliationReference' else null end,0,
    p_evidence->>'workerNetworkAttestationSha256',
    p_evidence->>'evidenceBundleSha256',p_actor_id,
    p_evidence->>'legacySubscriptionRetirementReference',p_activation_phase,
    case when p_activation_phase='PUBLIC' then 'sandbox-proof-live-pilot-v1' else 'legacy-production-canary-v1' end,
    case when p_activation_phase='PUBLIC' then p_evidence->'sandboxValidation' else null end,receipt_digest
  );
  update public.ap_commerce_configuration set
    sales_activation_approved=true,
    sales_activation_reference='manual-launch-activation:'||activation_id::text,
    launch_activation_id=activation_id,
    launch_release_sha=p_release_sha,
    document_worker_network_attestation_sha256=p_evidence->>'workerNetworkAttestationSha256',
    updated_at=clock_timestamp()
  where singleton;
  insert into public.ap_audit_events(
    actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version
  ) values(
    p_actor_id,'MANUAL_LAUNCH_ACTIVATION_RECORDED','MANUAL_LAUNCH_ACTIVATION',activation_id,
    jsonb_build_object('releaseSha',p_release_sha,'activationPhase',p_activation_phase,
      'evidenceBundleSha256',p_evidence->>'evidenceBundleSha256',
      'activationContractVersion',case when p_activation_phase='PUBLIC' then 'sandbox-proof-live-pilot-v1' else 'legacy-production-canary-v1' end,'sandboxValidationDigest',receipt_digest),
      'manual-launch-activation-v4'
  );
  return activation_id;
end;
$$;
revoke all on function public.ap_record_manual_launch_activation(text,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.ap_record_manual_launch_activation(text,text,jsonb,uuid)
  to service_role;

create or replace function public.ap_set_checkout_mode(
  p_mode text,p_release_sha text,p_actor_id uuid,p_evidence_reference text
) returns bigint language plpgsql security definer set search_path='' as $$
declare current_mode public.ap_checkout_mode_configuration; next_generation bigint;
begin
  if p_mode is null or p_mode not in ('LOCKED','PUBLIC','CANARY','REHEARSAL')
    or (p_mode<>'LOCKED' and coalesce(p_release_sha,'') !~ '^[0-9a-f]{40}$')
    or length(btrim(coalesce(p_evidence_reference,''))) not between 12 and 500
    or not exists(select 1 from public.profiles where id=p_actor_id and role='admin')
    then raise exception 'checkout_mode_change_invalid'; end if;
  if p_mode='CANARY' and not public.ap_staging_canary_operations_allowed()
    then raise exception 'manual_launch_production_canary_retired'; end if;
  select * into current_mode from public.ap_checkout_mode_configuration where singleton for update;
  if p_mode<>'LOCKED' and current_mode.mode<>'LOCKED'
    then raise exception 'checkout_mode_transition_requires_locked'; end if;
  if p_mode<>'LOCKED' and exists(select 1 from public.ap_checkout_initiations attempt
    join public.ap_payment_attempts payment on payment.id=attempt.payment_attempt_id
    where attempt.state in ('INITIATED','OPEN','EXPIRATION_REQUIRED')
      or (attempt.state='PAID' and (payment.payment_verified_at is null or payment.settlement<>'PAID')))
    then raise exception 'checkout_mode_transition_requires_reconciliation'; end if;
  if p_mode='REHEARSAL' and not exists(select 1 from public.ap_commerce_configuration where singleton
    and canonical_site_url='https://applypack-staging-staging.up.railway.app' and not checkout_enabled)
    then raise exception 'checkout_mode_rehearsal_staging_required'; end if;
  if p_mode in ('PUBLIC','CANARY') and not exists(select 1 from public.ap_commerce_configuration config
    join public.ap_manual_launch_activations activation on activation.id=config.launch_activation_id
    where config.singleton and config.checkout_enabled and config.launch_release_sha=p_release_sha
      and activation.release_sha=p_release_sha and activation.activation_phase=p_mode
      and (p_mode='CANARY' or (config.canonical_site_url='https://applypack.work'
        and activation.activation_contract_version='sandbox-proof-live-pilot-v1'
        and public.ap_sandbox_validation_receipt_valid(activation.sandbox_validation,activation.release_sha,activation.created_at)
        and activation.sandbox_validation_digest=encode(extensions.digest(convert_to(activation.sandbox_validation::text,'UTF8'),'sha256'),'hex'))))
    then raise exception 'checkout_mode_activation_required'; end if;
  update public.ap_checkout_mode_configuration set mode=p_mode,release_sha=p_release_sha,
    generation=generation+1,updated_at=clock_timestamp(),updated_by=p_actor_id where singleton
    returning generation into next_generation;
  if p_mode='LOCKED' then
    update public.ap_manual_launch_canary_authorizations authz
      set revoked_at=clock_timestamp(),revoked_by=p_actor_id,revocation_evidence_reference=btrim(p_evidence_reference)
      where revoked_at is null and not exists(select 1 from public.ap_manual_launch_canary_designations designation
        where designation.authorization_id=authz.id);
    update public.ap_staging_rehearsal_authorizations set revoked_at=clock_timestamp(),revoked_by=p_actor_id,
      revocation_reference=btrim(p_evidence_reference) where revoked_at is null;
    update public.ap_checkout_initiations set state='EXPIRATION_REQUIRED',updated_at=clock_timestamp()
      where state in ('INITIATED','OPEN');
  end if;
  insert into public.ap_audit_events(actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_actor_id,'CHECKOUT_MODE_CHANGED','CHECKOUT_MODE',gen_random_uuid(),
    jsonb_build_object('mode',p_mode,'releaseSha',p_release_sha,'generation',next_generation,
      'evidenceReference',btrim(p_evidence_reference)),'checkout-initiation-v1');
  return next_generation;
end $$;

create or replace function public.ap_assert_checkout_initiation_authorized(
  p_mode text,p_customer_id uuid,p_release_sha text,p_authorization_id uuid,
  p_product_kind text,p_resource_id uuid,p_resource_sha256 text
) returns uuid language plpgsql security definer set search_path='' as $$
declare authz public.ap_staging_rehearsal_authorizations; canary public.ap_manual_launch_canary_authorizations;
  resolved_id uuid:=p_authorization_id;
begin
  if p_mode is null or p_mode not in ('PUBLIC','CANARY','REHEARSAL')
    or p_release_sha is null or p_release_sha !~ '^[0-9a-f]{40}$'
    then raise exception 'checkout_initiation_mode_invalid'; end if;
  if p_mode='CANARY' and not public.ap_staging_canary_operations_allowed()
    then raise exception 'manual_launch_production_canary_retired'; end if;
  -- A row lock serializes initiation against a deployment transition. Revoking
  -- old entry-point grants also stops pre-085 instances from creating Sessions.
  perform 1 from public.ap_checkout_mode_configuration where singleton
    and mode=p_mode and release_sha=p_release_sha for share;
  if not found then raise exception 'checkout_database_mode_denied'; end if;
  if p_mode='REHEARSAL' then
    select * into authz from public.ap_staging_rehearsal_authorizations where id=p_authorization_id for update;
    if not found or authz.customer_id is distinct from p_customer_id or authz.product_kind<>p_product_kind
      or authz.resource_id<>p_resource_id or authz.resource_sha256 is distinct from p_resource_sha256
      or authz.release_sha<>p_release_sha or authz.revoked_at is not null or authz.expires_at<=clock_timestamp()
      or exists(select 1 from public.ap_checkout_initiations where authorization_id=authz.id)
      then raise exception 'staging_rehearsal_authorization_denied'; end if;
    perform set_config('applypack.rehearsal_authorization_id',authz.id::text,true);
    perform set_config('applypack.checkout_release_sha',p_release_sha,true);
    if not public.ap_checkout_context_allows_rehearsal()
      then raise exception 'staging_rehearsal_configuration_denied'; end if;
  elsif p_mode='CANARY' then
    select * into canary from public.ap_manual_launch_canary_authorizations
      where release_sha=p_release_sha and product_kind=p_product_kind
        and expected_customer_id=p_customer_id
        and (p_product_kind='MATERIALS' or search_draft_id=p_resource_id)
        and (p_authorization_id is null or id=p_authorization_id)
        and revoked_at is null and expires_at>clock_timestamp()
      order by created_at desc limit 1 for update;
    if not found or not public.ap_manual_launch_canary_checkout_authorized(p_release_sha,p_product_kind,
      p_customer_id,case when p_product_kind='SEARCH' then p_resource_id else null end)
      or not exists(select 1 from public.ap_manual_launch_canary_resource_bindings
        where authorization_id=canary.id and resource_id=p_resource_id
          and resource_sha256 is not distinct from p_resource_sha256)
      or exists(select 1 from public.ap_checkout_initiations where authorization_id=canary.id)
      then raise exception 'checkout_canary_authorization_denied'; end if;
    resolved_id:=canary.id;
  else
    if p_authorization_id is not null or not exists(
      select 1 from public.ap_commerce_configuration config
        join public.ap_manual_launch_activations activation on activation.id=config.launch_activation_id
      where config.singleton and config.checkout_enabled and config.launch_release_sha=p_release_sha
        and activation.release_sha=p_release_sha and activation.activation_phase='PUBLIC'
        and config.canonical_site_url='https://applypack.work'
        and activation.activation_contract_version='sandbox-proof-live-pilot-v1'
        and public.ap_sandbox_validation_receipt_valid(activation.sandbox_validation,activation.release_sha,activation.created_at)
        and activation.sandbox_validation_digest=encode(extensions.digest(convert_to(activation.sandbox_validation::text,'UTF8'),'sha256'),'hex'))
      then raise exception 'checkout_public_activation_denied'; end if;
  end if;
  return resolved_id;
end $$;

create function public.ap_sandbox_activation_schema_installed()
returns boolean language sql stable security definer set search_path='' as $$
  select
    (select count(*)=3 from information_schema.columns where table_schema='public'
      and table_name='ap_manual_launch_activations' and
        ((column_name='activation_contract_version' and data_type='text' and is_nullable='NO')
          or (column_name='sandbox_validation' and data_type='jsonb')
          or (column_name='sandbox_validation_digest' and data_type='text')))
    and exists(select 1 from pg_constraint where conrelid='public.ap_manual_launch_activations'::regclass
      and conname='ap_manual_launch_activation_contract_check' and convalidated
      and position('ap_sandbox_validation_receipt_valid' in pg_get_constraintdef(oid))>0)
    and (select count(*)=2 from pg_trigger where tgrelid='public.ap_manual_launch_activations'::regclass
      and tgname in ('ap_prepare_sandbox_launch_activation','ap_manual_launch_activation_immutable')
      and not tgisinternal and tgenabled='O')
    and (select count(*)=3 from pg_trigger where not tgisinternal and tgenabled='O'
      and ((tgrelid='public.ap_manual_launch_canary_authorizations'::regclass and tgname='ap_guard_staging_canary_authorization')
        or (tgrelid='public.ap_manual_launch_canary_designations'::regclass and tgname='ap_guard_staging_canary_designation')
        or (tgrelid='public.ap_refund_operations'::regclass and tgname='ap_guard_staging_canary_refund')))
    and not has_table_privilege('service_role','public.ap_manual_launch_activations','INSERT')
    and not has_table_privilege('authenticated','public.ap_manual_launch_activations','SELECT')
    and position('ap_staging_canary_operations_allowed()' in pg_get_functiondef('public.ap_queue_manual_launch_canary_refund(uuid,uuid,text,text)'::regprocedure))>0
    and position('ap_staging_canary_operations_allowed()' in pg_get_functiondef('public.ap_authorize_scoped_manual_launch_canary_checkout(text,text,uuid,uuid,uuid,text,timestamptz,uuid,text)'::regprocedure))>0
    and position('sandbox-proof-live-pilot-v1' in pg_get_functiondef('public.ap_record_manual_launch_activation(text,text,jsonb,uuid)'::regprocedure))>0
    and position('sandbox-proof-live-pilot-v1' in pg_get_functiondef('public.ap_set_checkout_mode(text,text,uuid,text)'::regprocedure))>0
    and position('sandbox-proof-live-pilot-v1' in pg_get_functiondef('public.ap_assert_checkout_initiation_authorized(text,uuid,text,uuid,text,uuid,text)'::regprocedure))>0;
$$;
revoke all on function public.ap_sandbox_activation_schema_installed() from public,anon,authenticated,service_role;

-- Preserve staging-only helpers and all historical settlement workers. A
-- request cannot manufacture staging by passing an environment parameter: each
-- mutation checks the database's exact trusted canonical origin.
do $$ declare fn record; definition text; begin
  for fn in select p.oid,p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('ap_authorize_manual_launch_canary_checkout','ap_authorize_scoped_manual_launch_canary_checkout',
        'ap_bind_manual_launch_canary_payment','ap_designate_manual_launch_canary_payment',
        'ap_queue_manual_launch_canary_refund')
  loop
    definition:=replace(pg_get_functiondef(fn.oid),chr(13),'');
    if position(E'begin\n' in definition)=0 then raise exception 'canary_environment_guard_anchor_missing:%',fn.signature; end if;
    definition:=replace(definition,E'begin\n',E'begin\n  if not public.ap_staging_canary_operations_allowed() then raise exception ''manual_launch_production_canary_retired''; end if;\n');
    execute definition;
  end loop;
end $$;
revoke insert on public.ap_manual_launch_canary_authorizations,public.ap_manual_launch_canary_designations,
  public.ap_manual_launch_canary_resource_bindings from service_role;

-- Guard direct table creation too; settlement updates to old refunds remain
-- allowed. This closes the generic refund RPC's reason-code bypass.
create function public.ap_guard_staging_canary_creation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.ap_staging_canary_operations_allowed() and
    (tg_table_name<>'ap_refund_operations' or to_jsonb(new)->>'reason_code'='MANUAL_LAUNCH_CANARY')
    then raise exception 'manual_launch_production_canary_retired'; end if;
  return new;
end $$;
revoke all on function public.ap_guard_staging_canary_creation() from public,anon,authenticated,service_role;
create trigger ap_guard_staging_canary_authorization before insert on public.ap_manual_launch_canary_authorizations
  for each row execute function public.ap_guard_staging_canary_creation();
create trigger ap_guard_staging_canary_designation before insert on public.ap_manual_launch_canary_designations
  for each row execute function public.ap_guard_staging_canary_creation();
create trigger ap_guard_staging_canary_refund before insert on public.ap_refund_operations
  for each row execute function public.ap_guard_staging_canary_creation();

-- Lock new sales while retaining prior records and in-flight obligations.
update public.ap_commerce_configuration set sales_activation_approved=false,sales_activation_reference=null,
  launch_activation_id=null,launch_release_sha=null,updated_at=clock_timestamp() where singleton;
update public.ap_checkout_mode_configuration set mode='LOCKED',release_sha=null,generation=generation+1,
  updated_at=clock_timestamp() where singleton;
update public.ap_checkout_initiations set state='EXPIRATION_REQUIRED',updated_at=clock_timestamp()
  where state in ('INITIATED','OPEN');

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610230086','SANDBOX_VALIDATION_LAUNCH_ACTIVATION',0,clock_timestamp());

-- Preserve prior identity guards and add real schema and privilege checks.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
  if position('select count(*)=9 as installed' in definition)=0
    or position('''requiredSchemaVersion'', ''202610220085''' in definition)=0
    or position('from contracts cross join checkpoints cross join guard cross join live_inventory' in definition)=0
    then raise exception 'sandbox_activation_readiness_anchor_missing'; end if;
  definition:=replace(definition,'select count(*)=9 as installed','select count(*)=10 as installed');
  definition:=replace(definition,'(''202610220085'',''STAGING_REHEARSAL_CHECKOUT_ATTEMPTS'')',
    '(''202610220085'',''STAGING_REHEARSAL_CHECKOUT_ATTEMPTS''),(''202610230086'',''SANDBOX_VALIDATION_LAUNCH_ACTIVATION'')');
  definition:=replace(definition,'''requiredSchemaVersion'', ''202610220085''','''requiredSchemaVersion'', ''202610230086''');
  definition:=replace(definition,'''202610190084'',''202610220085''','''202610190084'',''202610220085'',''202610230086''');
  definition:=replace(definition,'''ready'', checkpoints.installed and guard.installed and live_inventory.clean',
    '''ready'', checkpoints.installed and guard.installed and live_inventory.clean and public.ap_sandbox_activation_schema_installed()');
  if position('public.ap_sandbox_activation_schema_installed()' in definition)=0
    then raise exception 'sandbox_activation_readiness_rewrite_failed'; end if;
  execute definition;
end $$;

-- Forward disclosure for the approved encrypted processing and recovery design.
-- Prior paid orders and immutable acceptance/content receipts are not rewritten.
update public.ap_commerce_configuration
set privacy_version='privacy-2026-10-23-v2',
    privacy_content_sha256='9fa809f25bf55a03fab529f991b1d5870849fcc2294c08b324f1d2cf0187ea16',
    updated_at=clock_timestamp()
where singleton and privacy_version='privacy-v1'
  and privacy_content_sha256='9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9';
do $$ begin
  if not exists(select 1 from public.ap_commerce_configuration where singleton
    and privacy_version='privacy-2026-10-23-v2'
    and privacy_content_sha256='9fa809f25bf55a03fab529f991b1d5870849fcc2294c08b324f1d2cf0187ea16')
  then raise exception 'protected_recovery_privacy_version_conflict'; end if;
end $$;

commit;
