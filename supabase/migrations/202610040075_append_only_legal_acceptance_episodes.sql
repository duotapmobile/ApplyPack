begin;

-- A finalized intake can outlive a Terms, Privacy, or acknowledgement-copy
-- revision. Preserve every prior acceptance, but allow the same immutable
-- snapshot to receive a new, separately hashed acceptance episode.
alter table public.ap_snapshot_legal_content_receipts
  drop constraint ap_snapshot_legal_content_receipts_snapshot_id_key;
alter table public.ap_snapshot_legal_acceptances
  drop constraint ap_snapshot_legal_acceptances_snapshot_id_key;
alter table public.ap_snapshot_legal_acceptances
  add constraint ap_snapshot_legal_acceptances_snapshot_hash_key
  unique(snapshot_id,acceptance_sha256);
alter table public.ap_snapshot_legal_content_receipts
  add constraint ap_snapshot_legal_content_receipts_snapshot_hash_key
  unique(snapshot_id,acceptance_sha256);

create or replace function public.ap_record_snapshot_legal_acceptance(
  p_draft_id uuid,
  p_secret_hash text,
  p_snapshot_id uuid,
  p_terms_version text,
  p_privacy_version text,
  p_acceptance_sha256 text
) returns uuid language plpgsql security definer set search_path='' as $$
declare configuration public.ap_commerce_configuration; acceptance_id uuid;
begin
  select * into configuration
  from public.ap_commerce_configuration
  where singleton
  for share;
  if not found
    or configuration.terms_version is null
    or configuration.privacy_version is null
    or p_terms_version<>configuration.terms_version
    or p_privacy_version<>configuration.privacy_version
  then raise exception 'current_legal_versions_unavailable'; end if;
  if p_acceptance_sha256 !~ '^[0-9a-f]{64}$'
  then raise exception 'invalid_legal_acceptance_hash'; end if;
  if not exists(
    select 1
    from public.ap_anonymous_drafts draft
    join public.ap_intake_snapshots snapshot
      on snapshot.id=p_snapshot_id and snapshot.draft_id=draft.id
    where draft.id=p_draft_id
      and draft.capability_secret_hash=p_secret_hash
      and draft.finalized_snapshot_id=p_snapshot_id
      and draft.state in ('COMPLETE','LOCKED_TO_CHECKOUT')
      and draft.expires_at>clock_timestamp()
  ) then raise exception 'draft_capability_invalid'; end if;

  insert into public.ap_snapshot_legal_acceptances(
    draft_id,snapshot_id,terms_version,privacy_version,acceptance_sha256
  ) values(
    p_draft_id,p_snapshot_id,p_terms_version,p_privacy_version,p_acceptance_sha256
  ) on conflict(draft_id,terms_version,privacy_version,acceptance_sha256)
    do nothing returning id into acceptance_id;

  if acceptance_id is null then
    select id into acceptance_id
    from public.ap_snapshot_legal_acceptances
    where draft_id=p_draft_id
      and snapshot_id=p_snapshot_id
      and terms_version=p_terms_version
      and privacy_version=p_privacy_version
      and acceptance_sha256=p_acceptance_sha256;
  end if;
  if acceptance_id is null then raise exception 'snapshot_legal_acceptance_conflict'; end if;
  return acceptance_id;
end;
$$;
revoke all on function public.ap_record_snapshot_legal_acceptance(
  uuid,text,uuid,text,text,text
) from public,anon,authenticated;
grant execute on function public.ap_record_snapshot_legal_acceptance(
  uuid,text,uuid,text,text,text
) to service_role;

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
  select * into configuration
  from public.ap_commerce_configuration
  where singleton
  for share;
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
      and acceptance.acceptance_sha256=p_acceptance_sha256
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
  ) on conflict(legal_acceptance_id) do nothing returning id into receipt_id;

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
  perform pg_advisory_xact_lock(hashtextextended(p_draft_id::text,0));
  select draft.finalized_snapshot_id
  into snapshot_id_value
  from public.ap_anonymous_drafts draft
  where draft.id=p_draft_id
    and draft.capability_secret_hash=p_secret_hash
    and draft.state in ('COMPLETE','LOCKED_TO_CHECKOUT')
    and draft.finalized_snapshot_id is not null
    and draft.expires_at>clock_timestamp()
  for update;
  if not found then raise exception 'completed_intake_legal_upgrade_unavailable'; end if;

  legal_acceptance_id_value:=public.ap_record_snapshot_legal_acceptance(
    p_draft_id,p_secret_hash,snapshot_id_value,p_terms_version,p_privacy_version,p_acceptance_sha256
  );
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

-- The v3 finalizer has two rolling-deploy replay branches that locate a
-- version-only acceptance before writing the content-bound receipt. Once one
-- snapshot can contain multiple immutable episodes, those branches must select
-- the episode for this exact acceptance hash instead of an older row with the
-- same public version labels. Patch the already-published definition in place
-- and fail the migration if its reviewed anchor ever drifts.
do $migration$
declare
  definition text;
  old_join text;
  new_join text;
  anchor_count integer;
begin
  old_join:=$old$    and acceptance.privacy_version=p_privacy_version
  where draft.id=p_draft_id$old$;
  new_join:=$new$    and acceptance.privacy_version=p_privacy_version
    and acceptance.acceptance_sha256=p_acceptance_sha256
  where draft.id=p_draft_id$new$;

  select pg_get_functiondef(p.oid) into definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='ap_finalize_four_step_intake_with_legal_acceptance_v3';
  definition:=replace(definition,chr(13),'');
  anchor_count:=(length(definition)-length(replace(definition,old_join,'')))/length(old_join);
  if definition is null or anchor_count<>2
  then raise exception 'append_only_legal_finalizer_anchor_missing'; end if;
  execute replace(definition,old_join,new_join);
end;
$migration$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610040075','APPEND_ONLY_LEGAL_ACCEPTANCE_EPISODES',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;
