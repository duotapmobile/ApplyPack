begin;

-- A reviewed rollback build still calls the v2 finalizer. Keep that exact
-- signature usable after migration 073, but route its transaction through the
-- content-bound v3 contract. The rollback verifier proves that the supported
-- floor displays the same Terms/Privacy acknowledgement copy before this
-- compatibility wrapper may be relied upon.
create or replace function public.ap_finalize_four_step_intake_with_legal_acceptance_v2(
  p_draft_id uuid,
  p_secret_hash text,
  p_expected_version bigint,
  p_snapshot_id uuid,
  p_snapshot jsonb,
  p_content_sha256 text,
  p_sensitive_payload_id uuid,
  p_sensitive_ciphertext bytea,
  p_sensitive_encryption_algorithm text,
  p_sensitive_encrypted_data_key bytea,
  p_sensitive_nonce bytea,
  p_sensitive_authentication_tag bytea,
  p_sensitive_content_sha256 text,
  p_kms_key_identity text,
  p_kms_key_version text,
  p_encryption_context_hash text,
  p_fact_reviews jsonb,
  p_terms_version text,
  p_privacy_version text,
  p_acceptance_sha256 text
)
returns table(
  snapshot_id uuid,
  feasibility_request_id uuid,
  draft_version bigint,
  legal_acceptance_id uuid
)
language plpgsql
security definer
set search_path=''
as $$
declare configuration public.ap_commerce_configuration;
begin
  select * into configuration
  from public.ap_commerce_configuration
  where singleton
  for share;
  if not found then raise exception 'current_legal_content_unavailable'; end if;

  return query
  select result.snapshot_id,result.feasibility_request_id,result.draft_version,result.legal_acceptance_id
  from public.ap_finalize_four_step_intake_with_legal_acceptance_v3(
    p_draft_id,p_secret_hash,p_expected_version,p_snapshot_id,p_snapshot,p_content_sha256,
    p_sensitive_payload_id,p_sensitive_ciphertext,p_sensitive_encryption_algorithm,
    p_sensitive_encrypted_data_key,p_sensitive_nonce,p_sensitive_authentication_tag,
    p_sensitive_content_sha256,p_kms_key_identity,p_kms_key_version,p_encryption_context_hash,
    p_fact_reviews,p_terms_version,configuration.terms_content_sha256,
    p_privacy_version,configuration.privacy_content_sha256,
    configuration.legal_acceptance_copy_version,configuration.legal_acceptance_copy_sha256,
    configuration.legal_content_canonicalization_version,configuration.legal_receipt_schema_version,
    p_acceptance_sha256
  ) result;
end;
$$;
revoke all on function public.ap_finalize_four_step_intake_with_legal_acceptance_v2(
  uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,text,text,text
) from public,anon,authenticated;
grant execute on function public.ap_finalize_four_step_intake_with_legal_acceptance_v2(
  uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,text,text,text
) to service_role;

