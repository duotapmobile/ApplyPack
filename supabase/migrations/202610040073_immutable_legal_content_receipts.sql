begin;

-- Version labels alone cannot prove which legal text a customer accepted.
-- Pin the exact rendered legal content and acknowledgement copy in commerce
-- configuration, then store a second immutable receipt beside the historical
-- version-only receipt. Existing receipts remain untouched and auditable.
alter table public.ap_commerce_configuration
  add column terms_content_sha256 text,
  add column privacy_content_sha256 text,
  add column legal_acceptance_copy_version text,
  add column legal_acceptance_copy_sha256 text,
  add column legal_content_canonicalization_version text,
  add column legal_receipt_schema_version text;

update public.ap_commerce_configuration
set privacy_version='privacy-v1',
    terms_content_sha256='eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
    privacy_content_sha256='9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
    legal_acceptance_copy_version='applypack-legal-acceptance-copy-2026-10-04-v1',
    legal_acceptance_copy_sha256='0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283',
    legal_content_canonicalization_version='applypack-c14n-v1',
    legal_receipt_schema_version='applypack-legal-content-receipt-v1',
    updated_at=clock_timestamp()
where singleton
  and terms_version='manual-launch-terms-2026-10-02-v2'
  and (privacy_version is null or privacy_version='privacy-v1');

do $$
begin
  if not exists(
    select 1 from public.ap_commerce_configuration
    where singleton
      and terms_version='manual-launch-terms-2026-10-02-v2'
      and privacy_version='privacy-v1'
      and terms_content_sha256='eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c'
      and privacy_content_sha256='9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9'
      and legal_acceptance_copy_version='applypack-legal-acceptance-copy-2026-10-04-v1'
      and legal_acceptance_copy_sha256='0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283'
      and legal_content_canonicalization_version='applypack-c14n-v1'
      and legal_receipt_schema_version='applypack-legal-content-receipt-v1'
  ) then
    raise exception 'legal_content_configuration_version_conflict';
  end if;
end;
$$;

