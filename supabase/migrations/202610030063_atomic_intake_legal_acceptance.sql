-- Finalize the intake, enqueue feasibility, and record the current legal
-- acceptance in one database transaction. Exact replays return the original
-- result instead of creating another immutable snapshot.

create or replace function public.ap_finalize_four_step_intake_with_legal_acceptance(
  p_draft_id uuid,
  p_secret_hash text,
  p_expected_version bigint,
  p_snapshot_id uuid,
  p_snapshot jsonb,
  p_content_sha256 text,
  p_sensitive_payload_id uuid,
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

  select request.id, draft.version, acceptance.id
  into replay_request_id, replay_draft_version, replay_acceptance_id
  from public.ap_anonymous_drafts draft
  join public.ap_intake_snapshots snapshot
    on snapshot.id = p_snapshot_id
    and snapshot.draft_id = draft.id
    and snapshot.content_sha256 = p_content_sha256
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

revoke all on function public.ap_finalize_four_step_intake_with_legal_acceptance(
  uuid,text,bigint,uuid,jsonb,text,uuid,jsonb,text,text,text
) from public,anon,authenticated;
grant execute on function public.ap_finalize_four_step_intake_with_legal_acceptance(
  uuid,text,bigint,uuid,jsonb,text,uuid,jsonb,text,text,text
) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610030063','ATOMIC_INTAKE_LEGAL_ACCEPTANCE',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;
