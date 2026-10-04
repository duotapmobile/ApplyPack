begin;

create or replace function pg_temp.assert_true(value boolean, message text) returns void
language plpgsql as $$ begin if value is distinct from true then raise exception '%',message; end if; end $$;

select pg_temp.assert_true(exists(
  select 1 from public.ap_migration_checkpoints
  where migration_id='202610030069' and checkpoint='DURABLE_DELIVERED_DOCUMENT_ACCESS'
),'durable delivered document access checkpoint missing');
select pg_temp.assert_true(exists(
  select 1 from public.ap_migration_checkpoints
  where migration_id='202610030070' and checkpoint='ALL_SENSITIVE_UPLOAD_CLEANUP_INTENTS'
),'all-sensitive-upload cleanup checkpoint missing');
select pg_temp.assert_true(
  exists(
    select 1
    from pg_constraint constraint_record
    join pg_class table_record on table_record.oid = constraint_record.conrelid
    join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'public'
      and table_record.relname = 'storage_cleanup_queue'
      and constraint_record.conname = 'storage_cleanup_queue_bucket_check'
      and position(
        'operator-render-previews' in pg_get_constraintdef(constraint_record.oid)
      ) > 0
  ),
  'render-preview cleanup bucket is not allowed'
);

do $$
declare registration text; source_guard_definition text; current_definition text; supported_definition text;
  download_definition text; approval_definition text; release_definition text; rollover text;
begin
  registration:=pg_get_functiondef(
    'public.ap_register_material_artifact_version(uuid,uuid,uuid,uuid,public.ap_artifact_type,uuid,uuid,uuid,uuid,uuid[],jsonb,text,text,text,text,text,text,integer,text,text,jsonb,jsonb,text,integer,text,text,text,text,text,text,text[],boolean)'::regprocedure
  );
  source_guard_definition:=pg_get_functiondef('public.ap_guard_locked_editable_document_source()'::regprocedure);
  current_definition:=pg_get_functiondef('public.ap_assert_current_artifact_facts(uuid)'::regprocedure);
  supported_definition:=pg_get_functiondef('public.ap_assert_supported_artifact_facts(uuid)'::regprocedure);
  download_definition:=pg_get_functiondef('public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz)'::regprocedure);
  approval_definition:=pg_get_functiondef('public.ap_record_material_human_approval(uuid,uuid,text,text)'::regprocedure);
  release_definition:=pg_get_functiondef('public.ap_commit_material_release_v2(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure);
  rollover:=pg_get_functiondef('public.ap_ensure_manual_launch_capacity_rollover()'::regprocedure);
  perform pg_temp.assert_true(
    position('config.document_font_family in (''Arial'',''Liberation Sans'')' in registration)>0,
    'preceding renderer approval contract is not accepted by registration'
  );
  perform pg_temp.assert_true(
    position('is distinct from ''operator-drafts''' in source_guard_definition)>0
      and position('coalesce(source->>''safeFilename''' in source_guard_definition)>0
      and position('coalesce(source->>''sizeBytes''' in source_guard_definition)>0,
    'editable-source malformed-json forward fix is not installed'
  );
  perform pg_temp.assert_true(
    position('applypack-content-2026-09-22.1' in supported_definition)>0
      and position('applypack-universal-document-standard-2026-10-03.1' in supported_definition)>0
      and position('cross join public.ap_commerce_configuration' in supported_definition)=0
      and position('ap_current_source_verifications' in supported_definition)=0
      and position('listing_status' in supported_definition)=0
      and position('supersedes_job_snapshot_id' in supported_definition)=0
      and position('fact.superseded_at' in supported_definition)=0
      and position('applypack-content-2026-09-22.1' in current_definition)=0
      and position('ap_assert_supported_artifact_facts' in current_definition)>0
      and position('ap_current_source_verifications' in current_definition)>0
      and position('listing_status' in current_definition)>0
      and position('supersedes_job_snapshot_id' in current_definition)>0
      and position('fact.superseded_at' in current_definition)>0,
    'delivered access was not separated from release-time source freshness'
  );
  perform pg_temp.assert_true(
    position('ap_assert_supported_artifact_facts' in download_definition)>0
      and position('ap_assert_current_artifact_facts' in download_definition)=0
      and position('ap_assert_current_artifact_facts' in approval_definition)>0
      and position('ap_assert_supported_artifact_facts' in approval_definition)=0
      and position('ap_assert_current_artifact_facts' in release_definition)>0
      and position('ap_assert_supported_artifact_facts' in release_definition)=0,
    'historical access was not separated from current-only approval and release'
  );
  perform pg_temp.assert_true(
    position('pg_advisory_xact_lock' in rollover)>0
      and position('pg_advisory_xact_lock' in rollover)<position('FOR UPDATE' in upper(rollover)),
    'capacity rollover does not acquire the advisory lock before row locks'
  );
end $$;

-- The preceding application can be deliberately reapproved after migration
-- 066 without opening checkout; the transaction rolls this fixture back.
update public.ap_commerce_configuration
set document_font_family='Liberation Sans',
    document_font_sha256=repeat('a',64),
    document_renderer_identity='rollback-fixture-renderer',
    document_safety_policy='generated-structural-v1',
    materials_generation_approved=false,
    materials_generation_approval_reference=null
where singleton;
select pg_temp.assert_true((select document_font_family='Liberation Sans'
  and not materials_generation_approved from public.ap_commerce_configuration where singleton),
  'preceding renderer cannot be selected fail-closed');

select pg_temp.assert_true(
  to_regprocedure('public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz)') is not null,
  'customer download authorization contract missing');
select pg_temp.assert_true(
  to_regprocedure('public.claim_stripe_webhook(text)') is not null,
  'webhook replay contract missing');
select pg_temp.assert_true(
  to_regprocedure('public.ap_record_search_refund_result_verified(uuid,text,text,text,integer,text,uuid,text,text,text,timestamptz,text)') is not null,
  'verified refund reconciliation contract missing');
select pg_temp.assert_true(
  to_regprocedure('public.ap_ensure_manual_launch_capacity_rollover()') is not null,
  'maintenance capacity rollover contract missing');
select pg_temp.assert_true(
  has_function_privilege('service_role','public.claim_stripe_webhook(text)','EXECUTE')
  and has_function_privilege('service_role','public.ap_record_search_refund_result_verified(uuid,text,text,text,integer,text,uuid,text,text,text,timestamptz,text)','EXECUTE'),
  'rollback-critical webhook or refund grant missing');

rollback;