-- A checkout invitation can already have locked a rolling-v2 draft before
-- migration 073 arrives. Explicit re-consent must work for that state too,
-- without weakening any subject, configuration, hash, or ownership check.
create or replace function public.ap_record_snapshot_legal_content_receipt(
  p_draft_id uuid,
  p_secret_hash text,
  p_snapshot_id uuid,
  p_legal_acceptance_id uuid,
  p_terms_version text,
  p_terms_content_sha256 text,
  p_privacy_version text,
  p_privacy_content_sha256 text,
  p_acceptance_copy_version text,
  p_acceptance_copy_sha256 text,
  p_content_canonicalization_version text,
  p_receipt_schema_version text,
  p_acceptance_sha256 text
) returns uuid language plpgsql security definer set search_path='' as $$
declare configuration public.ap_commerce_configuration; receipt_id uuid;
begin
  select * into configuration from public.ap_commerce_configuration where singleton for share;
  if not found
    or p_terms_version<>configuration.terms_version
    or p_terms_content_sha256<>configuration.terms_content_sha256
    or p_privacy_version<>configuration.privacy_version
    or p_privacy_content_sha256<>configuration.privacy_content_sha256
    or p_acceptance_copy_version<>configuration.legal_acceptance_copy_version
    or p_acceptance_copy_sha256<>configuration.legal_acceptance_copy_sha256
    or p_content_canonicalization_version<>configuration.legal_content_canonicalization_version
    or p_receipt_schema_version<>configuration.legal_receipt_schema_version
  then raise exception 'current_legal_content_unavailable'; end if;
  if p_terms_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_privacy_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_acceptance_copy_sha256 !~ '^[0-9a-f]{64}$'
    or p_acceptance_sha256 !~ '^[0-9a-f]{64}$'
  then raise exception 'invalid_legal_content_receipt_hash'; end if;
  if not exists(
    select 1
    from public.ap_anonymous_drafts draft
    join public.ap_intake_snapshots snapshot
      on snapshot.id=p_snapshot_id and snapshot.draft_id=draft.id
    join public.ap_snapshot_legal_acceptances acceptance
      on acceptance.id=p_legal_acceptance_id
      and acceptance.snapshot_id=snapshot.id
      and acceptance.draft_id=draft.id
      and acceptance.terms_version=p_terms_version
      and acceptance.privacy_version=p_privacy_version
    where draft.id=p_draft_id
      and draft.capability_secret_hash=p_secret_hash
      and draft.finalized_snapshot_id=p_snapshot_id
      and draft.state in ('COMPLETE','LOCKED_TO_CHECKOUT')
      and draft.expires_at>clock_timestamp()
  ) then raise exception 'legal_content_receipt_subject_invalid'; end if;

  insert into public.ap_snapshot_legal_content_receipts(
    legal_acceptance_id,draft_id,snapshot_id,terms_version,terms_content_sha256,
    privacy_version,privacy_content_sha256,acceptance_copy_version,acceptance_copy_sha256,
    content_canonicalization_version,receipt_schema_version,acceptance_sha256
  ) values(
    p_legal_acceptance_id,p_draft_id,p_snapshot_id,p_terms_version,p_terms_content_sha256,
    p_privacy_version,p_privacy_content_sha256,p_acceptance_copy_version,p_acceptance_copy_sha256,
    p_content_canonicalization_version,p_receipt_schema_version,p_acceptance_sha256
  ) on conflict(snapshot_id) do nothing returning id into receipt_id;

  if receipt_id is null then
    select id into receipt_id
    from public.ap_snapshot_legal_content_receipts
    where legal_acceptance_id=p_legal_acceptance_id
      and draft_id=p_draft_id
      and snapshot_id=p_snapshot_id
      and terms_version=p_terms_version
      and terms_content_sha256=p_terms_content_sha256
      and privacy_version=p_privacy_version
      and privacy_content_sha256=p_privacy_content_sha256
      and acceptance_copy_version=p_acceptance_copy_version
      and acceptance_copy_sha256=p_acceptance_copy_sha256
      and content_canonicalization_version=p_content_canonicalization_version
      and receipt_schema_version=p_receipt_schema_version
      and acceptance_sha256=p_acceptance_sha256;
  end if;
  if receipt_id is null then raise exception 'snapshot_legal_content_receipt_conflict'; end if;
  return receipt_id;
end;
$$;
revoke all on function public.ap_record_snapshot_legal_content_receipt(
  uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.ap_record_snapshot_legal_content_receipt(
  uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text
) to service_role;

-- Completed or checkout-locked drafts created by a rolling v2 process are not silently
-- backfilled. The customer must explicitly accept the current rendered copy;
-- this helper appends one immutable receipt while preserving the original
-- version-only acceptance as historical evidence.
create or replace function public.ap_upgrade_completed_intake_legal_acceptance(
  p_draft_id uuid,
  p_secret_hash text,
  p_terms_version text,
  p_terms_content_sha256 text,
  p_privacy_version text,
  p_privacy_content_sha256 text,
  p_acceptance_copy_version text,
  p_acceptance_copy_sha256 text,
  p_content_canonicalization_version text,
  p_receipt_schema_version text,
  p_acceptance_sha256 text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  snapshot_id_value uuid;
  legal_acceptance_id_value uuid;
begin
  select draft.finalized_snapshot_id,acceptance.id
  into snapshot_id_value,legal_acceptance_id_value
  from public.ap_anonymous_drafts draft
  join public.ap_snapshot_legal_acceptances acceptance
    on acceptance.draft_id=draft.id
    and acceptance.snapshot_id=draft.finalized_snapshot_id
    and acceptance.terms_version=p_terms_version
    and acceptance.privacy_version=p_privacy_version
  where draft.id=p_draft_id
    and draft.capability_secret_hash=p_secret_hash
    and draft.state in ('COMPLETE','LOCKED_TO_CHECKOUT')
    and draft.finalized_snapshot_id is not null
    and draft.expires_at>clock_timestamp();
  if not found then raise exception 'completed_intake_legal_upgrade_unavailable'; end if;

  return public.ap_record_snapshot_legal_content_receipt(
    p_draft_id,p_secret_hash,snapshot_id_value,legal_acceptance_id_value,
    p_terms_version,p_terms_content_sha256,p_privacy_version,p_privacy_content_sha256,
    p_acceptance_copy_version,p_acceptance_copy_sha256,p_content_canonicalization_version,
    p_receipt_schema_version,p_acceptance_sha256
  );
end;
$$;
revoke all on function public.ap_upgrade_completed_intake_legal_acceptance(
  uuid,text,text,text,text,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.ap_upgrade_completed_intake_legal_acceptance(
  uuid,text,text,text,text,text,text,text,text,text,text
) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610040074','LEGAL_RECEIPT_ROLLBACK_COMPATIBILITY',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;
