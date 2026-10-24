begin;

-- The owner removed a separate CPA / revenue-department approval from launch
-- activation. Historical approval columns and values remain available for
-- audit, but they no longer authorize checkout. The persisted gate instead
-- binds activation to the exact fixed customer totals and no-added-tax mode.
alter table public.ap_manual_launch_activations
  alter column tax_approval_reference drop not null;
alter table public.ap_manual_launch_activations
  drop constraint if exists ap_manual_launch_activations_tax_approval_reference_check;

alter table public.ap_commerce_configuration drop column checkout_enabled;
alter table public.ap_commerce_configuration
  add column checkout_enabled boolean generated always as (
    tax_treatment='TAX_INCLUSIVE_NO_ADDED_AMOUNT'
    and tax_inclusive
    and currency='USD'
    and search_price_cents=1899
    and material_line_price_cents=799
    and sales_activation_approved
    and sales_activation_reference is not null
    and launch_product_scope='MANUAL_ONLY'
    and launch_activation_id is not null
    and launch_release_sha is not null
    and document_worker_network_attestation_sha256 is not null
    and sales_activation_reference='manual-launch-activation:'||launch_activation_id::text
  ) stored;

-- The active materials RPCs retain tax-inclusive, fixed-price validation but
-- no longer require a separate tax approval flag or evidence reference.
do $migration$
declare definition text; function_name text;
begin
  foreach function_name in array array['ap_begin_material_checkout','ap_begin_board_material_checkout'] loop
    select pg_catalog.pg_get_functiondef(p.oid) into definition
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=function_name;
    definition:=replace(definition,chr(13),'');
    if definition is null
      or position('not config.tax_configuration_approved' in definition)=0
      or position('config.tax_approval_reference is null' in definition)=0
      or position('config.tax_treatment<>''TAX_INCLUSIVE_NO_ADDED_AMOUNT''' in definition)=0
      or position('not config.tax_inclusive' in definition)=0 then
      raise exception 'tax_activation_material_anchor_missing:%',function_name;
    end if;
    definition:=replace(definition,' or not config.tax_configuration_approved','');
    definition:=replace(definition,E'\n    or config.tax_approval_reference is null','');
    if position('tax_configuration_approved' in definition)>0
      or position('tax_approval_reference' in definition)>0
      or position('config.tax_treatment<>''TAX_INCLUSIVE_NO_ADDED_AMOUNT''' in definition)=0
      or position('not config.tax_inclusive' in definition)=0 then
      raise exception 'tax_activation_material_rewrite_failed:%',function_name;
    end if;
    execute definition;
  end loop;
end;
$migration$;

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
  canary_amount integer:=case when p_activation_phase='PUBLIC' then 2698 else 0 end;
  successful_canary_amount integer:=0;
  successful_canary_products integer:=0;
  successful_canary_customers integer:=0;
  required_reference text;
