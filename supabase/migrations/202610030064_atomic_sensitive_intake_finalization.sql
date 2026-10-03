-- Store the encrypted sensitive payload, finalize the intake, enqueue
-- feasibility, and record legal acceptance in one transaction. The stable
-- caller-supplied identities make a lost-response retry return the first
-- committed result without creating another payload or snapshot.

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
set search_path = ''
as $$
declare
  configuration public.ap_commerce_configuration;
  finalized record;
  replay_request_id uuid;
  replay_draft_version bigint;
  replay_acceptance_id uuid;
begin
  select * into configuration
  from public.ap_commerce_configuration
  where singleton
  for share;

  if not found
    or configuration.terms_version is null
    or configuration.privacy_version is null
    or p_terms_version <> configuration.terms_version
    or p_privacy_version <> configuration.privacy_version
  then
    raise exception 'current_legal_versions_unavailable';
  end if;

  if p_acceptance_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_legal_acceptance_hash';
  end if;

  if p_sensitive_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_snapshot->>'sensitivePayloadSha256' is distinct from p_sensitive_content_sha256
  then
    raise exception 'invalid_sensitive_payload_hash';
  end if;

  select request.id, draft.version, acceptance.id
  into replay_request_id, replay_draft_version, replay_acceptance_id
  from public.ap_anonymous_drafts draft
  join public.ap_intake_snapshots snapshot
    on snapshot.id = p_snapshot_id
    and snapshot.draft_id = draft.id
    and snapshot.content_sha256 = p_content_sha256
    and snapshot.sensitive_payload_id = p_sensitive_payload_id
  join public.ap_sensitive_payloads payload
    on payload.id = snapshot.sensitive_payload_id
    and payload.draft_id = draft.id
    and payload.content_sha256 = p_sensitive_content_sha256
  join public.ap_feasibility_requests request
    on request.snapshot_id = snapshot.id
    and request.draft_id = draft.id
    and request.idempotency_key = 'feasibility:' || p_snapshot_id::text
  join public.ap_snapshot_legal_acceptances acceptance
    on acceptance.snapshot_id = snapshot.id
    and acceptance.draft_id = draft.id
    and acceptance.terms_version = p_terms_version
    and acceptance.privacy_version = p_privacy_version
    and acceptance.acceptance_sha256 = p_acceptance_sha256
  where draft.id = p_draft_id
    and draft.capability_secret_hash = p_secret_hash
    and draft.finalized_snapshot_id = p_snapshot_id
    and draft.state = 'COMPLETE'
    and draft.expires_at > now();

  if found then
    return query select p_snapshot_id, replay_request_id, replay_draft_version, replay_acceptance_id;
    return;
  end if;

  if p_sensitive_ciphertext is null or octet_length(p_sensitive_ciphertext) = 0
    or p_sensitive_encryption_algorithm <> 'AES-256-GCM'
    or p_sensitive_encrypted_data_key is null or octet_length(p_sensitive_encrypted_data_key) = 0
    or p_sensitive_nonce is null or octet_length(p_sensitive_nonce) <> 12
    or p_sensitive_authentication_tag is null or octet_length(p_sensitive_authentication_tag) <> 16
    or nullif(btrim(p_kms_key_identity),'') is null
    or nullif(btrim(p_kms_key_version),'') is null
    or p_encryption_context_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_sensitive_payload_envelope';
  end if;

  insert into public.ap_sensitive_payloads(
    id,draft_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,
    authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash
  ) values(
    p_sensitive_payload_id,p_draft_id,p_sensitive_ciphertext,p_sensitive_encryption_algorithm,
    p_sensitive_encrypted_data_key,p_sensitive_nonce,p_sensitive_authentication_tag,
    p_sensitive_content_sha256,p_kms_key_identity,p_kms_key_version,p_encryption_context_hash
  ) on conflict(id) do nothing;

  if not exists(
    select 1
    from public.ap_sensitive_payloads payload
    where payload.id = p_sensitive_payload_id
      and payload.draft_id = p_draft_id
      and payload.content_sha256 = p_sensitive_content_sha256
      and payload.encryption_algorithm = p_sensitive_encryption_algorithm
      and payload.kms_key_identity = p_kms_key_identity
      and payload.kms_key_version = p_kms_key_version
      and payload.encryption_context_hash = p_encryption_context_hash
  ) then
    raise exception 'sensitive_payload_identity_conflict';
  end if;

  -- A concurrent identical request can commit while this transaction waits on
  -- the deterministic payload key. Recheck replay before enforcing the stale
  -- pre-finalization draft version in the base finalizer.
  select request.id, draft.version, acceptance.id
  into replay_request_id, replay_draft_version, replay_acceptance_id
  from public.ap_anonymous_drafts draft
  join public.ap_intake_snapshots snapshot
    on snapshot.id = p_snapshot_id
    and snapshot.draft_id = draft.id
    and snapshot.content_sha256 = p_content_sha256
    and snapshot.sensitive_payload_id = p_sensitive_payload_id
  join public.ap_feasibility_requests request
    on request.snapshot_id = snapshot.id
    and request.draft_id = draft.id
    and request.idempotency_key = 'feasibility:' || p_snapshot_id::text
  join public.ap_snapshot_legal_acceptances acceptance
    on acceptance.snapshot_id = snapshot.id
    and acceptance.draft_id = draft.id
    and acceptance.terms_version = p_terms_version
    and acceptance.privacy_version = p_privacy_version
    and acceptance.acceptance_sha256 = p_acceptance_sha256
  where draft.id = p_draft_id
    and draft.capability_secret_hash = p_secret_hash
    and draft.finalized_snapshot_id = p_snapshot_id
    and draft.state = 'COMPLETE'
    and draft.expires_at > now();

  if found then
    return query select p_snapshot_id, replay_request_id, replay_draft_version, replay_acceptance_id;
    return;
  end if;

  select * into finalized
  from public.ap_finalize_four_step_intake(
    p_draft_id,
    p_secret_hash,
    p_expected_version,
    p_snapshot_id,
    p_snapshot,
    p_content_sha256,
    p_sensitive_payload_id,
    p_fact_reviews
  );

  replay_acceptance_id := public.ap_record_snapshot_legal_acceptance(
    p_draft_id,
    p_secret_hash,
    finalized.snapshot_id,
    p_terms_version,
    p_privacy_version,
    p_acceptance_sha256
  );

  return query select
    finalized.snapshot_id,
    finalized.feasibility_request_id,
    finalized.draft_version,
    replay_acceptance_id;