alter table public.ap_commerce_configuration
  alter column terms_version set not null,
  alter column privacy_version set not null,
  alter column terms_content_sha256 set not null,
  alter column privacy_content_sha256 set not null,
  alter column legal_acceptance_copy_version set not null,
  alter column legal_acceptance_copy_sha256 set not null,
  alter column legal_content_canonicalization_version set not null,
  alter column legal_receipt_schema_version set not null,
  add constraint ap_commerce_terms_content_sha256_check
    check (terms_content_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint ap_commerce_privacy_content_sha256_check
    check (privacy_content_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint ap_commerce_legal_acceptance_copy_sha256_check
    check (legal_acceptance_copy_sha256 ~ '^[0-9a-f]{64}$');

create or replace function public.ap_guard_legal_content_configuration()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if (old.terms_version is not distinct from new.terms_version)
      <> (old.terms_content_sha256 is not distinct from new.terms_content_sha256)
    then raise exception 'terms_version_and_content_hash_must_change_together'; end if;
    if (old.privacy_version is not distinct from new.privacy_version)
      <> (old.privacy_content_sha256 is not distinct from new.privacy_content_sha256)
    then raise exception 'privacy_version_and_content_hash_must_change_together'; end if;
    if (old.legal_acceptance_copy_version is not distinct from new.legal_acceptance_copy_version)
      <> (old.legal_acceptance_copy_sha256 is not distinct from new.legal_acceptance_copy_sha256)
    then raise exception 'legal_copy_version_and_hash_must_change_together'; end if;
    if (old.legal_content_canonicalization_version is distinct from new.legal_content_canonicalization_version
        or old.legal_receipt_schema_version is distinct from new.legal_receipt_schema_version)
      and old.terms_version is not distinct from new.terms_version
      and old.privacy_version is not distinct from new.privacy_version
    then raise exception 'legal_versions_must_change_with_receipt_contract'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.ap_guard_legal_content_configuration() from public,anon,authenticated;
create trigger ap_commerce_legal_content_configuration_guard
before insert or update of terms_version,privacy_version,terms_content_sha256,privacy_content_sha256,
  legal_acceptance_copy_version,legal_acceptance_copy_sha256,
  legal_content_canonicalization_version,legal_receipt_schema_version
on public.ap_commerce_configuration
for each row execute function public.ap_guard_legal_content_configuration();

create table public.ap_snapshot_legal_content_receipts (
  id uuid primary key default gen_random_uuid(),
  legal_acceptance_id uuid not null unique references public.ap_snapshot_legal_acceptances(id),
  draft_id uuid not null references public.ap_anonymous_drafts(id),
  snapshot_id uuid not null unique references public.ap_intake_snapshots(id),
  terms_version text not null,
  terms_content_sha256 text not null check (terms_content_sha256 ~ '^[0-9a-f]{64}$'),
  privacy_version text not null,
  privacy_content_sha256 text not null check (privacy_content_sha256 ~ '^[0-9a-f]{64}$'),
  acceptance_copy_version text not null,
  acceptance_copy_sha256 text not null check (acceptance_copy_sha256 ~ '^[0-9a-f]{64}$'),
  content_canonicalization_version text not null,
  receipt_schema_version text not null,
  acceptance_sha256 text not null check (acceptance_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default clock_timestamp()
);
create trigger ap_snapshot_legal_content_receipts_immutable
before update or delete on public.ap_snapshot_legal_content_receipts
for each row execute function public.ap_prevent_immutable_mutation();
alter table public.ap_snapshot_legal_content_receipts enable row level security;
revoke all on public.ap_snapshot_legal_content_receipts from public,anon,authenticated;
grant all on public.ap_snapshot_legal_content_receipts to service_role;

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
      and draft.state='COMPLETE'
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

create or replace function public.ap_has_current_content_bound_legal_acceptance(
  p_draft_id uuid,p_snapshot_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.ap_commerce_configuration configuration
    join public.ap_snapshot_legal_acceptances acceptance
      on acceptance.draft_id=p_draft_id
      and acceptance.snapshot_id=p_snapshot_id
      and acceptance.terms_version=configuration.terms_version
      and acceptance.privacy_version=configuration.privacy_version
    join public.ap_snapshot_legal_content_receipts receipt
      on receipt.legal_acceptance_id=acceptance.id
      and receipt.draft_id=acceptance.draft_id
      and receipt.snapshot_id=acceptance.snapshot_id
      and receipt.terms_version=configuration.terms_version
      and receipt.terms_content_sha256=configuration.terms_content_sha256
      and receipt.privacy_version=configuration.privacy_version
      and receipt.privacy_content_sha256=configuration.privacy_content_sha256
      and receipt.acceptance_copy_version=configuration.legal_acceptance_copy_version
      and receipt.acceptance_copy_sha256=configuration.legal_acceptance_copy_sha256
      and receipt.content_canonicalization_version=configuration.legal_content_canonicalization_version
      and receipt.receipt_schema_version=configuration.legal_receipt_schema_version
    where configuration.singleton
  );
$$;
revoke all on function public.ap_has_current_content_bound_legal_acceptance(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.ap_has_current_content_bound_legal_acceptance(uuid,uuid)
  to service_role;

create or replace function public.ap_finalize_four_step_intake_with_legal_acceptance_v3(
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
  p_terms_content_sha256 text,
  p_privacy_version text,
  p_privacy_content_sha256 text,
  p_acceptance_copy_version text,
  p_acceptance_copy_sha256 text,
  p_content_canonicalization_version text,
  p_receipt_schema_version text,
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
declare
  configuration public.ap_commerce_configuration;
  finalized record;
  replay_request_id uuid;
  replay_draft_version bigint;
  replay_acceptance_id uuid;
  content_receipt_id uuid;
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

  if p_acceptance_sha256 !~ '^[0-9a-f]{64}$'
    or p_terms_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_privacy_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_acceptance_copy_sha256 !~ '^[0-9a-f]{64}$'
  then raise exception 'invalid_legal_content_receipt_hash'; end if;

  if p_sensitive_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_snapshot->>'sensitivePayloadSha256' is distinct from p_sensitive_content_sha256
  then raise exception 'invalid_sensitive_payload_hash'; end if;

  select request.id,draft.version,acceptance.id
  into replay_request_id,replay_draft_version,replay_acceptance_id
  from public.ap_anonymous_drafts draft
  join public.ap_intake_snapshots snapshot
    on snapshot.id=p_snapshot_id
    and snapshot.draft_id=draft.id
    and snapshot.content_sha256=p_content_sha256
    and snapshot.sensitive_payload_id=p_sensitive_payload_id
  join public.ap_sensitive_payloads payload
    on payload.id=snapshot.sensitive_payload_id
    and payload.draft_id=draft.id
    and payload.content_sha256=p_sensitive_content_sha256
  join public.ap_feasibility_requests request
    on request.snapshot_id=snapshot.id
    and request.draft_id=draft.id
    and request.idempotency_key='feasibility:'||p_snapshot_id::text
  join public.ap_snapshot_legal_acceptances acceptance
    on acceptance.snapshot_id=snapshot.id
    and acceptance.draft_id=draft.id
    and acceptance.terms_version=p_terms_version
    and acceptance.privacy_version=p_privacy_version
  join public.ap_snapshot_legal_content_receipts receipt
    on receipt.legal_acceptance_id=acceptance.id
    and receipt.terms_content_sha256=p_terms_content_sha256
    and receipt.privacy_content_sha256=p_privacy_content_sha256
    and receipt.acceptance_copy_version=p_acceptance_copy_version
    and receipt.acceptance_copy_sha256=p_acceptance_copy_sha256
    and receipt.content_canonicalization_version=p_content_canonicalization_version
    and receipt.receipt_schema_version=p_receipt_schema_version
    and receipt.acceptance_sha256=p_acceptance_sha256
  where draft.id=p_draft_id
    and draft.capability_secret_hash=p_secret_hash
    and draft.finalized_snapshot_id=p_snapshot_id
    and draft.state='COMPLETE'
    and draft.expires_at>clock_timestamp();

  if found then
    return query select p_snapshot_id,replay_request_id,replay_draft_version,replay_acceptance_id;
    return;
  end if;

  -- A receipt produced by a rolling v2 instance can be upgraded without
  -- mutating it. The same active draft capability must re-present the exact
  -- finalized snapshot while the v3 route records the content-bound receipt.
  select request.id,draft.version,acceptance.id
  into replay_request_id,replay_draft_version,replay_acceptance_id
  from public.ap_anonymous_drafts draft
  join public.ap_intake_snapshots snapshot
    on snapshot.id=p_snapshot_id
    and snapshot.draft_id=draft.id
    and snapshot.content_sha256=p_content_sha256
    and snapshot.sensitive_payload_id=p_sensitive_payload_id
  join public.ap_sensitive_payloads payload
    on payload.id=snapshot.sensitive_payload_id
    and payload.draft_id=draft.id
    and payload.content_sha256=p_sensitive_content_sha256
  join public.ap_feasibility_requests request
    on request.snapshot_id=snapshot.id
    and request.draft_id=draft.id
    and request.idempotency_key='feasibility:'||p_snapshot_id::text
  join public.ap_snapshot_legal_acceptances acceptance
    on acceptance.snapshot_id=snapshot.id
    and acceptance.draft_id=draft.id
    and acceptance.terms_version=p_terms_version
    and acceptance.privacy_version=p_privacy_version
  where draft.id=p_draft_id
    and draft.capability_secret_hash=p_secret_hash
    and draft.finalized_snapshot_id=p_snapshot_id
    and draft.state='COMPLETE'
    and draft.expires_at>clock_timestamp();

  if found then
    content_receipt_id:=public.ap_record_snapshot_legal_content_receipt(
      p_draft_id,p_secret_hash,p_snapshot_id,replay_acceptance_id,
      p_terms_version,p_terms_content_sha256,p_privacy_version,p_privacy_content_sha256,
      p_acceptance_copy_version,p_acceptance_copy_sha256,p_content_canonicalization_version,
      p_receipt_schema_version,p_acceptance_sha256
    );
    return query select p_snapshot_id,replay_request_id,replay_draft_version,replay_acceptance_id;
    return;
  end if;

  if p_sensitive_ciphertext is null or octet_length(p_sensitive_ciphertext)=0
    or p_sensitive_encryption_algorithm<>'AES-256-GCM'
    or p_sensitive_encrypted_data_key is null or octet_length(p_sensitive_encrypted_data_key)=0
    or p_sensitive_nonce is null or octet_length(p_sensitive_nonce)<>12
    or p_sensitive_authentication_tag is null or octet_length(p_sensitive_authentication_tag)<>16
    or nullif(btrim(p_kms_key_identity),'') is null
    or nullif(btrim(p_kms_key_version),'') is null
    or p_encryption_context_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'invalid_sensitive_payload_envelope'; end if;

  insert into public.ap_sensitive_payloads(
    id,draft_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,
    authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash
  ) values(
    p_sensitive_payload_id,p_draft_id,p_sensitive_ciphertext,p_sensitive_encryption_algorithm,
    p_sensitive_encrypted_data_key,p_sensitive_nonce,p_sensitive_authentication_tag,
    p_sensitive_content_sha256,p_kms_key_identity,p_kms_key_version,p_encryption_context_hash
  ) on conflict(id) do nothing;

  if not exists(
    select 1 from public.ap_sensitive_payloads payload
    where payload.id=p_sensitive_payload_id
      and payload.draft_id=p_draft_id
      and payload.content_sha256=p_sensitive_content_sha256
      and payload.encryption_algorithm=p_sensitive_encryption_algorithm
      and payload.kms_key_identity=p_kms_key_identity
      and payload.kms_key_version=p_kms_key_version
      and payload.encryption_context_hash=p_encryption_context_hash
  ) then raise exception 'sensitive_payload_identity_conflict'; end if;

  -- Recheck the compatible base receipt after deterministic payload-key
  -- serialization so concurrent v2/v3 finalizations remain retry safe.
  select request.id,draft.version,acceptance.id
  into replay_request_id,replay_draft_version,replay_acceptance_id
  from public.ap_anonymous_drafts draft
  join public.ap_intake_snapshots snapshot
    on snapshot.id=p_snapshot_id
    and snapshot.draft_id=draft.id
    and snapshot.content_sha256=p_content_sha256
    and snapshot.sensitive_payload_id=p_sensitive_payload_id
  join public.ap_feasibility_requests request
    on request.snapshot_id=snapshot.id
    and request.draft_id=draft.id
    and request.idempotency_key='feasibility:'||p_snapshot_id::text
  join public.ap_snapshot_legal_acceptances acceptance
    on acceptance.snapshot_id=snapshot.id
    and acceptance.draft_id=draft.id
    and acceptance.terms_version=p_terms_version
    and acceptance.privacy_version=p_privacy_version
  where draft.id=p_draft_id
    and draft.capability_secret_hash=p_secret_hash
    and draft.finalized_snapshot_id=p_snapshot_id
    and draft.state='COMPLETE'
    and draft.expires_at>clock_timestamp();

  if found then
    content_receipt_id:=public.ap_record_snapshot_legal_content_receipt(
      p_draft_id,p_secret_hash,p_snapshot_id,replay_acceptance_id,
      p_terms_version,p_terms_content_sha256,p_privacy_version,p_privacy_content_sha256,
      p_acceptance_copy_version,p_acceptance_copy_sha256,p_content_canonicalization_version,
      p_receipt_schema_version,p_acceptance_sha256
    );
    return query select p_snapshot_id,replay_request_id,replay_draft_version,replay_acceptance_id;
    return;
  end if;

  select * into finalized
  from public.ap_finalize_four_step_intake(
    p_draft_id,p_secret_hash,p_expected_version,p_snapshot_id,p_snapshot,
    p_content_sha256,p_sensitive_payload_id,p_fact_reviews
  );

  replay_acceptance_id:=public.ap_record_snapshot_legal_acceptance(
    p_draft_id,p_secret_hash,finalized.snapshot_id,p_terms_version,p_privacy_version,p_acceptance_sha256
  );
  content_receipt_id:=public.ap_record_snapshot_legal_content_receipt(
    p_draft_id,p_secret_hash,finalized.snapshot_id,replay_acceptance_id,
    p_terms_version,p_terms_content_sha256,p_privacy_version,p_privacy_content_sha256,
    p_acceptance_copy_version,p_acceptance_copy_sha256,p_content_canonicalization_version,
    p_receipt_schema_version,p_acceptance_sha256
  );

  return query select
    finalized.snapshot_id,finalized.feasibility_request_id,finalized.draft_version,replay_acceptance_id;
end;
$$;
revoke all on function public.ap_finalize_four_step_intake_with_legal_acceptance_v3(
  uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,
  text,text,text,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.ap_finalize_four_step_intake_with_legal_acceptance_v3(
  uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,
  text,text,text,text,text,text,text,text,text
) to service_role;

-- Rebind the final checkout and feasibility predicates without copying older
-- pricing or invitation logic into a new competing function definition.
do $migration$
declare definition text; old_predicate text;
begin
  old_predicate:=$old$exists(select 1 from public.ap_snapshot_legal_acceptances l where l.snapshot_id=p_snapshot_id and l.draft_id=p_draft_id
    and l.terms_version=configuration.terms_version and l.privacy_version=configuration.privacy_version)$old$;
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ap_begin_search_checkout';
  definition:=replace(definition,chr(13),'');
  if definition is null or position(old_predicate in definition)=0
    then raise exception 'content_bound_search_checkout_anchor_missing'; end if;
  definition:=replace(definition,old_predicate,
    'public.ap_has_current_content_bound_legal_acceptance(p_draft_id,p_snapshot_id)');
  execute definition;

  old_predicate:=$old$exists(select 1 from public.ap_snapshot_legal_acceptances l where l.snapshot_id=d.finalized_snapshot_id
      and l.terms_version=configuration.terms_version and l.privacy_version=configuration.privacy_version)$old$;
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ap_read_current_feasibility';
  definition:=replace(definition,chr(13),'');
  if definition is null or position(old_predicate in definition)=0
    then raise exception 'content_bound_feasibility_anchor_missing'; end if;
  definition:=replace(definition,old_predicate,
    'public.ap_has_current_content_bound_legal_acceptance(d.id,d.finalized_snapshot_id)');
  execute definition;
end;
$migration$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610040073','IMMUTABLE_LEGAL_CONTENT_RECEIPTS',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;