begin
  if p_activation_phase not in ('CANARY','PUBLIC') or p_release_sha !~ '^[0-9a-f]{40}$'
    or jsonb_typeof(p_evidence)<>'object'
    or coalesce(p_evidence->>'workerNetworkAttestationSha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_evidence->>'evidenceBundleSha256','') !~ '^[0-9a-f]{64}$' then
    raise exception 'manual_launch_activation_input_invalid';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then
    raise exception 'manual_launch_activation_admin_required';
  end if;
  if not exists(
    select 1 from public.ap_commerce_configuration
    where singleton
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
    'canaryReconciliationReference','legacySubscriptionRetirementReference'
  ] loop
    if length(btrim(coalesce(p_evidence->>required_reference,''))) not between 12 and 500 then
      raise exception 'manual_launch_activation_evidence_incomplete';
    end if;
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('manual-launch-activation:'||p_release_sha||':'||p_activation_phase,0)
  );
  select id,activation_phase into existing_id,existing_phase from public.ap_manual_launch_activations
    where release_sha=p_release_sha
      and evidence_bundle_sha256=p_evidence->>'evidenceBundleSha256';
  if existing_id is not null then
    if existing_phase<>p_activation_phase then
      raise exception 'manual_launch_activation_evidence_phase_conflict';
    end if;
    return existing_id;
  end if;

  if p_activation_phase='PUBLIC' then
    if not exists(select 1 from public.ap_manual_launch_activations
      where release_sha=p_release_sha and activation_phase='CANARY'
        and unresolved_p0_count=0 and unresolved_p1_count=0) then
      raise exception 'manual_launch_canary_activation_missing';
    end if;
    select coalesce(sum(refund.amount_cents),0),count(distinct designation.product_kind),
      count(distinct designation.expected_customer_id)
      into successful_canary_amount,successful_canary_products,successful_canary_customers
    from public.ap_manual_launch_canary_designations designation
      join public.ap_refund_operations refund
        on refund.payment_attempt_id=designation.payment_attempt_id
    where designation.release_sha=p_release_sha and designation.superseded_at is null
      and refund.reason_code='MANUAL_LAUNCH_CANARY' and refund.state='SUCCEEDED'
      and refund.superseded_at is null;
    if successful_canary_amount<>2698 or successful_canary_products<>2
      or successful_canary_customers<>1 then
      raise exception 'manual_launch_canary_refunds_not_reconciled';
    end if;
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
    legacy_subscription_retirement_reference,activation_phase
  ) values(
    activation_id,p_release_sha,p_evidence->>'healthEvidenceReference',
    p_evidence->>'databaseEvidenceReference',p_evidence->>'paymentEvidenceReference',
    p_evidence->>'emailEvidenceReference',p_evidence->>'kmsEvidenceReference',
    p_evidence->>'workerEvidenceReference',p_evidence->>'maintenanceEvidenceReference',
    p_evidence->>'backupRestoreEvidenceReference',p_evidence->>'inventoryEvidenceReference',
    p_evidence->>'accessibilityEvidenceReference',p_evidence->>'productSupervisorReference',
    p_evidence->>'securitySupervisorReference',p_evidence->>'operationsSupervisorReference',
    p_evidence->>'tenthManSupervisorReference',p_evidence->>'acceptedP2DispositionReference',
    0,0,p_evidence->>'canaryReconciliationReference',canary_amount,
    p_evidence->>'workerNetworkAttestationSha256',
    p_evidence->>'evidenceBundleSha256',p_actor_id,
    p_evidence->>'legacySubscriptionRetirementReference',p_activation_phase
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
      'canaryReconciledAmountCents',canary_amount),'manual-launch-activation-v3'
  );
  return activation_id;
end;
$$;
revoke all on function public.ap_record_manual_launch_activation(text,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.ap_record_manual_launch_activation(text,text,jsonb,uuid)
  to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610190082','TAX_ACTIVATION_DECISION',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

do $$
declare definition text;
begin
  definition:=pg_catalog.pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
  definition:=replace(definition,'select count(*)=5 as installed','select count(*)=6 as installed');
  definition:=replace(definition,
    '(''202610190081'',''OPEN_FONT_DOCUMENT_CONTRACT'')',
    '(''202610190081'',''OPEN_FONT_DOCUMENT_CONTRACT''),'||E'\n      '||
      '(''202610190082'',''TAX_ACTIVATION_DECISION'')');
  definition:=replace(definition,'''requiredSchemaVersion'', ''202610190081''',
    '''requiredSchemaVersion'', ''202610190082''');
  definition:=replace(definition,
    '''202610040077'',''202610040078'',''202610040079'',''202610040080'',''202610190081''',
    '''202610040077'',''202610040078'',''202610040079'',''202610040080'',''202610190081'',''202610190082''');
  if position('202610190082' in definition)=0 or position('count(*)=6' in definition)=0 then
    raise exception 'launch_schema_tax_activation_anchor_missing';
  end if;
  execute definition;
end $$;

commit;
