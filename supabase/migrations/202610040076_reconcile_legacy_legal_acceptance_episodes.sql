begin;

-- Migration 074 could record a content-bound receipt against the earlier
-- version-only acceptance row. Never rewrite that immutable receipt. Append
-- the exact matching acceptance and record an immutable reconciliation link
-- so migration-075 retries can reuse the original receipt safely.
create table public.ap_legal_receipt_acceptance_reconciliations (
  receipt_id uuid primary key references public.ap_snapshot_legal_content_receipts(id),
  original_legal_acceptance_id uuid not null references public.ap_snapshot_legal_acceptances(id),
  matching_legal_acceptance_id uuid not null unique references public.ap_snapshot_legal_acceptances(id),
  reason text not null check (reason='MIGRATION_074_CONTENT_HASH_LINK'),
  reconciled_at timestamptz not null default clock_timestamp(),
  check (original_legal_acceptance_id<>matching_legal_acceptance_id)
);
create trigger ap_legal_receipt_acceptance_reconciliations_immutable
before update or delete on public.ap_legal_receipt_acceptance_reconciliations
for each row execute function public.ap_prevent_immutable_mutation();
alter table public.ap_legal_receipt_acceptance_reconciliations enable row level security;
revoke all on public.ap_legal_receipt_acceptance_reconciliations from public,anon,authenticated;
grant all on public.ap_legal_receipt_acceptance_reconciliations to service_role;

insert into public.ap_snapshot_legal_acceptances(
  draft_id,snapshot_id,terms_version,privacy_version,acceptance_sha256,accepted_at
)
select
  receipt.draft_id,receipt.snapshot_id,receipt.terms_version,receipt.privacy_version,
  receipt.acceptance_sha256,receipt.accepted_at
from public.ap_snapshot_legal_content_receipts receipt
join public.ap_snapshot_legal_acceptances original
  on original.id=receipt.legal_acceptance_id
where original.acceptance_sha256<>receipt.acceptance_sha256
on conflict(draft_id,terms_version,privacy_version,acceptance_sha256) do nothing;

insert into public.ap_legal_receipt_acceptance_reconciliations(
  receipt_id,original_legal_acceptance_id,matching_legal_acceptance_id,reason
)
select
  receipt.id,receipt.legal_acceptance_id,matching.id,'MIGRATION_074_CONTENT_HASH_LINK'
from public.ap_snapshot_legal_content_receipts receipt
join public.ap_snapshot_legal_acceptances original
  on original.id=receipt.legal_acceptance_id
join public.ap_snapshot_legal_acceptances matching
  on matching.draft_id=receipt.draft_id
  and matching.snapshot_id=receipt.snapshot_id
  and matching.terms_version=receipt.terms_version
  and matching.privacy_version=receipt.privacy_version
  and matching.acceptance_sha256=receipt.acceptance_sha256
where original.acceptance_sha256<>receipt.acceptance_sha256
on conflict(receipt_id) do nothing;

do $$
begin
  if exists(
    select 1
    from public.ap_snapshot_legal_content_receipts receipt
    join public.ap_snapshot_legal_acceptances original
      on original.id=receipt.legal_acceptance_id
    left join public.ap_legal_receipt_acceptance_reconciliations reconciliation
      on reconciliation.receipt_id=receipt.id
    where original.acceptance_sha256<>receipt.acceptance_sha256
      and reconciliation.receipt_id is null
  ) then raise exception 'legacy_legal_receipt_reconciliation_incomplete'; end if;
end;
$$;

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
  ) on conflict(snapshot_id,acceptance_sha256) do nothing returning id into receipt_id;

  if receipt_id is null then
    select receipt.id into receipt_id
    from public.ap_snapshot_legal_content_receipts receipt
    where receipt.draft_id=p_draft_id
      and receipt.snapshot_id=p_snapshot_id
      and receipt.terms_version=p_terms_version
      and receipt.terms_content_sha256=p_terms_content_sha256
      and receipt.privacy_version=p_privacy_version
      and receipt.privacy_content_sha256=p_privacy_content_sha256
      and receipt.acceptance_copy_version=p_acceptance_copy_version
      and receipt.acceptance_copy_sha256=p_acceptance_copy_sha256
      and receipt.content_canonicalization_version=p_content_canonicalization_version
      and receipt.receipt_schema_version=p_receipt_schema_version
      and receipt.acceptance_sha256=p_acceptance_sha256
      and (
        receipt.legal_acceptance_id=p_legal_acceptance_id
        or exists(
          select 1
          from public.ap_legal_receipt_acceptance_reconciliations reconciliation
          where reconciliation.receipt_id=receipt.id
            and reconciliation.original_legal_acceptance_id=receipt.legal_acceptance_id
            and reconciliation.matching_legal_acceptance_id=p_legal_acceptance_id
        )
      );
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
    join public.ap_snapshot_legal_content_receipts receipt
      on receipt.draft_id=p_draft_id
      and receipt.snapshot_id=p_snapshot_id
      and receipt.terms_version=configuration.terms_version
      and receipt.terms_content_sha256=configuration.terms_content_sha256
      and receipt.privacy_version=configuration.privacy_version
      and receipt.privacy_content_sha256=configuration.privacy_content_sha256
      and receipt.acceptance_copy_version=configuration.legal_acceptance_copy_version
      and receipt.acceptance_copy_sha256=configuration.legal_acceptance_copy_sha256
      and receipt.content_canonicalization_version=configuration.legal_content_canonicalization_version
      and receipt.receipt_schema_version=configuration.legal_receipt_schema_version
    where configuration.singleton
      and exists(
        select 1
        from public.ap_snapshot_legal_acceptances acceptance
        where acceptance.draft_id=receipt.draft_id
          and acceptance.snapshot_id=receipt.snapshot_id
          and acceptance.terms_version=receipt.terms_version
          and acceptance.privacy_version=receipt.privacy_version
          and acceptance.acceptance_sha256=receipt.acceptance_sha256
          and (
            receipt.legal_acceptance_id=acceptance.id
            or exists(
              select 1
              from public.ap_legal_receipt_acceptance_reconciliations reconciliation
              where reconciliation.receipt_id=receipt.id
                and reconciliation.original_legal_acceptance_id=receipt.legal_acceptance_id
                and reconciliation.matching_legal_acceptance_id=acceptance.id
            )
          )
      )
  );
$$;
revoke all on function public.ap_has_current_content_bound_legal_acceptance(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.ap_has_current_content_bound_legal_acceptance(uuid,uuid)
  to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values(
  '202610040076','LEGACY_LEGAL_ACCEPTANCE_EPISODE_RECONCILIATION',
  (select count(*) from public.ap_legal_receipt_acceptance_reconciliations),clock_timestamp()
)
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;