end;
$$;

revoke all on function public.ap_finalize_four_step_intake_with_legal_acceptance_v2(
  uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,text,text,text
) from public,anon,authenticated;
grant execute on function public.ap_finalize_four_step_intake_with_legal_acceptance_v2(
  uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,text,text,text
) to service_role;

-- The route moves to v2 in the same release. Keep the historical function for
-- migration provenance, but prevent application code from invoking the
-- pre-payload-atomic boundary.
revoke execute on function public.ap_finalize_four_step_intake_with_legal_acceptance(
  uuid,text,bigint,uuid,jsonb,text,uuid,jsonb,text,text,text
) from service_role;

-- The new wrapper is the only public-schema finalization boundary. The two
-- helpers remain service-role callable for forward repair and reconciliation,
-- but draft capabilities alone cannot invoke them through PostgREST.
revoke all on function public.ap_finalize_four_step_intake(
  uuid,text,bigint,uuid,jsonb,text,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.ap_finalize_four_step_intake(
  uuid,text,bigint,uuid,jsonb,text,uuid,jsonb
) to service_role;

revoke all on function public.ap_record_snapshot_legal_acceptance(
  uuid,text,uuid,text,text,text
) from public,anon,authenticated;
grant execute on function public.ap_record_snapshot_legal_acceptance(
  uuid,text,uuid,text,text,text
) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610030064','ATOMIC_SENSITIVE_INTAKE_FINALIZATION',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;
