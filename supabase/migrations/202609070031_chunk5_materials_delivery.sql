-- Corrected-contract Chunk 5: authenticated exact-ten portal, materials
-- readiness/commerce, immutable revisions, document QA, references, and
-- revocable secure delivery. This is additive; legacy material records remain
-- readable but are not accepted by the corrected checkout or release path.

create type public.ap_material_checkout_state as enum
  ('PREFLIGHT','BLOCKED','READY','OPEN','EXPIRED','COMPLETED','FAILED');
create type public.ap_material_proposal_kind as enum ('SUBSTITUTION','FACT_CORRECTION');
create type public.ap_material_proposal_state as enum ('PROPOSED','ACCEPTED','DECLINED','EXPIRED');
create type public.ap_reference_regeneration_state as enum
  ('REQUESTED','ACTIVE','HUMAN_REVIEW','DELIVERED','FAILED');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('operator-render-previews','operator-render-previews',false,10485760,array['application/pdf']::text[])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

alter table public.ap_commerce_configuration
  add column tax_treatment text not null default 'UNSET_BLOCKING'
    check (tax_treatment in ('UNSET_BLOCKING','TAX_INCLUSIVE_NO_ADDED_AMOUNT')),
  add column materials_rule_ttl_seconds integer
    check (materials_rule_ttl_seconds is null or materials_rule_ttl_seconds = 3600),
  add column download_ttl_seconds integer
    check (download_ttl_seconds is null or download_ttl_seconds = 900),
  add column reauthentication_window_seconds integer
    check (reauthentication_window_seconds is null or reauthentication_window_seconds = 900),
  add column materials_generation_approved boolean not null default false,
  add column materials_generation_approval_reference text,
  add column material_output_formats text[] not null default '{}'::text[]
    check (material_output_formats <@ array['DOCX','PDF']::text[] and cardinality(material_output_formats) <= 2),
  add column document_renderer_identity text,
  add column arial_font_sha256 text
    check (arial_font_sha256 is null or arial_font_sha256 ~ '^[0-9a-f]{64}$'),
  add column malware_scanner_identity text;

alter table public.ap_material_purchases
  add column checkout_intent_id uuid,
  add column completed_at timestamptz;

alter table public.ap_material_line_revisions
  add column source_snapshot_id uuid references public.ap_intake_snapshots(id),
  add column employer_rule_snapshot_id uuid,
  add column binding_sha256 text check (binding_sha256 is null or binding_sha256 ~ '^[0-9a-f]{64}$');

alter table public.ap_generated_file_versions
  add column safe_filename text,
  add column binding_sha256 text check (binding_sha256 is null or binding_sha256 ~ '^[0-9a-f]{64}$'),
  add column package_qa_sha256 text check (package_qa_sha256 is null or package_qa_sha256 ~ '^[0-9a-f]{64}$');

alter table public.ap_capacity_allocation_members
  add column member_lifecycle public.ap_capacity_lifecycle not null default 'RESERVED',
  add column member_debit_disposition public.ap_capacity_debit not null default 'HELD',
  add column superseded_at timestamptz,
  add column completed_at timestamptz;

create table public.ap_employer_submission_rules (
  id uuid primary key default gen_random_uuid(),
  job_snapshot_id uuid not null references public.ap_job_snapshots(id),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  source_evidence_ids uuid[] not null check (cardinality(source_evidence_ids) > 0),
  resume_requirement text not null check (resume_requirement in ('REQUIRED','OPTIONAL','PROHIBITED')),
  cover_letter_requirement text not null check (cover_letter_requirement in ('REQUIRED','OPTIONAL','PROHIBITED')),
  allowed_formats text[] not null check (cardinality(allowed_formats) > 0 and allowed_formats <@ array['DOCX','PDF']::text[]),
  resume_page_limit integer check (resume_page_limit is null or resume_page_limit between 1 and 2),
  cover_letter_page_limit integer check (cover_letter_page_limit is null or cover_letter_page_limit = 1),
  resume_filename_instruction text,
  cover_letter_filename_instruction text,
  reference_filename_instruction text,
  reference_timing text not null check (reference_timing in ('OPTIONAL_NOW','REQUIRED_NOW','PROHIBITED_NOW','LATER_OR_UNKNOWN')),
  reference_count integer check (reference_count is null or reference_count between 1 and 99),
  submission_channel text not null check (submission_channel in ('HTTPS_UPLOAD','EMAIL','OTHER_SUPPORTED','UNSUPPORTED')),
  portfolio_instruction text,
  work_sample_instruction text,
  application_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(application_questions) = 'array'),
  parser_version text not null,
  injection_scan_state text not null check (injection_scan_state in ('CLEAR','BLOCKED','REVIEW_REQUIRED')),
  hard_block_reason text,
  human_confirmed_by uuid not null references public.profiles(id),
  human_confirmed_at timestamptz not null,
  checked_at timestamptz not null,
  is_current boolean not null default true,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id, content_sha256),
  check ((is_current and superseded_at is null) or (not is_current and superseded_at is not null)),
  check (resume_requirement <> 'PROHIBITED' or hard_block_reason is not null),
  check (cover_letter_requirement <> 'PROHIBITED' or hard_block_reason is not null)
);
create unique index ap_current_submission_rules_per_job
  on public.ap_employer_submission_rules(job_snapshot_id) where is_current;

create table public.ap_material_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  delivered_order_id uuid not null references public.orders(id),
  delivered_release_id uuid not null references public.ap_releases(id),
  source_snapshot_id uuid not null references public.ap_intake_snapshots(id),
  contact_payload_id uuid not null references public.ap_sensitive_payloads(id),
  purchase_id uuid not null unique references public.ap_material_purchases(id),
  payment_attempt_id uuid not null unique references public.ap_payment_attempts(id),
  capacity_allocation_id uuid unique references public.ap_capacity_allocations(id),
  command_id uuid not null unique references public.ap_external_commands(id),
  request_key text not null unique,
  selection_sha256 text not null check (selection_sha256 ~ '^[0-9a-f]{64}$'),
  line_count integer not null check (line_count between 1 and 10),
  amount_cents integer not null check (amount_cents = line_count * 800),
  currency text not null check (currency = 'USD'),
  tax_inclusive boolean not null check (tax_inclusive),
  pricing_version text not null,
  tax_version text not null,
  career_break_choice text not null check (career_break_choice in
    ('KEEP_EXISTING_TIMELINE','CAREER_BREAK','FAMILY_CAREGIVING','CUSTOM_WORDING','OMIT_ENTRY')),
  career_break_custom_label text,
  cover_letter_break_consent boolean not null default false,
  document_contact_confirmed boolean not null,
  document_facts_confirmed boolean not null,
  state public.ap_material_checkout_state not null default 'PREFLIGHT',
  provider_checkout_session_id text unique,
  expires_at timestamptz,
  promoted_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((career_break_choice = 'CUSTOM_WORDING') = (career_break_custom_label is not null)),
  check (career_break_custom_label is null or length(btrim(career_break_custom_label)) between 2 and 80),
  check (state <> 'OPEN' or (provider_checkout_session_id is not null and expires_at is not null
    and capacity_allocation_id is not null and promoted_at is not null)),
  check (state <> 'COMPLETED' or completed_at is not null)
);
alter table public.ap_material_purchases
  add constraint ap_material_purchase_checkout_intent_fk
  foreign key (checkout_intent_id) references public.ap_material_checkout_intents(id);

create table public.ap_material_checkout_items (
  id uuid primary key default gen_random_uuid(),
  checkout_intent_id uuid not null references public.ap_material_checkout_intents(id),
  material_line_id uuid not null unique references public.ap_material_lines(id),
  delivered_match_id uuid not null references public.job_matches(id),
  job_snapshot_id uuid not null references public.ap_job_snapshots(id),
  submission_rule_id uuid not null references public.ap_employer_submission_rules(id),
  selected_reference_sheet boolean not null default false,
  originally_selected_reference_sheet boolean not null default false,
  emphasis_note text not null default '' check (length(emphasis_note) <= 500),
  do_not_mention_note text not null default '' check (length(do_not_mention_note) <= 500),
  readiness public.ap_material_readiness not null,
  readiness_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(readiness_reasons) = 'array'),
  created_at timestamptz not null default now(),
  unique(checkout_intent_id, delivered_match_id)
);

create table public.ap_material_checkout_references (
  checkout_item_id uuid not null references public.ap_material_checkout_items(id),
  reference_permission_id uuid not null references public.ap_reference_permissions(id),
  position integer not null check (position between 1 and 3),
  primary key(checkout_item_id, reference_permission_id),
  unique(checkout_item_id, position)
);

create table public.ap_material_listing_checks (
  id uuid primary key default gen_random_uuid(),
  material_line_id uuid not null references public.ap_material_lines(id),
  line_revision_id uuid not null references public.ap_material_line_revisions(id),
  phase text not null check (phase in ('BEFORE_CHECKOUT','BEFORE_GENERATION','BEFORE_RELEASE')),
  job_snapshot_id uuid not null references public.ap_job_snapshots(id),
  submission_rule_id uuid not null references public.ap_employer_submission_rules(id),
  result text not null check (result in ('ACTIVE','CLOSED','INSTRUCTION_BLOCKED')),
  checked_by uuid not null references public.profiles(id),
  checked_at timestamptz not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique(material_line_id, line_revision_id, phase, evidence_sha256)
);

create table public.ap_material_change_proposals (
  id uuid primary key default gen_random_uuid(),
  material_line_id uuid not null references public.ap_material_lines(id),
  parent_revision_id uuid not null references public.ap_material_line_revisions(id),
  kind public.ap_material_proposal_kind not null,
  state public.ap_material_proposal_state not null default 'PROPOSED',
  reason_code text not null,
  target_delivered_match_id uuid references public.job_matches(id),
  target_job_snapshot_id uuid references public.ap_job_snapshots(id),
  target_submission_rule_id uuid references public.ap_employer_submission_rules(id),
  corrected_snapshot_id uuid references public.ap_intake_snapshots(id),
  fact_diff jsonb check (fact_diff is null or jsonb_typeof(fact_diff) = 'object'),
  eligibility_passed boolean,
  evidence_sufficient boolean,
  estimate_seconds integer not null check (estimate_seconds > 0),
  proposal_expires_at timestamptz not null,
  accepted_at timestamptz,
  declined_at timestamptz,
  accepted_revision_id uuid references public.ap_material_line_revisions(id),
  idempotency_key text not null unique,
  acceptance_idempotency_key text unique,
  decline_idempotency_key text unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((kind = 'SUBSTITUTION') = (target_delivered_match_id is not null)),
  check ((kind = 'FACT_CORRECTION') = (corrected_snapshot_id is not null)),
  check (kind <> 'FACT_CORRECTION' or (fact_diff is not null and eligibility_passed is not null and evidence_sufficient is not null)),
  check ((state = 'ACCEPTED') = (accepted_at is not null)),
  check ((state = 'DECLINED') = (declined_at is not null))
);
create unique index ap_one_active_material_proposal
  on public.ap_material_change_proposals(material_line_id) where state = 'PROPOSED';

create table public.ap_artifact_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  file_version_id uuid not null unique references public.ap_generated_file_versions(id),
  binding_sha256 text not null check (binding_sha256 ~ '^[0-9a-f]{64}$'),
  structural_checks jsonb not null check (jsonb_typeof(structural_checks) = 'object'),
  provenance_checks jsonb not null check (jsonb_typeof(provenance_checks) = 'object'),
  extracted_text_sha256 text not null check (extracted_text_sha256 ~ '^[0-9a-f]{64}$'),
  rendered_page_count integer not null check (rendered_page_count between 1 and 2),
  renderer_identity text not null,
  arial_font_sha256 text not null check (arial_font_sha256 ~ '^[0-9a-f]{64}$'),
  malware_scanner_identity text not null,
  render_preview_bucket text not null check (render_preview_bucket='operator-render-previews'),
  render_preview_path text not null,
  render_preview_sha256 text not null check (render_preview_sha256 ~ '^[0-9a-f]{64}$'),
  rendered_page_sha256 text[] not null check (cardinality(rendered_page_sha256) between 1 and 2),
  arial_resolved boolean not null,
  automated_passed_at timestamptz,
  content_approved_by uuid references public.profiles(id),
  content_approved_at timestamptz,
  content_attestation text,
  visual_approved_by uuid references public.profiles(id),
  visual_approved_at timestamptz,
  visual_attestation text,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  check ((content_approved_at is null) = (content_approved_by is null)),
  check ((visual_approved_at is null) = (visual_approved_by is null)),
  check (content_attestation is null or length(btrim(content_attestation)) >= 20),
  check (visual_attestation is null or length(btrim(visual_attestation)) >= 20)
);

create table public.ap_reference_isolation_reviews (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.ap_document_versions(id),
  customer_id uuid not null references public.profiles(id),
  status text not null check (status in ('CLEAR','QUARANTINED','HUMAN_REVIEW_REQUIRED','FAILED_CLOSED')),
  quarantined_payload_id uuid references public.ap_sensitive_payloads(id),
  detector_version text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(document_version_id, detector_version, content_sha256),
  check (status <> 'QUARANTINED' or quarantined_payload_id is not null)
);

create table public.ap_reference_regenerations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  material_line_id uuid not null references public.ap_material_lines(id),
  prior_artifact_id uuid not null references public.ap_generated_artifacts(id),
  state public.ap_reference_regeneration_state not null default 'REQUESTED',
  attempt_number integer not null check (attempt_number > 0),
  permission_ids uuid[] not null check (cardinality(permission_ids) between 1 and 3),
  requested_at timestamptz not null,
  all_permissions_confirmed_at timestamptz not null,
  capacity_allocation_id uuid references public.ap_capacity_allocations(id),
  capacity_confirmed_at timestamptz,
  started_at timestamptz,
  due_at timestamptz,
  delivered_release_id uuid references public.ap_releases(id),
  request_key text not null unique,
  failure_code text,
  created_at timestamptz not null default now(),
  unique(material_line_id, attempt_number),
  check (started_at is null or due_at = started_at + interval '24 hours'),
  check (state <> 'ACTIVE' or (capacity_allocation_id is not null and capacity_confirmed_at is not null and started_at is not null))
);
create unique index ap_one_active_reference_regeneration
  on public.ap_reference_regenerations(material_line_id)
  where state in ('REQUESTED','ACTIVE','HUMAN_REVIEW');

alter table public.ap_generated_artifacts
  add column reference_regeneration_id uuid references public.ap_reference_regenerations(id);
create unique index ap_one_artifact_per_current_material_binding
  on public.ap_generated_artifacts(material_line_id,artifact_type,source_line_revision_id)
  where reference_regeneration_id is null;
create unique index ap_one_reference_artifact_per_regeneration
  on public.ap_generated_artifacts(reference_regeneration_id)
  where reference_regeneration_id is not null;

create table public.ap_artifact_reference_permissions (
  artifact_id uuid not null references public.ap_generated_artifacts(id),
  reference_permission_id uuid not null references public.ap_reference_permissions(id),
  position integer not null check (position between 1 and 3),
  primary key(artifact_id,reference_permission_id),
  unique(artifact_id,position)
);

create unique index ap_one_material_delivery_release_per_line
  on public.ap_releases(material_line_id)
  where release_kind in ('MATERIAL_PAIR','MATERIAL_TRIPLE');

create table public.ap_material_download_audits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  artifact_id uuid not null references public.ap_generated_artifacts(id),
  file_version_id uuid not null references public.ap_generated_file_versions(id),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  reauthenticated_at timestamptz not null,
  outcome text not null check (outcome in ('ISSUED','DENIED_REAUTH','DENIED_OWNERSHIP','DENIED_REVOKED','DENIED_STALE')),
  created_at timestamptz not null default now(),
  check (expires_at = issued_at + interval '15 minutes'),
  check (reauthenticated_at >= issued_at - interval '15 minutes')
);

create table public.ap_material_support_cases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  material_line_id uuid not null references public.ap_material_lines(id),
  artifact_id uuid not null references public.ap_generated_artifacts(id),
  sensitive_payload_id uuid not null references public.ap_sensitive_payloads(id),
  case_kind text not null check (case_kind = 'POSTDELIVERY_MATERIAL_FALSE_CLAIM'),
  state text not null default 'OPEN' check (state in ('OPEN','RESOLVED')),
  non_sensitive_fact_diff jsonb not null check (jsonb_typeof(non_sensitive_fact_diff) = 'object'),
  opened_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create view public.ap_material_purchase_status with (security_invoker=true) as
select purchase.id as purchase_id,purchase.customer_id,purchase.amount_cents,purchase.currency,
  count(line.id)::integer as line_count,
  count(line.id) filter (where line.fulfillment = 'DELIVERED')::integer as delivered_count,
  count(line.id) filter (where refund.state = 'SUCCEEDED')::integer as refunded_count,
  coalesce(sum(refund.amount_cents) filter (where refund.state = 'SUCCEEDED' and refund.superseded_at is null),0)::integer as refunded_amount_cents,
  bool_and(line.fulfillment = 'DELIVERED' or refund.state = 'SUCCEEDED') as complete
from public.ap_material_purchases purchase
join public.ap_material_lines line on line.purchase_id = purchase.id
left join public.ap_refund_operations refund on refund.material_line_id = line.id and refund.scope = 'MATERIAL_LINE' and refund.superseded_at is null
group by purchase.id,purchase.customer_id,purchase.amount_cents,purchase.currency;

create or replace function public.ap_require_material_reviewer(p_reviewer_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=p_reviewer_id and role in ('operator','admin')) then
    raise exception 'authorized_material_reviewer_required';
  end if;
  return true;
end;
$$;

create or replace function public.ap_grant_reference_permission(
  p_customer_id uuid,p_reference_version_id uuid,p_delivered_release_id uuid,
  p_job_snapshot_id uuid,p_job_snapshot_hash text,p_employer_snapshot text,
  p_exact_position_snapshot text,p_permission_text_version text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare permission_id uuid;
begin
  select permission.id into permission_id from public.ap_reference_permissions permission
  where permission.customer_id=p_customer_id
    and permission.reference_record_version_id=p_reference_version_id
    and permission.delivered_release_id=p_delivered_release_id
    and permission.job_snapshot_id=p_job_snapshot_id
    and permission.permission_text_version=p_permission_text_version
    and permission.revoked_at is null and permission.contact_version_changed_at is null;
  if permission_id is not null then return permission_id; end if;
  if p_permission_text_version<>'chunk5-exact-job-reference-v1'
    or not exists(
      select 1 from public.ap_reference_record_versions version
      join public.ap_reference_records record on record.id=version.reference_record_id
      join public.ap_job_snapshots job on job.id=p_job_snapshot_id
      join public.ap_releases release on release.id=p_delivered_release_id
      where version.id=p_reference_version_id and record.customer_id=p_customer_id
        and record.removed_at is null and version.version=record.current_version
        and version.superseded_at is null and version.permission_status='CONFIRMED'
        and job.content_sha256=p_job_snapshot_hash
        and job.company=p_employer_snapshot and job.exact_title=p_exact_position_snapshot
        and release.customer_id=p_customer_id and release.release_kind='SEARCH_EXACT_TEN'
        and release.committed_at is not null
        and exists(
          select 1 from public.ap_release_members member
          join public.job_matches match on match.id=member.member_id
          join public.ap_match_evaluations evaluation on evaluation.id=match.release_evaluation_id
          where member.release_id=release.id and member.member_type='JOB_MATCH'
            and evaluation.job_snapshot_id=job.id
        )
    ) then raise exception 'exact_job_reference_permission_invalid'; end if;
  insert into public.ap_reference_permissions(
    customer_id,reference_record_version_id,delivered_release_id,job_snapshot_id,job_snapshot_hash,
    employer_snapshot,exact_position_snapshot,permission_text_version,attested_at
  ) values(
    p_customer_id,p_reference_version_id,p_delivered_release_id,p_job_snapshot_id,p_job_snapshot_hash,
    p_employer_snapshot,p_exact_position_snapshot,p_permission_text_version,clock_timestamp()
  ) returning id into permission_id;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'REFERENCE_EXACT_JOB_PERMISSION_GRANTED','REFERENCE_PERMISSION',permission_id,
    jsonb_build_object('jobSnapshotId',p_job_snapshot_id,'deliveredReleaseId',p_delivered_release_id),'chunk5-v1');
  return permission_id;
end;
$$;

create or replace function public.ap_append_material_entitlement_state_v2(
  p_line_id uuid,p_state text,p_revision_id uuid default null,p_match_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare prior public.ap_material_entitlement_history; line_row public.ap_material_lines; next_id uuid;
begin
  if p_state not in ('OPEN','PAID','DELIVERED','REFUND_PENDING','DISPUTED','FULLY_REFUNDED','RELEASED') then
    raise exception 'invalid_material_entitlement_state';
  end if;
  select * into line_row from public.ap_material_lines where id=p_line_id for update;
  if not found then raise exception 'material_line_not_found'; end if;
  select * into prior from public.ap_material_entitlement_history
    where line_id=p_line_id order by created_at desc,id desc limit 1 for update;
  if prior.id is not null and prior.state=p_state
    and prior.delivered_match_id=coalesce(p_match_id,line_row.delivered_match_id)
    and prior.revision_id is not distinct from coalesce(p_revision_id,prior.revision_id) then return prior.id; end if;
  insert into public.ap_material_entitlement_history(
    line_id,delivered_order_id,delivered_match_id,revision_id,state,supersedes_id
  ) values(
    line_row.id,line_row.delivered_order_id,coalesce(p_match_id,line_row.delivered_match_id),
    coalesce(p_revision_id,prior.revision_id),p_state,prior.id
  ) returning id into next_id;
  if prior.id is not null then
    update public.ap_material_entitlement_claims set entitlement_history_id=next_id
      where entitlement_history_id=prior.id;
  end if;
  return next_id;
end;
$$;

create or replace function public.ap_upsert_employer_submission_rules(
  p_reviewer_id uuid,p_job_snapshot_id uuid,p_content_sha256 text,p_source_evidence_ids uuid[],
  p_resume_requirement text,p_cover_letter_requirement text,p_allowed_formats text[],
  p_resume_page_limit integer,p_cover_letter_page_limit integer,
  p_resume_filename_instruction text,p_cover_letter_filename_instruction text,p_reference_filename_instruction text,
  p_reference_timing text,p_reference_count integer,p_submission_channel text,
  p_portfolio_instruction text,p_work_sample_instruction text,p_application_questions jsonb,
  p_parser_version text,p_injection_scan_state text,p_hard_block_reason text,p_checked_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare rule_id uuid:=gen_random_uuid();
begin
  perform public.ap_require_material_reviewer(p_reviewer_id);
  if not exists(select 1 from public.ap_job_snapshots where id=p_job_snapshot_id)
    or p_content_sha256 !~ '^[0-9a-f]{64}$' or p_checked_at>clock_timestamp()
    or p_injection_scan_state<>'CLEAR'
    or coalesce(cardinality(p_source_evidence_ids),0)=0
    or cardinality(p_source_evidence_ids)<>cardinality(array(select distinct unnest(p_source_evidence_ids)))
    or exists(select 1 from unnest(p_source_evidence_ids) evidence_id where not exists(
      select 1 from public.ap_requirement_nodes evidence
      where evidence.id=evidence_id and evidence.job_snapshot_id=p_job_snapshot_id
    )) then raise exception 'submission_rules_not_confirmable'; end if;
  update public.ap_employer_submission_rules set is_current=false,superseded_at=clock_timestamp()
    where job_snapshot_id=p_job_snapshot_id and is_current;
  insert into public.ap_employer_submission_rules(
    id,job_snapshot_id,content_sha256,source_evidence_ids,resume_requirement,cover_letter_requirement,
    allowed_formats,resume_page_limit,cover_letter_page_limit,resume_filename_instruction,
    cover_letter_filename_instruction,reference_filename_instruction,reference_timing,reference_count,
    submission_channel,portfolio_instruction,work_sample_instruction,application_questions,parser_version,
    injection_scan_state,hard_block_reason,human_confirmed_by,human_confirmed_at,checked_at
  ) values(
    rule_id,p_job_snapshot_id,p_content_sha256,p_source_evidence_ids,p_resume_requirement,p_cover_letter_requirement,
    p_allowed_formats,p_resume_page_limit,p_cover_letter_page_limit,nullif(btrim(p_resume_filename_instruction),''),
    nullif(btrim(p_cover_letter_filename_instruction),''),nullif(btrim(p_reference_filename_instruction),''),
    p_reference_timing,p_reference_count,p_submission_channel,nullif(btrim(p_portfolio_instruction),''),
    nullif(btrim(p_work_sample_instruction),''),p_application_questions,p_parser_version,p_injection_scan_state,
    nullif(btrim(p_hard_block_reason),''),p_reviewer_id,clock_timestamp(),p_checked_at
  );
  insert into public.ap_audit_events(actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_reviewer_id,'EMPLOYER_SUBMISSION_RULES_CONFIRMED','JOB_SNAPSHOT',p_job_snapshot_id,
    jsonb_build_object('ruleId',rule_id,'contentSha256',p_content_sha256),'chunk5-v1');
  return rule_id;
end;
$$;

create or replace function public.ap_begin_material_checkout(
  p_customer_id uuid,p_delivered_order_id uuid,p_delivered_release_id uuid,p_source_snapshot_id uuid,
  p_contact_payload_id uuid,p_request_key text,p_selection_sha256 text,p_selections jsonb,
  p_career_break_choice text,p_career_break_custom_label text,p_cover_letter_break_consent boolean,
  p_document_contact_confirmed boolean,p_document_facts_confirmed boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare config public.ap_commerce_configuration; release_row public.ap_releases; snapshot_row public.ap_intake_snapshots;
  existing public.ap_material_checkout_intents; selection jsonb; rule_row public.ap_employer_submission_rules;
  evaluation_row public.ap_match_evaluations; job_row public.ap_job_snapshots; permission_id uuid;
  permission_row public.ap_reference_permissions; line_id uuid; revision_id uuid; entitlement_id uuid;
  intent_id uuid:=gen_random_uuid(); purchase_id uuid:=gen_random_uuid(); payment_id uuid:=gen_random_uuid();
  command_id uuid:=gen_random_uuid(); allocation_id uuid; now_at timestamptz:=clock_timestamp();
  expires_at timestamptz:=clock_timestamp()+interval '30 minutes'; line_count integer;
  reference_count integer; selected_match_ids uuid[]; members jsonb:='[]'::jsonb; item_id uuid;
  source_rule_ttl integer; input_hash text;
begin
  select * into config from public.ap_commerce_configuration where singleton for update;
  if not found or not config.checkout_enabled or not config.tax_configuration_approved
    or config.tax_approval_reference is null or config.tax_treatment<>'TAX_INCLUSIVE_NO_ADDED_AMOUNT'
    or config.material_line_price_cents<>800 or not config.tax_inclusive
    or config.currency<>'USD' or config.pricing_version is null or config.tax_version is null
    or config.payment_provider<>'stripe' or config.payment_api_version is null
    or config.immediate_payment_methods<>array['card']::text[]
    or not config.provider_idempotent_email_approved or config.provider_email_approval_reference is null
    or config.materials_rule_ttl_seconds is distinct from 3600
    or not config.materials_generation_approved
    or nullif(btrim(config.materials_generation_approval_reference),'') is null
    or cardinality(config.material_output_formats)=0
    or nullif(btrim(config.document_renderer_identity),'') is null
    or config.arial_font_sha256 is null
    or nullif(btrim(config.malware_scanner_identity),'') is null
    then raise exception 'materials_checkout_disabled_unset_blocking'; end if;
  if p_selection_sha256 !~ '^[0-9a-f]{64}$' or nullif(btrim(p_request_key),'') is null
    or jsonb_typeof(p_selections)<>'array' then raise exception 'invalid_material_checkout_request'; end if;
  line_count:=jsonb_array_length(p_selections);
  if line_count not between 1 and 10 then raise exception 'material_selection_count_invalid'; end if;
  if p_career_break_choice not in ('KEEP_EXISTING_TIMELINE','CAREER_BREAK','FAMILY_CAREGIVING','CUSTOM_WORDING','OMIT_ENTRY')
    or (p_career_break_choice='CUSTOM_WORDING') is distinct from (nullif(btrim(p_career_break_custom_label),'') is not null)
    or not p_document_contact_confirmed or not p_document_facts_confirmed
    then raise exception 'materials_customer_readiness_incomplete'; end if;
  select * into existing from public.ap_material_checkout_intents where request_key=p_request_key for update;
  if found then
    if existing.customer_id<>p_customer_id or existing.selection_sha256<>p_selection_sha256 then
      raise exception 'material_checkout_idempotency_conflict'; end if;
    return jsonb_build_object('checkoutIntentId',existing.id,'purchaseId',existing.purchase_id,
      'paymentAttemptId',existing.payment_attempt_id,'commandId',existing.command_id,
      'capacityAllocationId',existing.capacity_allocation_id,'amountCents',existing.amount_cents,
      'lineCount',existing.line_count,'expiresAt',existing.expires_at,'replayed',true);
  end if;
  select * into release_row from public.ap_releases where id=p_delivered_release_id
    and order_id=p_delivered_order_id and customer_id=p_customer_id and release_kind='SEARCH_EXACT_TEN' for update;
  if not found or (select count(*) from public.ap_release_members where release_id=release_row.id and member_type='JOB_MATCH')<>10
    then raise exception 'paid_exact_ten_release_required'; end if;
  if not exists(select 1 from public.orders where id=p_delivered_order_id and customer_id=p_customer_id and status='delivered')
    then raise exception 'delivered_order_ownership_required'; end if;
  select * into snapshot_row from public.ap_intake_snapshots where id=p_source_snapshot_id
    and customer_id=p_customer_id and finalized_at is not null;
  if not found or snapshot_row.document_contact_email is null
    or not exists(select 1 from public.ap_search_services service
      where service.legacy_order_id=p_delivered_order_id and service.customer_id=p_customer_id
        and service.original_snapshot_id=p_source_snapshot_id and service.fulfillment='DELIVERED')
    then raise exception 'document_contact_snapshot_required'; end if;
  if not exists(select 1 from public.ap_sensitive_payloads where id=p_contact_payload_id and customer_id=p_customer_id)
    then raise exception 'protected_document_contact_required'; end if;
  insert into public.ap_candidate_facts(
    id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,
    customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,
    confirmed_or_corrected_at,catalog_version,schema_version
  ) select p_contact_payload_id,p_customer_id,p_source_snapshot_id,'document_contact.confirmed',
    'PROTECTED_COMPOSITE',jsonb_build_object('protectedPayloadId',p_contact_payload_id,
      'contentSha256',payload.content_sha256),'CUSTOMER_ASSERTION',p_source_snapshot_id,
    'chunk5_document_contact_confirmation','materials_checkout','CUSTOMER_CONFIRMED',now_at,
    'chunk5-document-contact-v1','chunk5-document-contact-v1'
  from public.ap_sensitive_payloads payload where payload.id=p_contact_payload_id
  on conflict(id) do nothing;
  select array_agg((value->>'matchId')::uuid order by value->>'matchId') into selected_match_ids
    from jsonb_array_elements(p_selections);
  if cardinality(selected_match_ids)<>line_count or cardinality(array(select distinct unnest(selected_match_ids)))<>line_count
    then raise exception 'duplicate_material_selection'; end if;
  if exists(select 1 from unnest(selected_match_ids) match_id where not exists(
    select 1 from public.ap_release_members where release_id=release_row.id and member_type='JOB_MATCH' and member_id=match_id
  )) then raise exception 'material_selection_outside_delivered_release'; end if;

  input_hash:=encode(extensions.digest(convert_to(p_request_key||':'||p_selection_sha256||':'||(line_count*800)::text,'UTF8'),'sha256'),'hex');
  insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,
    provider_idempotency_key,state,lease_expires_at,reconciliation_state)
  values(command_id,p_customer_id,'CREATE_MATERIALS_CHECKOUT','stripe',input_hash,
    'materials-checkout/'||command_id::text,'CREATING',now_at+interval '5 minutes','REQUIRED');
  insert into public.ap_payment_attempts(id,customer_id,provider,amount_cents,currency,settlement,dispute)
  values(payment_id,p_customer_id,'stripe',line_count*800,'USD','UNPAID','NONE');
  insert into public.ap_material_purchases(id,customer_id,payment_attempt_id,amount_cents,currency,checkout_intent_id)
  values(purchase_id,p_customer_id,payment_id,line_count*800,'USD',null);
  insert into public.ap_material_checkout_intents(
    id,customer_id,delivered_order_id,delivered_release_id,source_snapshot_id,contact_payload_id,purchase_id,
    payment_attempt_id,command_id,request_key,selection_sha256,line_count,amount_cents,currency,tax_inclusive,
    pricing_version,tax_version,career_break_choice,career_break_custom_label,cover_letter_break_consent,
    document_contact_confirmed,document_facts_confirmed,state,expires_at
  ) values(
    intent_id,p_customer_id,p_delivered_order_id,p_delivered_release_id,p_source_snapshot_id,p_contact_payload_id,
    purchase_id,payment_id,command_id,p_request_key,p_selection_sha256,line_count,line_count*800,'USD',true,
    config.pricing_version,config.tax_version,p_career_break_choice,nullif(btrim(p_career_break_custom_label),''),
    p_cover_letter_break_consent,true,true,'READY',expires_at
  );
  update public.ap_material_purchases set checkout_intent_id=intent_id where id=purchase_id;

  for selection in select value from jsonb_array_elements(p_selections) order by value->>'matchId' loop
    if jsonb_typeof(selection)<>'object' or selection->>'lineId' is null or selection->>'revisionId' is null
      or selection->>'entitlementId' is null or selection->>'ruleId' is null
      then raise exception 'material_selection_payload_invalid'; end if;
    line_id:=(selection->>'lineId')::uuid; revision_id:=(selection->>'revisionId')::uuid;
    entitlement_id:=(selection->>'entitlementId')::uuid; item_id:=gen_random_uuid();
    select evaluation.* into evaluation_row from public.job_matches match
      join public.ap_match_evaluations evaluation on evaluation.id=match.release_evaluation_id
      where match.id=(selection->>'matchId')::uuid and match.search_order_id=p_delivered_order_id;
    if not found or evaluation_row.customer_id<>p_customer_id or evaluation_row.invalidated_at is not null
      or evaluation_row.eligibility not in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS')
      or evaluation_row.application_readiness<>'READY' or not evaluation_row.categorical_evidence_sufficient
      or 'BLOCK'=any(evaluation_row.unknown_treatments)
      or evaluation_row.resolution_issues && array['CANDIDATE_MISSING','PARSER_UNCERTAIN','EVIDENCE_CONFLICT']::public.ap_resolution_issue[]
      then raise exception 'material_candidate_gate_failed'; end if;
    select * into job_row from public.ap_job_snapshots where id=evaluation_row.job_snapshot_id;
    if not found or job_row.listing_activity_result<>'PASS' or job_row.application_path_result<>'PASS'
      or job_row.legitimacy_result<>'PASS' or job_row.live_verified_at<now_at-make_interval(secs=>config.materials_rule_ttl_seconds)
      or exists(select 1 from public.ap_job_snapshots successor where successor.supersedes_job_snapshot_id=job_row.id)
      then raise exception 'material_listing_not_current'; end if;
    select * into rule_row from public.ap_employer_submission_rules
      where id=(selection->>'ruleId')::uuid and job_snapshot_id=job_row.id and is_current for update;
    if not found or rule_row.checked_at<now_at-make_interval(secs=>config.materials_rule_ttl_seconds)
      or rule_row.injection_scan_state<>'CLEAR' or rule_row.hard_block_reason is not null
      or rule_row.resume_requirement='PROHIBITED' or rule_row.cover_letter_requirement='PROHIBITED'
      or rule_row.submission_channel='UNSUPPORTED' or not (rule_row.allowed_formats && config.material_output_formats)
      then raise exception 'employer_instructions_block_materials'; end if;
    if exists(select 1 from public.ap_material_entitlement_claims claim
      where claim.delivered_order_id=p_delivered_order_id and claim.delivered_match_id=(selection->>'matchId')::uuid)
      then raise exception 'material_match_already_claimed'; end if;
    insert into public.ap_material_lines(
      id,purchase_id,delivered_order_id,delivered_match_id,payment_attempt_id,payment_allocation_key,
      allocated_amount_cents,readiness,fulfillment,substitution,selected_reference_sheet,active_revision,
      selection_confirmed_at
    ) values(
      line_id,purchase_id,p_delivered_order_id,(selection->>'matchId')::uuid,payment_id,
      'material-payment/'||payment_id::text||'/'||(selection->>'matchId'),800,'CHECKOUT_ELIGIBLE',
      'NOT_PURCHASED','NONE',coalesce((selection->>'selectedReferenceSheet')::boolean,false),1,now_at
    );
    insert into public.ap_material_line_revisions(
      id,line_id,version,revision_kind,job_snapshot_id,source_snapshot_id,employer_rule_snapshot_id,
      binding_sha256,accepted_at
    ) values(
      revision_id,line_id,1,'ORIGINAL',job_row.id,p_source_snapshot_id,rule_row.id,
      encode(extensions.digest(convert_to(p_selection_sha256||':'||job_row.content_sha256||':'||rule_row.content_sha256,'UTF8'),'sha256'),'hex'),now_at
    );
    insert into public.ap_material_entitlement_history(
      id,line_id,delivered_order_id,delivered_match_id,revision_id,state
    ) values(entitlement_id,line_id,p_delivered_order_id,(selection->>'matchId')::uuid,revision_id,'OPEN');
    perform public.ap_claim_material_entitlement(entitlement_id);
    insert into public.ap_material_checkout_items(
      id,checkout_intent_id,material_line_id,delivered_match_id,job_snapshot_id,submission_rule_id,
      selected_reference_sheet,originally_selected_reference_sheet,emphasis_note,do_not_mention_note,readiness
    ) values(
      item_id,intent_id,line_id,(selection->>'matchId')::uuid,job_row.id,rule_row.id,
      coalesce((selection->>'selectedReferenceSheet')::boolean,false),
      coalesce((selection->>'selectedReferenceSheet')::boolean,false),left(coalesce(selection->>'emphasisNote',''),500),
      left(coalesce(selection->>'doNotMentionNote',''),500),'CHECKOUT_ELIGIBLE'
    );
    if coalesce((selection->>'selectedReferenceSheet')::boolean,false) then
      if rule_row.reference_timing='PROHIBITED_NOW' then raise exception 'reference_sheet_prohibited'; end if;
      if jsonb_typeof(selection->'referencePermissionIds')<>'array' then raise exception 'reference_permissions_required'; end if;
      reference_count:=jsonb_array_length(selection->'referencePermissionIds');
      if reference_count not between 1 and least(3,coalesce(rule_row.reference_count,3))
        or reference_count<>(select count(distinct value) from jsonb_array_elements_text(selection->'referencePermissionIds'))
        then raise exception 'reference_selection_count_invalid'; end if;
      for permission_id in select value::text::uuid from jsonb_array_elements(selection->'referencePermissionIds') loop
        select * into permission_row from public.ap_reference_permissions where id=permission_id for update;
        if not found or permission_row.customer_id<>p_customer_id or permission_row.delivered_release_id<>p_delivered_release_id
          or permission_row.job_snapshot_id<>job_row.id or permission_row.job_snapshot_hash<>job_row.content_sha256
          or permission_row.revoked_at is not null or permission_row.contact_version_changed_at is not null
          then raise exception 'exact_job_reference_permission_invalid'; end if;
        insert into public.ap_material_checkout_references(checkout_item_id,reference_permission_id,position)
        values(item_id,permission_id,(select coalesce(max(position),0)+1 from public.ap_material_checkout_references where checkout_item_id=item_id));
      end loop;
    elsif rule_row.reference_timing='REQUIRED_NOW' then raise exception 'employer_required_references_missing'; end if;
    insert into public.ap_material_listing_checks(
      material_line_id,line_revision_id,phase,job_snapshot_id,submission_rule_id,result,checked_by,checked_at,evidence_sha256
    ) values(line_id,revision_id,'BEFORE_CHECKOUT',job_row.id,rule_row.id,'ACTIVE',rule_row.human_confirmed_by,
      rule_row.checked_at,rule_row.content_sha256);
    members:=members||jsonb_build_array(jsonb_build_object('materialLineId',line_id,'revisionId',revision_id,'units',1));
  end loop;
  allocation_id:=public.ap_reserve_capacity(p_customer_id,'MATERIALS',line_count,
    'materials-checkout:'||p_request_key,expires_at,members,null);
  update public.ap_material_checkout_intents set capacity_allocation_id=allocation_id where id=intent_id;
  update public.ap_material_line_revisions revision set capacity_allocation_id=allocation_id
    where revision.line_id in (select material_line_id from public.ap_material_checkout_items where checkout_intent_id=intent_id);
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('MATERIAL_CHECKOUT_EXPIRY',intent_id,'material-checkout-expiry:'||intent_id::text,expires_at)
  on conflict(idempotency_key) do nothing;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'MATERIAL_CHECKOUT_READY','MATERIAL_CHECKOUT',intent_id,
    jsonb_build_object('lineCount',line_count,'amountCents',line_count*800,'taxInclusive',true),'chunk5-v1');
  return jsonb_build_object('checkoutIntentId',intent_id,'purchaseId',purchase_id,'paymentAttemptId',payment_id,
    'commandId',command_id,'capacityAllocationId',allocation_id,'amountCents',line_count*800,
    'lineCount',line_count,'expiresAt',expires_at,'providerIdempotencyKey','materials-checkout/'||command_id::text,
    'replayed',false);
end;
$$;

create or replace function public.ap_promote_material_checkout(
  p_checkout_intent_id uuid,p_provider_session_id text,p_provider_session_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare intent public.ap_material_checkout_intents; allocation public.ap_capacity_allocations; now_at timestamptz:=clock_timestamp();
begin
  select * into intent from public.ap_material_checkout_intents where id=p_checkout_intent_id for update;
  if not found or intent.state not in ('READY','OPEN') then raise exception 'material_checkout_not_promotable'; end if;
  if intent.state='OPEN' then return intent.provider_checkout_session_id=p_provider_session_id; end if;
  select * into allocation from public.ap_capacity_allocations where id=intent.capacity_allocation_id for update;
  if not found or allocation.lifecycle<>'RESERVED' or allocation.debit_disposition<>'HELD'
    or allocation.expires_at<=now_at or p_provider_session_expires_at>allocation.expires_at
    then raise exception 'material_checkout_capacity_expired'; end if;
  update public.ap_material_checkout_intents set state='OPEN',provider_checkout_session_id=p_provider_session_id,
    expires_at=p_provider_session_expires_at,promoted_at=now_at,updated_at=now_at where id=intent.id;
  update public.ap_payment_attempts set provider_checkout_session_id=p_provider_session_id,updated_at=now_at
    where id=intent.payment_attempt_id;
  update public.ap_external_commands set state='CREATED',provider_object_id=p_provider_session_id,
    reconciliation_state='REQUIRED',updated_at=now_at where id=intent.command_id and state='CREATING';
  return true;
end;
$$;

create or replace function public.ap_expire_material_checkout(
  p_checkout_intent_id uuid,p_reason text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare intent public.ap_material_checkout_intents; line_row public.ap_material_lines; history_row public.ap_material_entitlement_history;
  now_at timestamptz:=clock_timestamp();
begin
  select * into intent from public.ap_material_checkout_intents where id=p_checkout_intent_id for update;
  if not found then return false; end if;
  if intent.state in ('EXPIRED','FAILED') then return true; end if;
  if exists(select 1 from public.ap_payment_attempts where id=intent.payment_attempt_id and settlement='PAID')
    then raise exception 'paid_material_checkout_cannot_expire'; end if;
  if intent.state not in ('READY','OPEN','PREFLIGHT','BLOCKED') then return false; end if;
  perform public.ap_release_unconsumed_capacity(intent.capacity_allocation_id,'MATERIAL_CHECKOUT_'||upper(p_reason));
  for line_row in select line.* from public.ap_material_lines line
    join public.ap_material_checkout_items item on item.material_line_id=line.id
    where item.checkout_intent_id=intent.id order by line.id for update loop
    select * into history_row from public.ap_material_entitlement_history
      where line_id=line_row.id order by created_at desc,id desc limit 1 for update;
    if history_row.id is not null and history_row.state='OPEN' then
      insert into public.ap_material_entitlement_history(
        line_id,delivered_order_id,delivered_match_id,revision_id,state,supersedes_id
      ) values(line_row.id,line_row.delivered_order_id,line_row.delivered_match_id,history_row.revision_id,'RELEASED',history_row.id);
      delete from public.ap_material_entitlement_claims
        where delivered_order_id=line_row.delivered_order_id and delivered_match_id=line_row.delivered_match_id
          and entitlement_history_id=history_row.id;
    end if;
    update public.ap_material_lines set fulfillment='CANCELED' where id=line_row.id;
  end loop;
  update public.ap_material_checkout_intents set state='EXPIRED',failure_code=left(p_reason,100),updated_at=now_at
    where id=intent.id;
  update public.ap_external_commands set state='COMPENSATED',compensated_at=now_at,failure_code=left(p_reason,100),
    reconciliation_state='RECONCILED',updated_at=now_at where id=intent.command_id and state<>'APPLIED';
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(intent.customer_id,'MATERIAL_CHECKOUT_EXPIRED','MATERIAL_CHECKOUT',intent.id,
    jsonb_build_object('reasonCode',left(p_reason,100)),'chunk5-v1');
  return true;
end;
$$;

create or replace function public.ap_apply_verified_material_payment(
  p_provider_event_id text,p_event_type text,p_payload_sha256 text,p_signature_verified_at timestamptz,
  p_checkout_intent_id uuid,p_checkout_session_id text,p_payment_intent_id text,
  p_payment_status text,p_payment_method_type text,p_amount_cents integer,p_currency text,
  p_payer_receipt_email text,p_payment_succeeded_at timestamptz,p_outbox_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare provider_event public.ap_provider_events; intent public.ap_material_checkout_intents;
  payment public.ap_payment_attempts; allocation public.ap_capacity_allocations;
  line_row public.ap_material_lines; revision_row public.ap_material_line_revisions;
  history_id uuid; now_at timestamptz:=clock_timestamp(); started_value timestamptz; due_value timestamptz;
  valid_activation boolean:=true; refund_ids jsonb:='[]'::jsonb; refund_id uuid; result_value jsonb;
begin
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' or p_signature_verified_at is null
    or nullif(btrim(p_provider_event_id),'') is null or nullif(btrim(p_checkout_session_id),'') is null
    or nullif(btrim(p_payment_intent_id),'') is null or p_payment_status<>'paid'
    or p_payment_method_type<>'card' or p_currency<>'USD' or p_payment_succeeded_at is null
    then raise exception 'invalid_verified_material_payment'; end if;
  insert into public.ap_provider_events(provider,provider_event_id,event_type,payload_sha256,signature_verified_at)
  values('stripe',p_provider_event_id,p_event_type,p_payload_sha256,p_signature_verified_at)
  on conflict(provider_event_id) do nothing;
  if not found then
    select * into provider_event from public.ap_provider_events where provider_event_id=p_provider_event_id for update;
    if provider_event.payload_sha256<>p_payload_sha256 or provider_event.event_type<>p_event_type
      then raise exception 'provider_event_identity_conflict'; end if;
    if provider_event.applied_at is not null then return provider_event.result||jsonb_build_object('replayed',true); end if;
    raise exception 'provider_event_in_progress';
  end if;
  select * into intent from public.ap_material_checkout_intents where id=p_checkout_intent_id for update;
  if not found or intent.provider_checkout_session_id<>p_checkout_session_id
    or intent.amount_cents<>p_amount_cents or intent.currency<>p_currency
    then raise exception 'material_payment_checkout_binding_invalid'; end if;
  select * into payment from public.ap_payment_attempts where id=intent.payment_attempt_id for update;
  if payment.settlement='PAID' then
    result_value:=jsonb_build_object('checkoutIntentId',intent.id,'purchaseId',intent.purchase_id,
      'paymentAttemptId',payment.id,'state',intent.state::text,'replayed',true);
    update public.ap_provider_events set applied_at=now_at,result=result_value
      where provider_event_id=p_provider_event_id;
    return result_value;
  end if;
  if payment.settlement not in ('UNPAID','PROCESSING') or payment.amount_cents<>p_amount_cents
    then raise exception 'material_payment_attempt_invalid'; end if;
  update public.ap_payment_attempts set provider_payment_id=p_payment_intent_id,
    provider_checkout_session_id=p_checkout_session_id,provider_event_id=p_provider_event_id,
    payer_receipt_email=nullif(lower(btrim(p_payer_receipt_email)),''),
    provider_payment_status=p_payment_status,payment_method_type=p_payment_method_type,
    payment_command_id=intent.command_id,immediate_charge_verified=true,settlement='PAID',
    payment_verified_at=p_payment_succeeded_at,updated_at=now_at where id=payment.id;
  select * into allocation from public.ap_capacity_allocations where id=intent.capacity_allocation_id for update;
  valid_activation:=intent.state='OPEN' and allocation.id is not null
    and allocation.lifecycle='RESERVED' and allocation.debit_disposition='HELD'
    and allocation.expires_at>=p_payment_succeeded_at
    and not exists(
      select 1 from public.ap_material_checkout_items item
      join public.ap_material_lines line on line.id=item.material_line_id
      left join public.ap_material_entitlement_claims claim
        on claim.delivered_order_id=line.delivered_order_id and claim.delivered_match_id=line.delivered_match_id
      where item.checkout_intent_id=intent.id and (claim.entitlement_history_id is null
        or not exists(select 1 from public.ap_material_entitlement_history history
          where history.id=claim.entitlement_history_id and history.line_id=line.id and history.state='OPEN'))
    );
  if valid_activation then
    update public.ap_capacity_allocations set lifecycle='CONSUMED',debit_disposition='SPENT',
      consumed_at=now_at,updated_at=now_at where id=allocation.id;
    update public.ap_capacity_allocation_members set member_lifecycle='CONSUMED',member_debit_disposition='SPENT'
      where allocation_id=allocation.id;
    insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
    values(allocation.id,'RESERVED','CONSUMED','HELD','SPENT','VERIFIED_MATERIAL_PAYMENT');
    for line_row in select line.* from public.ap_material_lines line
      join public.ap_material_checkout_items item on item.material_line_id=line.id
      where item.checkout_intent_id=intent.id order by line.id for update loop
      started_value:=greatest(line_row.selection_confirmed_at,p_payment_succeeded_at,now_at);
      due_value:=started_value+interval '24 hours';
      update public.ap_material_lines set materials_payment_verified_at=p_payment_succeeded_at,
        materials_capacity_confirmed_at=now_at,materials_started_at=started_value,materials_due_at=due_value,
        fulfillment='PAID',readiness='CHECKOUT_ELIGIBLE' where id=line_row.id;
      select * into revision_row from public.ap_material_line_revisions
        where line_id=line_row.id and version=line_row.active_revision for update;
      update public.ap_material_line_revisions set started_at=started_value,due_at=due_value,
        capacity_allocation_id=allocation.id where id=revision_row.id;
      history_id:=public.ap_append_material_entitlement_state_v2(
        line_row.id,'PAID',revision_row.id,line_row.delivered_match_id);
      insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
      values('MATERIAL_LINE_DEADLINE',line_row.id,'material-line-deadline:'||line_row.id::text||':1',due_value)
      on conflict(idempotency_key) do nothing;
    end loop;
    update public.ap_material_checkout_intents set state='COMPLETED',completed_at=now_at,updated_at=now_at
      where id=intent.id;
    update public.ap_external_commands set state='APPLIED',applied_at=now_at,reconciliation_state='RECONCILED',
      updated_at=now_at where id=intent.command_id;
    insert into public.ap_outbox_messages(
      id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at
    ) values(p_outbox_id,intent.customer_id,intent.delivered_order_id,'MATERIALS_PAYMENT_VERIFIED',
      intent.purchase_id::text,'materials-payment:'||intent.purchase_id::text,p_outbox_id::text,'QUEUED',now_at)
    on conflict(deduplication_key) do nothing;
    insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
    select 'OUTBOX_SEND',message.id,'outbox-send:'||message.id::text,now_at
    from public.ap_outbox_messages message where message.deduplication_key='materials-payment:'||intent.purchase_id::text
    on conflict(idempotency_key) do nothing;
  else
    update public.ap_material_checkout_intents set state='FAILED',failure_code='PAID_ACTIVATION_INVALID',updated_at=now_at
      where id=intent.id;
    for line_row in select line.* from public.ap_material_lines line
      join public.ap_material_checkout_items item on item.material_line_id=line.id
      where item.checkout_intent_id=intent.id order by line.id for update loop
      update public.ap_material_lines set materials_payment_verified_at=p_payment_succeeded_at,fulfillment='CANCELED'
        where id=line_row.id;
      refund_id:=public.ap_queue_material_line_refund(payment.id,intent.customer_id,line_row.id,'PAID_ACTIVATION_INVALID');
      history_id:=public.ap_append_material_entitlement_state_v2(line_row.id,'REFUND_PENDING');
      refund_ids:=refund_ids||jsonb_build_array(refund_id);
    end loop;
  end if;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(intent.customer_id,case when valid_activation then 'MATERIAL_PAYMENT_ACTIVATED'
      else 'MATERIAL_PAYMENT_REFUND_REQUIRED' end,'MATERIAL_PURCHASE',intent.purchase_id,
    jsonb_build_object('lineCount',intent.line_count,'amountCents',intent.amount_cents,'refundIds',refund_ids),
    'chunk5-v1');
  result_value:=jsonb_build_object('checkoutIntentId',intent.id,'purchaseId',intent.purchase_id,
    'paymentAttemptId',payment.id,'state',case when valid_activation then 'MATERIALS_ACTIVE'
      else 'REFUND_PROCESSING' end,'refundIds',refund_ids,'replayed',false);
  update public.ap_provider_events set applied_at=now_at,result=result_value where provider_event_id=p_provider_event_id;
  return result_value;
end;
$$;

create or replace function public.ap_start_material_line_refund(
  p_material_line_id uuid,p_customer_id uuid,p_reason_code text,p_require_overdue boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare line_probe public.ap_material_lines; line_row public.ap_material_lines; payment public.ap_payment_attempts;
  allocation_member public.ap_capacity_allocation_members; refund_id uuid; now_at timestamptz:=clock_timestamp();
  history_id uuid;
begin
  select * into line_probe from public.ap_material_lines where id=p_material_line_id;
  if not found then raise exception 'material_line_not_found'; end if;
  select * into payment from public.ap_payment_attempts where id=line_probe.payment_attempt_id for update;
  select * into line_row from public.ap_material_lines where id=p_material_line_id for update;
  if not exists(select 1 from public.ap_material_purchases where id=line_row.purchase_id and customer_id=p_customer_id)
    or payment.customer_id<>p_customer_id or payment.settlement<>'PAID'
    then raise exception 'material_line_ownership_or_payment_invalid'; end if;
  if exists(select 1 from public.ap_releases where material_line_id=line_row.id
    and release_kind in ('MATERIAL_PAIR','MATERIAL_TRIPLE')) or line_row.fulfillment='DELIVERED' then return null; end if;
  select id into refund_id from public.ap_refund_operations where material_line_id=line_row.id
    and scope='MATERIAL_LINE' and superseded_at is null;
  if refund_id is not null then return refund_id; end if;
  if p_require_overdue and (line_row.materials_due_at is null or now_at<=line_row.materials_due_at)
    then raise exception 'material_line_not_overdue'; end if;
  if payment.dispute in ('OPEN','LOST') then raise exception 'material_refund_blocked_by_dispute'; end if;
  update public.ap_material_lines set fulfillment='CANCELED',substitution=case
    when substitution='OFFERED' then 'EXPIRED'::public.ap_material_substitution else substitution end
    where id=line_row.id;
  update public.ap_generated_file_versions file set downloads_revoked_at=coalesce(file.downloads_revoked_at,now_at)
    from public.ap_generated_artifacts artifact where file.artifact_id=artifact.id
      and artifact.material_line_id=line_row.id;
  update public.ap_artifact_quality_reviews quality set invalidated_at=coalesce(quality.invalidated_at,now_at)
    from public.ap_generated_file_versions file join public.ap_generated_artifacts artifact on artifact.id=file.artifact_id
    where quality.file_version_id=file.id and artifact.material_line_id=line_row.id;
  for allocation_member in select member.* from public.ap_capacity_allocation_members member
    where member.material_line_id=line_row.id and member.member_lifecycle in ('RESERVED','CONSUMED') for update loop
    update public.ap_capacity_allocation_members set member_lifecycle='SUPERSEDED',
      member_debit_disposition=case when allocation_member.member_debit_disposition='SPENT'
        then 'SPENT'::public.ap_capacity_debit else 'RETURNED'::public.ap_capacity_debit end,
      superseded_at=now_at where id=allocation_member.id;
  end loop;
  refund_id:=public.ap_queue_material_line_refund(payment.id,p_customer_id,line_row.id,p_reason_code);
  history_id:=public.ap_append_material_entitlement_state_v2(line_row.id,'REFUND_PENDING');
  return refund_id;
end;
$$;

create or replace function public.ap_record_material_listing_check(
  p_material_line_id uuid,p_reviewer_id uuid,p_phase text,p_result text,
  p_submission_rule_id uuid,p_evidence_sha256 text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare line_row public.ap_material_lines; revision_row public.ap_material_line_revisions;
  rule_row public.ap_employer_submission_rules; check_id uuid:=gen_random_uuid(); now_at timestamptz:=clock_timestamp();
begin
  perform public.ap_require_material_reviewer(p_reviewer_id);
  if p_phase not in ('BEFORE_GENERATION','BEFORE_RELEASE')
    or p_result not in ('ACTIVE','CLOSED','INSTRUCTION_BLOCKED')
    or p_evidence_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid_material_listing_check'; end if;
  select * into line_row from public.ap_material_lines where id=p_material_line_id for update;
  if not found or line_row.fulfillment not in ('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
    then raise exception 'active_paid_material_line_required'; end if;
  select * into revision_row from public.ap_material_line_revisions
    where line_id=line_row.id and version=line_row.active_revision for update;
  select * into rule_row from public.ap_employer_submission_rules
    where id=p_submission_rule_id and job_snapshot_id=revision_row.job_snapshot_id and is_current;
  if not found then raise exception 'current_submission_rule_required'; end if;
  if rule_row.content_sha256<>p_evidence_sha256 then raise exception 'listing_check_evidence_mismatch'; end if;
  insert into public.ap_material_listing_checks(id,material_line_id,line_revision_id,phase,job_snapshot_id,
    submission_rule_id,result,checked_by,checked_at,evidence_sha256)
  values(check_id,line_row.id,revision_row.id,p_phase,revision_row.job_snapshot_id,rule_row.id,p_result,
    p_reviewer_id,now_at,p_evidence_sha256);
  if p_result<>'ACTIVE' then
    update public.ap_material_lines set substitution='REQUIRED',fulfillment='HUMAN_REVIEW' where id=line_row.id;
    update public.ap_generated_file_versions file set superseded_at=coalesce(file.superseded_at,now_at),
      downloads_revoked_at=coalesce(file.downloads_revoked_at,now_at)
      from public.ap_generated_artifacts artifact
      where file.artifact_id=artifact.id and artifact.material_line_id=line_row.id
        and artifact.source_line_revision_id=revision_row.id;
    update public.ap_artifact_quality_reviews quality set invalidated_at=coalesce(quality.invalidated_at,now_at)
      from public.ap_generated_file_versions file join public.ap_generated_artifacts artifact on artifact.id=file.artifact_id
      where quality.file_version_id=file.id and artifact.material_line_id=line_row.id
        and artifact.source_line_revision_id=revision_row.id;
  end if;
  return check_id;
end;
$$;

create or replace function public.ap_offer_material_substitution(
  p_material_line_id uuid,p_reviewer_id uuid,p_target_match_id uuid,p_target_rule_id uuid,
  p_reason_code text,p_proposal_expires_at timestamptz,p_estimate_seconds integer,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare line_row public.ap_material_lines; purchase public.ap_material_purchases; intent public.ap_material_checkout_intents;
  revision public.ap_material_line_revisions; evaluation public.ap_match_evaluations;
  job public.ap_job_snapshots; rule_row public.ap_employer_submission_rules; proposal_id uuid:=gen_random_uuid();
  now_at timestamptz:=clock_timestamp(); existing_id uuid;
begin
  perform public.ap_require_material_reviewer(p_reviewer_id);
  select id into existing_id from public.ap_material_change_proposals where idempotency_key=p_idempotency_key;
  if existing_id is not null then return existing_id; end if;
  select * into line_row from public.ap_material_lines where id=p_material_line_id for update;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  select * into intent from public.ap_material_checkout_intents where purchase_id=purchase.id;
  select * into revision from public.ap_material_line_revisions
    where line_id=line_row.id and version=line_row.active_revision;
  if line_row.fulfillment not in ('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
    or line_row.materials_due_at is null or now_at>line_row.materials_due_at
    or p_proposal_expires_at<=now_at or p_proposal_expires_at>line_row.materials_due_at
    or exists(select 1 from public.ap_refund_operations where material_line_id=line_row.id and superseded_at is null)
    or exists(select 1 from public.ap_releases where material_line_id=line_row.id)
    then raise exception 'material_substitution_not_offerable'; end if;
  if not exists(select 1 from public.ap_release_members where release_id=intent.delivered_release_id
    and member_type='JOB_MATCH' and member_id=p_target_match_id) or p_target_match_id=line_row.delivered_match_id
    or exists(select 1 from public.ap_material_entitlement_claims where delivered_order_id=line_row.delivered_order_id
      and delivered_match_id=p_target_match_id) then raise exception 'substitution_target_unavailable'; end if;
  select evaluation_row.* into evaluation from public.job_matches match
    join public.ap_match_evaluations evaluation_row on evaluation_row.id=match.release_evaluation_id
    where match.id=p_target_match_id;
  select * into job from public.ap_job_snapshots where id=evaluation.job_snapshot_id;
  select * into rule_row from public.ap_employer_submission_rules where id=p_target_rule_id
    and job_snapshot_id=job.id and is_current;
  if evaluation.eligibility not in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS')
    or evaluation.application_readiness<>'READY' or job.listing_activity_result<>'PASS'
    or job.application_path_result<>'PASS' or job.legitimacy_result<>'PASS' or rule_row.id is null
    or rule_row.hard_block_reason is not null or rule_row.resume_requirement='PROHIBITED'
    or rule_row.cover_letter_requirement='PROHIBITED' or rule_row.injection_scan_state<>'CLEAR'
    then raise exception 'substitution_target_gate_failed'; end if;
  insert into public.ap_material_change_proposals(
    id,material_line_id,parent_revision_id,kind,state,reason_code,target_delivered_match_id,
    target_job_snapshot_id,target_submission_rule_id,estimate_seconds,proposal_expires_at,idempotency_key,created_by
  ) values(proposal_id,line_row.id,revision.id,'SUBSTITUTION','PROPOSED',p_reason_code,p_target_match_id,
    job.id,rule_row.id,p_estimate_seconds,p_proposal_expires_at,p_idempotency_key,p_reviewer_id);
  update public.ap_material_lines set substitution='OFFERED' where id=line_row.id;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(purchase.customer_id,p_reviewer_id,'MATERIAL_SUBSTITUTION_OFFERED','MATERIAL_PROPOSAL',proposal_id,
    jsonb_build_object('materialLineId',line_row.id,'proposalExpiresAt',p_proposal_expires_at,
      'estimateSeconds',p_estimate_seconds),'chunk5-v1');
  return proposal_id;
end;
$$;

create or replace function public.ap_propose_material_fact_correction(
  p_material_line_id uuid,p_reviewer_id uuid,p_corrected_snapshot_id uuid,p_fact_diff jsonb,
  p_eligibility_passed boolean,p_evidence_sufficient boolean,p_reason_code text,
  p_proposal_expires_at timestamptz,p_estimate_seconds integer,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare line_row public.ap_material_lines; purchase public.ap_material_purchases;
  revision public.ap_material_line_revisions; proposal_id uuid:=gen_random_uuid();
  existing_id uuid; now_at timestamptz:=clock_timestamp();
begin
  perform public.ap_require_material_reviewer(p_reviewer_id);
  select id into existing_id from public.ap_material_change_proposals where idempotency_key=p_idempotency_key;
  if existing_id is not null then return existing_id; end if;
  select * into line_row from public.ap_material_lines where id=p_material_line_id for update;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  select * into revision from public.ap_material_line_revisions
    where line_id=line_row.id and version=line_row.active_revision;
  if jsonb_typeof(p_fact_diff)<>'object' or p_fact_diff='{}'::jsonb
    or line_row.fulfillment not in ('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
    or line_row.materials_due_at is null or now_at>line_row.materials_due_at
    or p_proposal_expires_at<=now_at or p_proposal_expires_at>line_row.materials_due_at
    or exists(select 1 from public.ap_releases where material_line_id=line_row.id)
    or exists(select 1 from public.ap_refund_operations where material_line_id=line_row.id and superseded_at is null)
    or not exists(select 1 from public.ap_intake_snapshots where id=p_corrected_snapshot_id
      and customer_id=purchase.customer_id and parent_snapshot_id=revision.source_snapshot_id
      and snapshot_kind='MATERIAL_FACT_REVISION')
    then raise exception 'material_fact_correction_not_proposable'; end if;
  update public.ap_generated_file_versions file set superseded_at=coalesce(file.superseded_at,now_at),
    downloads_revoked_at=coalesce(file.downloads_revoked_at,now_at)
    from public.ap_generated_artifacts artifact where file.artifact_id=artifact.id
      and artifact.material_line_id=line_row.id and artifact.source_line_revision_id=revision.id;
  update public.ap_artifact_quality_reviews quality set invalidated_at=coalesce(quality.invalidated_at,now_at)
    from public.ap_generated_file_versions file join public.ap_generated_artifacts artifact on artifact.id=file.artifact_id
    where quality.file_version_id=file.id and artifact.material_line_id=line_row.id
      and artifact.source_line_revision_id=revision.id;
  insert into public.ap_material_change_proposals(
    id,material_line_id,parent_revision_id,kind,state,reason_code,corrected_snapshot_id,fact_diff,
    eligibility_passed,evidence_sufficient,estimate_seconds,proposal_expires_at,idempotency_key,created_by
  ) values(proposal_id,line_row.id,revision.id,'FACT_CORRECTION','PROPOSED',p_reason_code,
    p_corrected_snapshot_id,p_fact_diff,p_eligibility_passed,p_evidence_sufficient,p_estimate_seconds,
    p_proposal_expires_at,p_idempotency_key,p_reviewer_id);
  update public.ap_material_lines set fulfillment='HUMAN_REVIEW' where id=line_row.id;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(purchase.customer_id,p_reviewer_id,'MATERIAL_FACT_CORRECTION_PROPOSED','MATERIAL_PROPOSAL',proposal_id,
    jsonb_build_object('materialLineId',line_row.id,'factDiff',p_fact_diff,'eligibilityPassed',
      p_eligibility_passed,'evidenceSufficient',p_evidence_sufficient,
      'proposalExpiresAt',p_proposal_expires_at,'estimateSeconds',p_estimate_seconds),'chunk5-v1');
  return proposal_id;
end;
$$;

create or replace function public.ap_consume_material_revision_capacity(
  p_customer_id uuid,p_material_line_id uuid,p_revision_id uuid,p_request_key text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare allocation_id uuid; allocation public.ap_capacity_allocations; now_at timestamptz:=clock_timestamp();
begin
  allocation_id:=public.ap_reserve_capacity(p_customer_id,'MATERIALS',1,p_request_key,
    now_at+interval '30 minutes',
    jsonb_build_array(jsonb_build_object('materialLineId',p_material_line_id,'revisionId',p_revision_id,'units',1)),null);
  select * into allocation from public.ap_capacity_allocations where id=allocation_id for update;
  update public.ap_capacity_allocations set lifecycle='CONSUMED',debit_disposition='SPENT',
    consumed_at=now_at,updated_at=now_at where id=allocation.id;
  update public.ap_capacity_allocation_members set member_lifecycle='CONSUMED',
    member_debit_disposition='SPENT' where allocation_id=allocation.id;
  insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
  values(allocation.id,'RESERVED','CONSUMED','HELD','SPENT','MATERIAL_REVISION_ACCEPTED');
  return allocation.id;
end;
$$;

create or replace function public.ap_accept_material_substitution(
  p_proposal_id uuid,p_customer_id uuid,p_capacity_request_key text,p_include_reference_sheet boolean,
  p_reference_permission_ids uuid[],p_acceptance_idempotency_key text,p_outbox_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare proposal public.ap_material_change_proposals; line_probe public.ap_material_lines;
  line_row public.ap_material_lines; payment public.ap_payment_attempts; purchase public.ap_material_purchases;
  intent public.ap_material_checkout_intents; prior_revision public.ap_material_line_revisions;
  target_rule public.ap_employer_submission_rules; target_job public.ap_job_snapshots;
  new_revision_id uuid:=gen_random_uuid(); new_history_id uuid; allocation_id uuid;
  permission_id uuid; permission public.ap_reference_permissions; selected_item_id uuid;
  now_at timestamptz:=clock_timestamp(); started_value timestamptz; due_value timestamptz;
begin
  select * into proposal from public.ap_material_change_proposals where id=p_proposal_id for update;
  if not found or proposal.kind<>'SUBSTITUTION' then raise exception 'substitution_proposal_not_found'; end if;
  if proposal.state='ACCEPTED' then
    return jsonb_build_object('proposalId',proposal.id,'revisionId',proposal.accepted_revision_id,
      'acceptedAt',proposal.accepted_at,'replayed',true);
  end if;
  select * into line_probe from public.ap_material_lines where id=proposal.material_line_id;
  select * into payment from public.ap_payment_attempts where id=line_probe.payment_attempt_id for update;
  select * into line_row from public.ap_material_lines where id=line_probe.id for update;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  select * into intent from public.ap_material_checkout_intents where purchase_id=purchase.id;
  select id into selected_item_id from public.ap_material_checkout_items where material_line_id=line_row.id;
  select * into prior_revision from public.ap_material_line_revisions
    where line_id=line_row.id and version=line_row.active_revision for update;
  if purchase.customer_id<>p_customer_id or payment.customer_id<>p_customer_id or payment.settlement<>'PAID'
    or payment.dispute in ('OPEN','LOST') or proposal.state<>'PROPOSED'
    or proposal.parent_revision_id<>prior_revision.id or proposal.proposal_expires_at<now_at
    or line_row.materials_due_at is null or now_at>line_row.materials_due_at
    or line_row.fulfillment not in ('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
    or exists(select 1 from public.ap_refund_operations where material_line_id=line_row.id and superseded_at is null)
    or exists(select 1 from public.ap_releases where material_line_id=line_row.id)
    then raise exception 'substitution_acceptance_not_allowed'; end if;
  if exists(select 1 from public.ap_material_entitlement_claims
    where delivered_order_id=line_row.delivered_order_id and delivered_match_id=proposal.target_delivered_match_id)
    then raise exception 'substitution_target_already_claimed'; end if;
  select * into target_job from public.ap_job_snapshots where id=proposal.target_job_snapshot_id;
  select * into target_rule from public.ap_employer_submission_rules
    where id=proposal.target_submission_rule_id and job_snapshot_id=target_job.id and is_current;
  if target_job.listing_activity_result<>'PASS' or target_job.application_path_result<>'PASS'
    or target_job.legitimacy_result<>'PASS' or target_rule.id is null or target_rule.hard_block_reason is not null
    or target_rule.resume_requirement='PROHIBITED' or target_rule.cover_letter_requirement='PROHIBITED'
    or target_rule.injection_scan_state<>'CLEAR' then raise exception 'substitution_target_no_longer_eligible'; end if;
  if p_include_reference_sheet then
    if not exists(select 1 from public.ap_material_checkout_items
        where id=selected_item_id and originally_selected_reference_sheet)
      or target_rule.reference_timing='PROHIBITED_NOW'
      or coalesce(cardinality(p_reference_permission_ids),0) not between 1 and least(3,coalesce(target_rule.reference_count,3))
      or cardinality(p_reference_permission_ids)<>cardinality(array(select distinct unnest(p_reference_permission_ids)))
      then raise exception 'substitution_reference_scope_invalid'; end if;
    foreach permission_id in array p_reference_permission_ids loop
      select * into permission from public.ap_reference_permissions where id=permission_id for update;
      if not found or permission.customer_id<>p_customer_id or permission.delivered_release_id<>intent.delivered_release_id
        or permission.job_snapshot_id<>target_job.id or permission.job_snapshot_hash<>target_job.content_sha256
        or permission.revoked_at is not null or permission.contact_version_changed_at is not null
        then raise exception 'substitution_reference_permission_invalid'; end if;
    end loop;
  elsif target_rule.reference_timing='REQUIRED_NOW' then raise exception 'substitution_required_references_missing'; end if;
  insert into public.ap_material_line_revisions(
    id,line_id,version,revision_kind,parent_revision_id,job_snapshot_id,source_snapshot_id,
    employer_rule_snapshot_id,reference_scope,binding_sha256,accepted_at
  ) values(
    new_revision_id,line_row.id,line_row.active_revision+1,'SUBSTITUTION',prior_revision.id,target_job.id,
    prior_revision.source_snapshot_id,target_rule.id,
    jsonb_build_object('selected',p_include_reference_sheet,'permissionIds',coalesce(to_jsonb(p_reference_permission_ids),'[]'::jsonb)),
    encode(extensions.digest(convert_to(prior_revision.binding_sha256||':'||target_job.content_sha256||':'||
      target_rule.content_sha256||':'||p_acceptance_idempotency_key,'UTF8'),'sha256'),'hex'),now_at
  );
  allocation_id:=public.ap_consume_material_revision_capacity(
    p_customer_id,line_row.id,new_revision_id,p_capacity_request_key);
  started_value:=greatest(now_at,payment.payment_verified_at,
    (select consumed_at from public.ap_capacity_allocations where id=allocation_id));
  due_value:=started_value+interval '24 hours';
  update public.ap_material_line_revisions set capacity_allocation_id=allocation_id,
    started_at=started_value,due_at=due_value where id=new_revision_id;
  update public.ap_material_line_revisions set superseded_at=now_at where id=prior_revision.id;
  update public.ap_capacity_allocation_members set member_lifecycle='SUPERSEDED',
    member_debit_disposition=case when member_debit_disposition='SPENT'
      then 'SPENT'::public.ap_capacity_debit else 'RETURNED'::public.ap_capacity_debit end,
    superseded_at=now_at where revision_id=prior_revision.id and member_lifecycle in ('RESERVED','CONSUMED');
  update public.ap_generated_file_versions file set superseded_at=coalesce(file.superseded_at,now_at),
    downloads_revoked_at=coalesce(file.downloads_revoked_at,now_at)
    from public.ap_generated_artifacts artifact where file.artifact_id=artifact.id
      and artifact.material_line_id=line_row.id and artifact.source_line_revision_id=prior_revision.id;
  update public.ap_artifact_quality_reviews quality set invalidated_at=coalesce(quality.invalidated_at,now_at)
    from public.ap_generated_file_versions file join public.ap_generated_artifacts artifact on artifact.id=file.artifact_id
    where quality.file_version_id=file.id and artifact.material_line_id=line_row.id
      and artifact.source_line_revision_id=prior_revision.id;
  new_history_id:=public.ap_append_material_entitlement_state_v2(
    line_row.id,'RELEASED',prior_revision.id,line_row.delivered_match_id);
  delete from public.ap_material_entitlement_claims
    where delivered_order_id=line_row.delivered_order_id and delivered_match_id=line_row.delivered_match_id;
  update public.ap_material_lines set delivered_match_id=proposal.target_delivered_match_id,
    selected_reference_sheet=p_include_reference_sheet,active_revision=line_row.active_revision+1,
    substitution='ACCEPTED',fulfillment='PAID',materials_capacity_confirmed_at=started_value,
    materials_started_at=started_value,materials_due_at=due_value where id=line_row.id;
  new_history_id:=public.ap_append_material_entitlement_state_v2(
    line_row.id,'PAID',new_revision_id,proposal.target_delivered_match_id);
  perform public.ap_claim_material_entitlement(new_history_id);
  delete from public.ap_material_checkout_references where checkout_item_id=selected_item_id;
  if p_include_reference_sheet then
    foreach permission_id in array p_reference_permission_ids loop
      insert into public.ap_material_checkout_references(checkout_item_id,reference_permission_id,position)
      values(selected_item_id,permission_id,
        (select coalesce(max(position),0)+1 from public.ap_material_checkout_references where checkout_item_id=selected_item_id));
    end loop;
  end if;
  update public.ap_material_checkout_items set delivered_match_id=proposal.target_delivered_match_id,
    job_snapshot_id=target_job.id,submission_rule_id=target_rule.id,
    selected_reference_sheet=p_include_reference_sheet where id=selected_item_id;
  update public.ap_material_change_proposals set state='ACCEPTED',accepted_at=now_at,
    accepted_revision_id=new_revision_id,acceptance_idempotency_key=p_acceptance_idempotency_key where id=proposal.id;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('MATERIAL_LINE_DEADLINE',line_row.id,
    'material-line-deadline:'||line_row.id::text||':'||(line_row.active_revision+1)::text,due_value);
  insert into public.ap_outbox_messages(
    id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at
  ) values(p_outbox_id,p_customer_id,line_row.delivered_order_id,'MATERIAL_SUBSTITUTION_ACCEPTED',
    line_row.id::text,'material-substitution:'||proposal.id::text,p_outbox_id::text,'QUEUED',now_at)
  on conflict(deduplication_key) do nothing;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('OUTBOX_SEND',p_outbox_id,'outbox-send:'||p_outbox_id::text,now_at)
  on conflict(idempotency_key) do nothing;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'MATERIAL_SUBSTITUTION_ACCEPTED','MATERIAL_PROPOSAL',proposal.id,
    jsonb_build_object('revisionId',new_revision_id,'startedAt',started_value,'dueAt',due_value,
      'referenceSheetSelected',p_include_reference_sheet),'chunk5-v1');
  return jsonb_build_object('proposalId',proposal.id,'revisionId',new_revision_id,
    'startedAt',started_value,'dueAt',due_value,'replayed',false);
end;
$$;

create or replace function public.ap_accept_material_fact_correction(
  p_proposal_id uuid,p_customer_id uuid,p_capacity_request_key text,
  p_acceptance_idempotency_key text,p_outbox_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare proposal public.ap_material_change_proposals; line_probe public.ap_material_lines;
  line_row public.ap_material_lines; payment public.ap_payment_attempts; purchase public.ap_material_purchases;
  prior_revision public.ap_material_line_revisions; rule_row public.ap_employer_submission_rules;
  job_row public.ap_job_snapshots; new_revision_id uuid:=gen_random_uuid(); new_history_id uuid;
  allocation_id uuid; now_at timestamptz:=clock_timestamp(); started_value timestamptz; due_value timestamptz;
begin
  select * into proposal from public.ap_material_change_proposals where id=p_proposal_id for update;
  if not found or proposal.kind<>'FACT_CORRECTION' then raise exception 'fact_correction_proposal_not_found'; end if;
  if proposal.state='ACCEPTED' then
    return jsonb_build_object('proposalId',proposal.id,'revisionId',proposal.accepted_revision_id,
      'acceptedAt',proposal.accepted_at,'replayed',true);
  end if;
  select * into line_probe from public.ap_material_lines where id=proposal.material_line_id;
  select * into payment from public.ap_payment_attempts where id=line_probe.payment_attempt_id for update;
  select * into line_row from public.ap_material_lines where id=line_probe.id for update;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  select * into prior_revision from public.ap_material_line_revisions
    where line_id=line_row.id and version=line_row.active_revision for update;
  select * into job_row from public.ap_job_snapshots where id=prior_revision.job_snapshot_id;
  select * into rule_row from public.ap_employer_submission_rules
    where id=prior_revision.employer_rule_snapshot_id and job_snapshot_id=job_row.id and is_current;
  if purchase.customer_id<>p_customer_id or payment.customer_id<>p_customer_id or payment.settlement<>'PAID'
    or payment.dispute in ('OPEN','LOST') or proposal.state<>'PROPOSED'
    or proposal.parent_revision_id<>prior_revision.id or proposal.proposal_expires_at<now_at
    or line_row.materials_due_at is null or now_at>line_row.materials_due_at
    or line_row.fulfillment not in ('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
    or not proposal.eligibility_passed or not proposal.evidence_sufficient or rule_row.id is null
    or exists(select 1 from public.ap_refund_operations where material_line_id=line_row.id and superseded_at is null)
    or exists(select 1 from public.ap_releases where material_line_id=line_row.id)
    then raise exception 'fact_correction_acceptance_not_allowed'; end if;
  insert into public.ap_material_line_revisions(
    id,line_id,version,revision_kind,parent_revision_id,job_snapshot_id,source_snapshot_id,
    employer_rule_snapshot_id,fact_diff,reference_scope,binding_sha256,accepted_at
  ) values(
    new_revision_id,line_row.id,line_row.active_revision+1,'FACT_CORRECTION',prior_revision.id,
    prior_revision.job_snapshot_id,proposal.corrected_snapshot_id,rule_row.id,proposal.fact_diff,
    prior_revision.reference_scope,
    encode(extensions.digest(convert_to(prior_revision.binding_sha256||':'||proposal.corrected_snapshot_id::text||
      ':'||p_acceptance_idempotency_key,'UTF8'),'sha256'),'hex'),now_at
  );
  allocation_id:=public.ap_consume_material_revision_capacity(
    p_customer_id,line_row.id,new_revision_id,p_capacity_request_key);
  started_value:=greatest(now_at,payment.payment_verified_at,
    (select consumed_at from public.ap_capacity_allocations where id=allocation_id));
  due_value:=started_value+interval '24 hours';
  update public.ap_material_line_revisions set capacity_allocation_id=allocation_id,
    started_at=started_value,due_at=due_value where id=new_revision_id;
  update public.ap_material_line_revisions set superseded_at=now_at where id=prior_revision.id;
  update public.ap_capacity_allocation_members set member_lifecycle='SUPERSEDED',
    member_debit_disposition=case when member_debit_disposition='SPENT'
      then 'SPENT'::public.ap_capacity_debit else 'RETURNED'::public.ap_capacity_debit end,
    superseded_at=now_at where revision_id=prior_revision.id and member_lifecycle in ('RESERVED','CONSUMED');
  update public.ap_generated_file_versions file set superseded_at=coalesce(file.superseded_at,now_at),
    downloads_revoked_at=coalesce(file.downloads_revoked_at,now_at)
    from public.ap_generated_artifacts artifact where file.artifact_id=artifact.id
      and artifact.material_line_id=line_row.id and artifact.source_line_revision_id=prior_revision.id;
  update public.ap_artifact_quality_reviews quality set invalidated_at=coalesce(quality.invalidated_at,now_at)
    from public.ap_generated_file_versions file join public.ap_generated_artifacts artifact on artifact.id=file.artifact_id
    where quality.file_version_id=file.id and artifact.material_line_id=line_row.id
      and artifact.source_line_revision_id=prior_revision.id;
  update public.ap_material_lines set active_revision=line_row.active_revision+1,fulfillment='PAID',
    materials_capacity_confirmed_at=started_value,materials_started_at=started_value,materials_due_at=due_value
    where id=line_row.id;
  new_history_id:=public.ap_append_material_entitlement_state_v2(
    line_row.id,'PAID',new_revision_id,line_row.delivered_match_id);
  update public.ap_material_change_proposals set state='ACCEPTED',accepted_at=now_at,
    accepted_revision_id=new_revision_id,acceptance_idempotency_key=p_acceptance_idempotency_key
    where id=proposal.id;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('MATERIAL_LINE_DEADLINE',line_row.id,
    'material-line-deadline:'||line_row.id::text||':'||(line_row.active_revision+1)::text,due_value);
  insert into public.ap_outbox_messages(
    id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at
  ) values(p_outbox_id,p_customer_id,line_row.delivered_order_id,'MATERIAL_FACT_REVISION_ACCEPTED',
    line_row.id::text,'material-fact-revision:'||proposal.id::text,p_outbox_id::text,'QUEUED',now_at)
  on conflict(deduplication_key) do nothing;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('OUTBOX_SEND',p_outbox_id,'outbox-send:'||p_outbox_id::text,now_at)
  on conflict(idempotency_key) do nothing;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'MATERIAL_FACT_CORRECTION_ACCEPTED','MATERIAL_PROPOSAL',proposal.id,
    jsonb_build_object('revisionId',new_revision_id,'factDiff',proposal.fact_diff,
      'startedAt',started_value,'dueAt',due_value),'chunk5-v1');
  return jsonb_build_object('proposalId',proposal.id,'revisionId',new_revision_id,
    'startedAt',started_value,'dueAt',due_value,'replayed',false);
end;
$$;

create or replace function public.ap_decline_material_change(
  p_proposal_id uuid,p_customer_id uuid,p_decline_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare proposal public.ap_material_change_proposals; line_row public.ap_material_lines;
  purchase public.ap_material_purchases; refund_id uuid; now_at timestamptz:=clock_timestamp();
begin
  select * into proposal from public.ap_material_change_proposals where id=p_proposal_id for update;
  if not found then raise exception 'material_proposal_not_found'; end if;
  if proposal.state='DECLINED' then
    return jsonb_build_object('proposalId',proposal.id,'state','DECLINED','replayed',true);
  end if;
  select * into line_row from public.ap_material_lines where id=proposal.material_line_id;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  if purchase.customer_id<>p_customer_id or proposal.state<>'PROPOSED'
    then raise exception 'material_proposal_not_declinable'; end if;
  update public.ap_material_change_proposals set state='DECLINED',declined_at=now_at,
    decline_idempotency_key=p_decline_idempotency_key where id=proposal.id;
  update public.ap_material_lines set substitution=case when proposal.kind='SUBSTITUTION'
    then 'DECLINED'::public.ap_material_substitution else substitution end where id=line_row.id;
  refund_id:=public.ap_start_material_line_refund(line_row.id,p_customer_id,
    case when proposal.kind='SUBSTITUTION' then 'SUBSTITUTION_DECLINED' else 'FACT_CORRECTION_DECLINED' end,false);
  return jsonb_build_object('proposalId',proposal.id,'state','DECLINED','refundId',refund_id,'replayed',false);
end;
$$;

create or replace function public.ap_expire_material_change(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare proposal public.ap_material_change_proposals; line_row public.ap_material_lines;
  purchase public.ap_material_purchases; refund_id uuid; now_at timestamptz:=clock_timestamp();
begin
  select * into proposal from public.ap_material_change_proposals where id=p_proposal_id for update;
  if not found then raise exception 'material_proposal_not_found'; end if;
  if proposal.state<>'PROPOSED' then return jsonb_build_object('proposalId',proposal.id,'state',proposal.state::text); end if;
  if now_at<=proposal.proposal_expires_at then raise exception 'material_proposal_not_expired'; end if;
  select * into line_row from public.ap_material_lines where id=proposal.material_line_id;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  update public.ap_material_change_proposals set state='EXPIRED' where id=proposal.id;
  update public.ap_material_lines set substitution=case when proposal.kind='SUBSTITUTION'
    then 'EXPIRED'::public.ap_material_substitution else substitution end where id=line_row.id;
  refund_id:=public.ap_start_material_line_refund(line_row.id,purchase.customer_id,
    case when proposal.kind='SUBSTITUTION' then 'SUBSTITUTION_NO_RESPONSE' else 'FACT_CORRECTION_NO_RESPONSE' end,false);
  return jsonb_build_object('proposalId',proposal.id,'state','EXPIRED','refundId',refund_id);
end;
$$;

create or replace function public.ap_amend_material_reference_scope(
  p_material_line_id uuid,p_customer_id uuid,p_include_reference_sheet boolean,
  p_reference_permission_ids uuid[],p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare line_probe public.ap_material_lines; line_row public.ap_material_lines; payment public.ap_payment_attempts;
  purchase public.ap_material_purchases; intent public.ap_material_checkout_intents;
  item public.ap_material_checkout_items; prior_revision public.ap_material_line_revisions;
  job_row public.ap_job_snapshots; rule_row public.ap_employer_submission_rules;
  permission_id uuid; permission public.ap_reference_permissions; new_revision_id uuid:=gen_random_uuid();
  new_history_id uuid; now_at timestamptz:=clock_timestamp(); existing_revision uuid;
begin
  select id into existing_revision from public.ap_material_line_revisions
    where binding_sha256=encode(extensions.digest(convert_to(p_idempotency_key,'UTF8'),'sha256'),'hex');
  if existing_revision is not null then
    return jsonb_build_object('revisionId',existing_revision,'replayed',true);
  end if;
  select * into line_probe from public.ap_material_lines where id=p_material_line_id;
  select * into payment from public.ap_payment_attempts where id=line_probe.payment_attempt_id for update;
  select * into line_row from public.ap_material_lines where id=p_material_line_id for update;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  select * into intent from public.ap_material_checkout_intents where purchase_id=purchase.id;
  select * into item from public.ap_material_checkout_items where material_line_id=line_row.id for update;
  select * into prior_revision from public.ap_material_line_revisions
    where line_id=line_row.id and version=line_row.active_revision for update;
  select * into job_row from public.ap_job_snapshots where id=prior_revision.job_snapshot_id;
  select * into rule_row from public.ap_employer_submission_rules
    where id=prior_revision.employer_rule_snapshot_id and is_current;
  if purchase.customer_id<>p_customer_id or payment.settlement<>'PAID' or payment.dispute in ('OPEN','LOST')
    or line_row.fulfillment not in ('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
    or line_row.materials_due_at is null or now_at>line_row.materials_due_at
    or not item.originally_selected_reference_sheet
    or exists(select 1 from public.ap_refund_operations where material_line_id=line_row.id and superseded_at is null)
    or exists(select 1 from public.ap_releases where material_line_id=line_row.id)
    then raise exception 'reference_scope_amendment_not_allowed'; end if;
  if p_include_reference_sheet then
    if rule_row.reference_timing='PROHIBITED_NOW'
      or coalesce(cardinality(p_reference_permission_ids),0) not between 1 and least(3,coalesce(rule_row.reference_count,3))
      or cardinality(p_reference_permission_ids)<>cardinality(array(select distinct unnest(p_reference_permission_ids)))
      then raise exception 'reference_scope_permissions_invalid'; end if;
    foreach permission_id in array p_reference_permission_ids loop
      select * into permission from public.ap_reference_permissions where id=permission_id for update;
      if not found or permission.customer_id<>p_customer_id or permission.delivered_release_id<>intent.delivered_release_id
        or permission.job_snapshot_id<>job_row.id or permission.job_snapshot_hash<>job_row.content_sha256
        or permission.revoked_at is not null or permission.contact_version_changed_at is not null
        then raise exception 'reference_scope_permission_invalid'; end if;
    end loop;
  elsif rule_row.reference_timing='REQUIRED_NOW' then raise exception 'required_reference_scope_cannot_be_removed'; end if;
  insert into public.ap_material_line_revisions(
    id,line_id,version,revision_kind,parent_revision_id,job_snapshot_id,source_snapshot_id,
    employer_rule_snapshot_id,reference_scope,binding_sha256,accepted_at,started_at,due_at,capacity_allocation_id
  ) values(
    new_revision_id,line_row.id,line_row.active_revision+1,'REFERENCE_SCOPE',prior_revision.id,
    prior_revision.job_snapshot_id,prior_revision.source_snapshot_id,prior_revision.employer_rule_snapshot_id,
    jsonb_build_object('selected',p_include_reference_sheet,'permissionIds',
      coalesce(to_jsonb(p_reference_permission_ids),'[]'::jsonb)),
    encode(extensions.digest(convert_to(p_idempotency_key,'UTF8'),'sha256'),'hex'),now_at,
    prior_revision.started_at,prior_revision.due_at,prior_revision.capacity_allocation_id
  );
  update public.ap_material_line_revisions set superseded_at=now_at where id=prior_revision.id;
  update public.ap_generated_file_versions file set superseded_at=coalesce(file.superseded_at,now_at),
    downloads_revoked_at=coalesce(file.downloads_revoked_at,now_at)
    from public.ap_generated_artifacts artifact where file.artifact_id=artifact.id
      and artifact.material_line_id=line_row.id and artifact.source_line_revision_id=prior_revision.id;
  update public.ap_artifact_quality_reviews quality set invalidated_at=coalesce(quality.invalidated_at,now_at)
    from public.ap_generated_file_versions file join public.ap_generated_artifacts artifact on artifact.id=file.artifact_id
    where quality.file_version_id=file.id and artifact.material_line_id=line_row.id
      and artifact.source_line_revision_id=prior_revision.id;
  delete from public.ap_material_checkout_references where checkout_item_id=item.id;
  if p_include_reference_sheet then
    foreach permission_id in array p_reference_permission_ids loop
      insert into public.ap_material_checkout_references(checkout_item_id,reference_permission_id,position)
      values(item.id,permission_id,
        (select coalesce(max(position),0)+1 from public.ap_material_checkout_references where checkout_item_id=item.id));
    end loop;
  end if;
  update public.ap_material_checkout_items set selected_reference_sheet=p_include_reference_sheet where id=item.id;
  update public.ap_material_lines set selected_reference_sheet=p_include_reference_sheet,
    active_revision=line_row.active_revision+1,fulfillment='PAID' where id=line_row.id;
  new_history_id:=public.ap_append_material_entitlement_state_v2(
    line_row.id,'PAID',new_revision_id,line_row.delivered_match_id);
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'MATERIAL_REFERENCE_SCOPE_AMENDED','MATERIAL_LINE',line_row.id,
    jsonb_build_object('revisionId',new_revision_id,'referenceSheetSelected',p_include_reference_sheet,
      'activeDueAt',line_row.materials_due_at),'chunk5-v1');
  return jsonb_build_object('revisionId',new_revision_id,'startedAt',prior_revision.started_at,
    'dueAt',prior_revision.due_at,'referenceSheetSelected',p_include_reference_sheet,'replayed',false);
end;
$$;

create or replace function public.ap_register_material_artifact_version(
  p_artifact_id uuid,p_file_version_id uuid,p_material_line_id uuid,p_reviewer_id uuid,
  p_artifact_type public.ap_artifact_type,p_source_snapshot_id uuid,p_source_line_revision_id uuid,
  p_job_snapshot_id uuid,p_reference_regeneration_id uuid,p_reference_permission_ids uuid[],
  p_claim_provenance jsonb,p_generator_version text,p_storage_bucket text,p_storage_path text,
  p_safe_filename text,p_checksum_sha256 text,p_mime_type text,p_size_bytes integer,
  p_binding_sha256 text,p_package_qa_sha256 text,p_structural_checks jsonb,p_provenance_checks jsonb,
  p_extracted_text_sha256 text,p_rendered_page_count integer,p_renderer_identity text,
  p_arial_font_sha256 text,p_malware_scanner_identity text,
  p_render_preview_bucket text,p_render_preview_path text,p_render_preview_sha256 text,
  p_rendered_page_sha256 text[],p_arial_resolved boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare line_row public.ap_material_lines; purchase public.ap_material_purchases;
  revision public.ap_material_line_revisions; rule_row public.ap_employer_submission_rules;
  artifact public.ap_generated_artifacts; prior_file public.ap_generated_file_versions;
  permission_id uuid; permission public.ap_reference_permissions; next_version integer;
  now_at timestamptz:=clock_timestamp(); structural_pass boolean; provenance_pass boolean;
  extension text; expected_format text; expected_pages boolean; config public.ap_commerce_configuration;
begin
  perform public.ap_require_material_reviewer(p_reviewer_id);
  select * into config from public.ap_commerce_configuration where singleton;
  if not found or not config.materials_generation_approved
    or nullif(btrim(config.materials_generation_approval_reference),'') is null
    or p_renderer_identity is distinct from config.document_renderer_identity
    or p_arial_font_sha256 is distinct from config.arial_font_sha256
    or p_malware_scanner_identity is distinct from config.malware_scanner_identity
    then raise exception 'approved_material_generation_configuration_required'; end if;
  select * into line_row from public.ap_material_lines where id=p_material_line_id for update;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  select * into revision from public.ap_material_line_revisions
    where id=p_source_line_revision_id and line_id=line_row.id and version=line_row.active_revision
      and superseded_at is null for update;
  select * into rule_row from public.ap_employer_submission_rules
    where id=revision.employer_rule_snapshot_id and job_snapshot_id=p_job_snapshot_id and is_current;
  if not found or revision.source_snapshot_id<>p_source_snapshot_id or revision.binding_sha256<>p_binding_sha256
    or purchase.customer_id is null or rule_row.id is null then raise exception 'stale_material_generation_binding'; end if;
  if p_reference_regeneration_id is null then
    if line_row.fulfillment not in ('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
      or line_row.materials_due_at is null or now_at>line_row.materials_due_at
      or exists(select 1 from public.ap_refund_operations where material_line_id=line_row.id and superseded_at is null)
      or exists(select 1 from public.ap_releases where material_line_id=line_row.id)
      then raise exception 'material_generation_not_allowed'; end if;
  elsif p_artifact_type<>'REFERENCE_SHEET' or not exists(
    select 1 from public.ap_reference_regenerations regeneration
    where regeneration.id=p_reference_regeneration_id and regeneration.customer_id=purchase.customer_id
      and regeneration.material_line_id=line_row.id and regeneration.state in ('ACTIVE','HUMAN_REVIEW')
      and regeneration.due_at>=now_at
  ) then raise exception 'reference_regeneration_not_active'; end if;
  if jsonb_typeof(p_claim_provenance)<>'object'
    or p_claim_provenance->>'schemaVersion'<>'applypack-claim-provenance-v1'
    or jsonb_typeof(p_claim_provenance->'sourceBinding')<>'object'
    or jsonb_typeof(p_claim_provenance#>'{sourceBinding,candidateFactIds}')<>'array'
    or jsonb_typeof(p_claim_provenance#>'{sourceBinding,jobEvidenceIds}')<>'array'
    or jsonb_typeof(p_claim_provenance#>'{sourceBinding,referencePermissionIds}')<>'array'
    or jsonb_typeof(p_claim_provenance->'claims')<>'array'
    or jsonb_array_length(p_claim_provenance->'claims')=0
    or exists(select 1 from jsonb_array_elements(p_claim_provenance->'claims') claim
      where jsonb_typeof(claim)<>'object'
        or claim->>'kind' not in ('CANDIDATE_FACT','JOB_EVIDENCE','MIXED','NARRATIVE','REFERENCE_PERMISSION')
        or nullif(btrim(claim->>'placement'),'') is null
        or coalesce(claim->>'visibleTextSha256','') !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(claim->'candidateFactIds')<>'array'
        or jsonb_typeof(claim->'jobEvidenceIds')<>'array'
        or jsonb_typeof(claim->'referencePermissionIds')<>'array'
        or (claim->>'kind'='NARRATIVE' and (
          jsonb_array_length(claim->'candidateFactIds')<>0
          or jsonb_array_length(claim->'jobEvidenceIds')<>0
          or jsonb_array_length(claim->'referencePermissionIds')<>0))
        or (claim->>'kind'='CANDIDATE_FACT' and jsonb_array_length(claim->'candidateFactIds')=0)
        or (claim->>'kind'='JOB_EVIDENCE' and jsonb_array_length(claim->'jobEvidenceIds')=0)
        or (claim->>'kind'='MIXED' and (jsonb_array_length(claim->'candidateFactIds')=0
          or jsonb_array_length(claim->'jobEvidenceIds')=0))
        or (claim->>'kind'='REFERENCE_PERMISSION' and jsonb_array_length(claim->'referencePermissionIds')=0))
    then raise exception 'claim_provenance_shape_invalid'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_claim_provenance#>'{sourceBinding,candidateFactIds}') fact_id
      where not exists(select 1 from public.ap_candidate_facts fact
        where fact.id=fact_id::uuid and fact.customer_id=purchase.customer_id
          and fact.snapshot_id=p_source_snapshot_id and fact.superseded_at is null
          and fact.verification in ('CUSTOMER_CONFIRMED','HUMAN_VERIFIED')))
    or exists(select 1 from jsonb_array_elements_text(p_claim_provenance#>'{sourceBinding,jobEvidenceIds}') evidence_id
      where not exists(select 1 from public.ap_requirement_nodes evidence
        where evidence.id=evidence_id::uuid and evidence.job_snapshot_id=p_job_snapshot_id))
    or exists(select 1 from jsonb_array_elements(p_claim_provenance->'claims') claim,
        lateral jsonb_array_elements_text(claim->'candidateFactIds') fact_id
      where not (p_claim_provenance#>'{sourceBinding,candidateFactIds}') @> jsonb_build_array(fact_id))
    or exists(select 1 from jsonb_array_elements(p_claim_provenance->'claims') claim,
        lateral jsonb_array_elements_text(claim->'jobEvidenceIds') evidence_id
      where not (p_claim_provenance#>'{sourceBinding,jobEvidenceIds}') @> jsonb_build_array(evidence_id))
    or exists(select 1 from jsonb_array_elements(p_claim_provenance->'claims') claim,
        lateral jsonb_array_elements_text(claim->'referencePermissionIds') permission_value
      where not (p_claim_provenance#>'{sourceBinding,referencePermissionIds}') @> jsonb_build_array(permission_value))
    then raise exception 'material_claim_provenance_unverified'; end if;
  if p_artifact_type in ('RESUME','COVER_LETTER') then
    if jsonb_array_length(p_claim_provenance#>'{sourceBinding,candidateFactIds}')=0
      or jsonb_array_length(p_claim_provenance#>'{sourceBinding,jobEvidenceIds}')=0
      then raise exception 'material_claim_provenance_unverified'; end if;
    if cardinality(coalesce(p_reference_permission_ids,'{}'::uuid[]))<>0
      or jsonb_array_length(p_claim_provenance#>'{sourceBinding,referencePermissionIds}')<>0
      then raise exception 'reference_permission_on_nonreference_artifact'; end if;
  else
    if not line_row.selected_reference_sheet and p_reference_regeneration_id is null
      then raise exception 'reference_sheet_not_selected_before_checkout'; end if;
    if coalesce(cardinality(p_reference_permission_ids),0) not between 1 and 3
      or cardinality(p_reference_permission_ids)<>cardinality(array(select distinct unnest(p_reference_permission_ids)))
      then raise exception 'reference_artifact_permissions_required'; end if;
    if (select coalesce(array_agg(value::uuid order by value::text),'{}'::uuid[])
        from jsonb_array_elements_text(p_claim_provenance#>'{sourceBinding,referencePermissionIds}'))
      is distinct from (select coalesce(array_agg(value order by value::text),'{}'::uuid[])
        from unnest(p_reference_permission_ids) value)
      then raise exception 'reference_provenance_permission_mismatch'; end if;
    foreach permission_id in array p_reference_permission_ids loop
      select * into permission from public.ap_reference_permissions where id=permission_id for update;
      if not found or permission.customer_id<>purchase.customer_id or permission.job_snapshot_id<>p_job_snapshot_id
        or permission.job_snapshot_hash<>(select content_sha256 from public.ap_job_snapshots where id=p_job_snapshot_id)
        or permission.revoked_at is not null or permission.contact_version_changed_at is not null
        then raise exception 'reference_artifact_permission_invalid'; end if;
    end loop;
  end if;
  if p_checksum_sha256 !~ '^[0-9a-f]{64}$' or p_package_qa_sha256 !~ '^[0-9a-f]{64}$'
    or p_extracted_text_sha256 !~ '^[0-9a-f]{64}$' or p_binding_sha256 !~ '^[0-9a-f]{64}$'
    or p_size_bytes<=0 or nullif(btrim(p_generator_version),'') is null
    or p_storage_bucket not in ('operator-drafts','customer-deliveries')
    or p_storage_path not like purchase.customer_id::text||'/materials/'||line_row.id::text||'/%'
    or p_render_preview_bucket<>'operator-render-previews'
    or p_render_preview_path not like purchase.customer_id::text||'/materials/'||line_row.id::text||'/%'
    or p_render_preview_sha256 !~ '^[0-9a-f]{64}$'
    or cardinality(p_rendered_page_sha256)<>p_rendered_page_count
    or exists(select 1 from unnest(p_rendered_page_sha256) page_sha where page_sha !~ '^[0-9a-f]{64}$')
    then raise exception 'generated_file_identity_invalid'; end if;
  extension:=lower(substring(p_safe_filename from '\.([A-Za-z0-9]+)$'));
  expected_format:=case when p_mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    then 'DOCX' when p_mime_type='application/pdf' then 'PDF' else null end;
  if expected_format is null or extension<>lower(expected_format)
    or not expected_format=any(rule_row.allowed_formats)
    or not expected_format=any(config.material_output_formats)
    or p_safe_filename~'[\[\]]' or p_safe_filename~* '(^|_)(final|updated|new|v2)(_|\.)'
    or p_safe_filename!~'^[^/\\]{1,180}\.(docx|pdf)$'
    then raise exception 'generated_filename_or_format_invalid'; end if;
  expected_pages:=case when p_artifact_type='RESUME' then
      p_rendered_page_count=1 or (p_rendered_page_count=2
        and coalesce((p_structural_checks->>'twoPageExceptionApproved')::boolean,false))
    else p_rendered_page_count=1 end;
  structural_pass:=jsonb_typeof(p_structural_checks)='object'
    and p_structural_checks ?& array['noMacros','noHiddenText','noComments','noTrackedChanges',
      'noCustomXml','noExternalRelationships','noLayoutTables','nativeBullets','linearText',
      'noPlaceholders','noMetadataLeak','noPromptArtifacts','filenameValid','mimeValid',
      'checksumValid','pageGeometryValid','textExtracted']
    and not exists(select 1 from jsonb_each_text(p_structural_checks) item
      where item.key<>'twoPageExceptionApproved' and item.value<>'true')
    and expected_pages;
  provenance_pass:=jsonb_typeof(p_provenance_checks)='object'
    and p_provenance_checks ?& array['factsBound','jobEvidenceBound','narrativeTyped',
      'historicalTitlesPreserved','injectionReviewed','noUnsupportedClaims','sameCurrentBinding']
    and not exists(select 1 from jsonb_each_text(p_provenance_checks) item where item.value<>'true');
  select * into artifact from public.ap_generated_artifacts
    where material_line_id=line_row.id and artifact_type=p_artifact_type
      and source_line_revision_id=revision.id and reference_regeneration_id is not distinct from p_reference_regeneration_id
    for update;
  if not found then
    insert into public.ap_generated_artifacts(
      id,customer_id,order_id,material_line_id,job_snapshot_id,artifact_type,source_snapshot_id,
      source_line_revision_id,reference_permission_id,reference_regeneration_id,claim_provenance,
      generator_version,current_file_version
    ) values(
      p_artifact_id,purchase.customer_id,line_row.delivered_order_id,line_row.id,p_job_snapshot_id,
      p_artifact_type,p_source_snapshot_id,revision.id,
      case when p_artifact_type='REFERENCE_SHEET' then p_reference_permission_ids[1] else null end,
      p_reference_regeneration_id,p_claim_provenance,p_generator_version,0
    ) returning * into artifact;
  elsif artifact.id<>p_artifact_id then
    raise exception 'artifact_identity_conflict';
  end if;
  next_version:=artifact.current_file_version+1;
  select * into prior_file from public.ap_generated_file_versions
    where artifact_id=artifact.id and version=artifact.current_file_version for update;
  if prior_file.id is not null then
    update public.ap_generated_file_versions set superseded_at=coalesce(superseded_at,now_at),
      downloads_revoked_at=coalesce(downloads_revoked_at,now_at) where id=prior_file.id;
    update public.ap_artifact_quality_reviews set invalidated_at=coalesce(invalidated_at,now_at)
      where file_version_id=prior_file.id;
  end if;
  insert into public.ap_generated_file_versions(
    id,artifact_id,version,storage_bucket,storage_path,checksum_sha256,mime_type,size_bytes,
    safe_filename,binding_sha256,package_qa_sha256
  ) values(p_file_version_id,artifact.id,next_version,p_storage_bucket,p_storage_path,p_checksum_sha256,
    p_mime_type,p_size_bytes,p_safe_filename,p_binding_sha256,p_package_qa_sha256);
  update public.ap_generated_artifacts set current_file_version=next_version,
    claim_provenance=p_claim_provenance,generator_version=p_generator_version where id=artifact.id;
  delete from public.ap_artifact_reference_permissions where artifact_id=artifact.id;
  if p_artifact_type='REFERENCE_SHEET' then
    foreach permission_id in array p_reference_permission_ids loop
      insert into public.ap_artifact_reference_permissions(artifact_id,reference_permission_id,position)
      values(artifact.id,permission_id,
        (select coalesce(max(position),0)+1 from public.ap_artifact_reference_permissions where artifact_id=artifact.id));
    end loop;
  end if;
  insert into public.ap_artifact_quality_reviews(
    file_version_id,binding_sha256,structural_checks,provenance_checks,extracted_text_sha256,
    rendered_page_count,renderer_identity,arial_font_sha256,malware_scanner_identity,
    render_preview_bucket,render_preview_path,
    render_preview_sha256,rendered_page_sha256,arial_resolved,automated_passed_at
  ) values(p_file_version_id,p_binding_sha256,p_structural_checks,p_provenance_checks,p_extracted_text_sha256,
    p_rendered_page_count,p_renderer_identity,p_arial_font_sha256,p_malware_scanner_identity,
    p_render_preview_bucket,p_render_preview_path,
    p_render_preview_sha256,p_rendered_page_sha256,p_arial_resolved,
    case when structural_pass and provenance_pass and p_arial_resolved then now_at else null end);
  if p_reference_regeneration_id is null then
    update public.ap_material_lines set fulfillment=case when structural_pass and provenance_pass and p_arial_resolved
      then 'HUMAN_REVIEW'::public.ap_material_fulfillment else 'GENERATING'::public.ap_material_fulfillment end
      where id=line_row.id;
  else
    update public.ap_reference_regenerations set state=case when structural_pass and provenance_pass and p_arial_resolved
      then 'HUMAN_REVIEW'::public.ap_reference_regeneration_state else 'ACTIVE'::public.ap_reference_regeneration_state end
      where id=p_reference_regeneration_id;
  end if;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(purchase.customer_id,p_reviewer_id,'MATERIAL_ARTIFACT_VERSION_REGISTERED','GENERATED_ARTIFACT',artifact.id,
    jsonb_build_object('fileVersionId',p_file_version_id,'version',next_version,'artifactType',p_artifact_type::text,
      'automatedPassed',structural_pass and provenance_pass and p_arial_resolved,
      'checksumSha256',p_checksum_sha256),'chunk5-v1');
  return jsonb_build_object('artifactId',artifact.id,'fileVersionId',p_file_version_id,'version',next_version,
    'automatedPassed',structural_pass and provenance_pass and p_arial_resolved);
end;
$$;

create or replace function public.ap_record_material_human_approval(
  p_file_version_id uuid,p_reviewer_id uuid,p_approval_kind text,p_attestation text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare quality public.ap_artifact_quality_reviews; file_row public.ap_generated_file_versions;
  artifact public.ap_generated_artifacts; line_row public.ap_material_lines; expected_count integer;
  approved_count integer; now_at timestamptz:=clock_timestamp();
begin
  perform public.ap_require_material_reviewer(p_reviewer_id);
  if p_approval_kind not in ('CONTENT','VISUAL') or length(btrim(p_attestation))<20
    then raise exception 'material_approval_attestation_invalid'; end if;
  select * into quality from public.ap_artifact_quality_reviews
    where file_version_id=p_file_version_id for update;
  select * into file_row from public.ap_generated_file_versions where id=p_file_version_id for update;
  select * into artifact from public.ap_generated_artifacts where id=file_row.artifact_id for update;
  select * into line_row from public.ap_material_lines where id=artifact.material_line_id for update;
  if quality.automated_passed_at is null or quality.invalidated_at is not null
    or file_row.superseded_at is not null or file_row.downloads_revoked_at is not null
    or artifact.current_file_version<>file_row.version
    or quality.binding_sha256<>file_row.binding_sha256
    or not exists(select 1 from public.ap_material_line_revisions revision
      where revision.id=artifact.source_line_revision_id and revision.line_id=line_row.id
        and revision.version=line_row.active_revision and revision.superseded_at is null
        and revision.binding_sha256=file_row.binding_sha256)
    then raise exception 'stale_or_failed_artifact_not_approvable'; end if;
  if p_approval_kind='VISUAL' and (not quality.arial_resolved or quality.rendered_page_count not between 1 and 2)
    then raise exception 'visual_render_not_verified'; end if;
  if p_approval_kind='CONTENT' then
    update public.ap_artifact_quality_reviews set content_approved_by=p_reviewer_id,
      content_approved_at=now_at,content_attestation=p_attestation where id=quality.id;
    update public.ap_generated_file_versions set human_content_approved_by=p_reviewer_id,
      human_content_approved_at=now_at where id=file_row.id;
  else
    update public.ap_artifact_quality_reviews set visual_approved_by=p_reviewer_id,
      visual_approved_at=now_at,visual_attestation=p_attestation where id=quality.id;
    update public.ap_generated_file_versions set human_visual_approved_by=p_reviewer_id,
      human_visual_approved_at=now_at where id=file_row.id;
  end if;
  if artifact.reference_regeneration_id is null then
    expected_count:=case when line_row.selected_reference_sheet then 3 else 2 end;
    select count(*) into approved_count from public.ap_generated_artifacts current_artifact
    join public.ap_generated_file_versions current_file on current_file.artifact_id=current_artifact.id
      and current_file.version=current_artifact.current_file_version
    join public.ap_artifact_quality_reviews current_quality on current_quality.file_version_id=current_file.id
    where current_artifact.material_line_id=line_row.id
      and current_artifact.source_line_revision_id=artifact.source_line_revision_id
      and current_artifact.reference_regeneration_id is null
      and current_file.superseded_at is null and current_file.downloads_revoked_at is null
      and current_quality.invalidated_at is null and current_quality.automated_passed_at is not null
      and current_quality.content_approved_at is not null and current_quality.visual_approved_at is not null;
    update public.ap_material_lines set fulfillment=case when approved_count=expected_count
      then 'READY_TO_RELEASE'::public.ap_material_fulfillment else 'HUMAN_REVIEW'::public.ap_material_fulfillment end
      where id=line_row.id and fulfillment<>'DELIVERED';
  else
    update public.ap_reference_regenerations set state=case when
      (select content_approved_at is not null and visual_approved_at is not null
        from public.ap_artifact_quality_reviews where id=quality.id)
      then 'HUMAN_REVIEW'::public.ap_reference_regeneration_state else state end
      where id=artifact.reference_regeneration_id;
  end if;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(artifact.customer_id,p_reviewer_id,'MATERIAL_'||p_approval_kind||'_APPROVED','GENERATED_FILE_VERSION',
    file_row.id,jsonb_build_object('artifactId',artifact.id,'version',file_row.version),'chunk5-v1');
  return jsonb_build_object('fileVersionId',file_row.id,'approvalKind',p_approval_kind,'approvedAt',now_at);
end;
$$;

create or replace function public.ap_commit_material_release_v2(
  p_material_line_id uuid,p_reviewer_id uuid,p_release_id uuid,p_review_checklist jsonb,
  p_reviewer_rationale text,p_outbox_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare line_probe public.ap_material_lines; line_row public.ap_material_lines; payment public.ap_payment_attempts;
  purchase public.ap_material_purchases; revision public.ap_material_line_revisions;
  rule_row public.ap_employer_submission_rules; final_check public.ap_material_listing_checks;
  artifact public.ap_generated_artifacts; member_payload jsonb:='[]'::jsonb;
  expected_count integer; artifact_count integer; now_at timestamptz:=clock_timestamp(); history_id uuid;
  release_kind text; existing_release uuid; config public.ap_commerce_configuration;
begin
  perform public.ap_require_material_reviewer(p_reviewer_id);
  if jsonb_typeof(p_review_checklist)<>'object'
    or not (p_review_checklist ?& array['contentReviewed','visualReviewed','listingRechecked',
      'instructionsReparsed','linksRechecked','provenanceReviewed','secureFilesConfirmed'])
    or exists(select 1 from jsonb_each_text(p_review_checklist) item where item.value<>'true')
    or length(btrim(p_reviewer_rationale))<20 then raise exception 'material_release_checklist_incomplete'; end if;
  select * into line_probe from public.ap_material_lines where id=p_material_line_id;
  select * into payment from public.ap_payment_attempts where id=line_probe.payment_attempt_id for update;
  select * into line_row from public.ap_material_lines where id=line_probe.id for update;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  select * into config from public.ap_commerce_configuration where singleton;
  select id into existing_release from public.ap_releases where material_line_id=line_row.id
    and release_kind in ('MATERIAL_PAIR','MATERIAL_TRIPLE');
  if existing_release is not null then return existing_release; end if;
  if payment.settlement<>'PAID' or payment.dispute in ('OPEN','LOST')
    or purchase.customer_id<>payment.customer_id or line_row.fulfillment<>'READY_TO_RELEASE'
    or line_row.materials_due_at is null or now_at>line_row.materials_due_at
    or exists(select 1 from public.ap_refund_operations where material_line_id=line_row.id and superseded_at is null)
    then raise exception 'material_release_not_allowed'; end if;
  select * into revision from public.ap_material_line_revisions
    where line_id=line_row.id and version=line_row.active_revision and superseded_at is null for update;
  select * into rule_row from public.ap_employer_submission_rules
    where id=revision.employer_rule_snapshot_id and job_snapshot_id=revision.job_snapshot_id and is_current;
  select * into final_check from public.ap_material_listing_checks
    where material_line_id=line_row.id and line_revision_id=revision.id and phase='BEFORE_RELEASE'
    order by checked_at desc,id desc limit 1;
  if rule_row.id is null or final_check.id is null or final_check.result<>'ACTIVE'
    or final_check.submission_rule_id<>rule_row.id or final_check.evidence_sha256<>rule_row.content_sha256
    or config.materials_rule_ttl_seconds is distinct from 3600
    or not config.materials_generation_approved
    or nullif(btrim(config.materials_generation_approval_reference),'') is null
    or cardinality(config.material_output_formats)=0
    or nullif(btrim(config.document_renderer_identity),'') is null
    or config.arial_font_sha256 is null
    or nullif(btrim(config.malware_scanner_identity),'') is null
    or final_check.checked_at<now_at-make_interval(secs=>config.materials_rule_ttl_seconds)
    or rule_row.resume_requirement='PROHIBITED' or rule_row.cover_letter_requirement='PROHIBITED'
    or rule_row.hard_block_reason is not null or rule_row.injection_scan_state<>'CLEAR'
    or exists(select 1 from public.ap_job_snapshots successor
      where successor.supersedes_job_snapshot_id=revision.job_snapshot_id)
    then raise exception 'final_listing_or_instruction_check_failed'; end if;
  expected_count:=case when line_row.selected_reference_sheet then 3 else 2 end;
  release_kind:=case when line_row.selected_reference_sheet then 'MATERIAL_TRIPLE' else 'MATERIAL_PAIR' end;
  for artifact in select current_artifact.* from public.ap_generated_artifacts current_artifact
    join public.ap_generated_file_versions current_file on current_file.artifact_id=current_artifact.id
      and current_file.version=current_artifact.current_file_version
    join public.ap_artifact_quality_reviews quality on quality.file_version_id=current_file.id
    where current_artifact.material_line_id=line_row.id
      and current_artifact.source_line_revision_id=revision.id
      and current_artifact.reference_regeneration_id is null
      and current_artifact.source_snapshot_id=revision.source_snapshot_id
      and current_artifact.job_snapshot_id=revision.job_snapshot_id
      and current_file.binding_sha256=revision.binding_sha256
      and current_file.superseded_at is null and current_file.downloads_revoked_at is null
      and quality.invalidated_at is null and quality.automated_passed_at is not null
      and quality.content_approved_at is not null and quality.visual_approved_at is not null
      and quality.binding_sha256=revision.binding_sha256
    order by current_artifact.artifact_type loop
    if artifact.artifact_type='REFERENCE_SHEET' and (
      not line_row.selected_reference_sheet or exists(
        select 1 from public.ap_artifact_reference_permissions link
        join public.ap_reference_permissions permission on permission.id=link.reference_permission_id
        where link.artifact_id=artifact.id
          and (permission.revoked_at is not null or permission.contact_version_changed_at is not null)
      )
    ) then raise exception 'reference_sheet_permission_stale'; end if;
    member_payload:=member_payload||jsonb_build_array(jsonb_build_object(
      'memberType','GENERATED_ARTIFACT','memberId',artifact.id,'position',jsonb_array_length(member_payload)+1));
  end loop;
  artifact_count:=jsonb_array_length(member_payload);
  if artifact_count<>expected_count
    or not exists(select 1 from jsonb_array_elements(member_payload) member
      join public.ap_generated_artifacts artifact_check on artifact_check.id=(member->>'memberId')::uuid
      where artifact_check.artifact_type='RESUME')
    or not exists(select 1 from jsonb_array_elements(member_payload) member
      join public.ap_generated_artifacts artifact_check on artifact_check.id=(member->>'memberId')::uuid
      where artifact_check.artifact_type='COVER_LETTER')
    then raise exception 'atomic_material_artifact_set_incomplete'; end if;
  perform public.ap_commit_release(p_release_id,purchase.customer_id,line_row.delivered_order_id,line_row.id,
    release_kind,now_at,line_row.materials_due_at,
    jsonb_build_object('lineRevisionId',revision.id,'bindingSha256',revision.binding_sha256,
      'jobSnapshotId',revision.job_snapshot_id,'sourceSnapshotId',revision.source_snapshot_id,
      'submissionRuleId',revision.employer_rule_snapshot_id,'reviewChecklist',p_review_checklist),
    p_reviewer_id,member_payload);
  history_id:=public.ap_append_material_entitlement_state_v2(
    line_row.id,'DELIVERED',revision.id,line_row.delivered_match_id);
  update public.ap_capacity_allocation_members set member_lifecycle='COMPLETED',completed_at=now_at
    where material_line_id=line_row.id and revision_id=revision.id and member_debit_disposition='SPENT';
  update public.ap_capacity_allocations allocation set lifecycle='COMPLETED',updated_at=now_at
    where allocation.id in (select member.allocation_id from public.ap_capacity_allocation_members member
      where member.material_line_id=line_row.id and member.revision_id=revision.id)
      and not exists(select 1 from public.ap_capacity_allocation_members other
        where other.allocation_id=allocation.id and other.member_lifecycle not in ('COMPLETED','SUPERSEDED'));
  insert into public.ap_outbox_messages(
    id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at
  ) values(p_outbox_id,purchase.customer_id,line_row.delivered_order_id,'MATERIALS_DELIVERED',
    p_release_id::text,'materials-delivered:'||line_row.id::text,p_outbox_id::text,'QUEUED',now_at)
  on conflict(deduplication_key) do nothing;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('OUTBOX_SEND',p_outbox_id,'outbox-send:'||p_outbox_id::text,now_at)
  on conflict(idempotency_key) do nothing;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(purchase.customer_id,p_reviewer_id,'MATERIAL_RELEASE_COMMITTED','RELEASE',p_release_id,
    jsonb_build_object('materialLineId',line_row.id,'memberCount',expected_count,
      'releaseKind',release_kind,'earnedAmountCents',800,'committedAt',now_at),'chunk5-v1');
  return p_release_id;
end;
$$;

create or replace function public.ap_record_reference_isolation(
  p_customer_id uuid,p_document_version_id uuid,p_status text,p_quarantined_payload_id uuid,
  p_detector_version text,p_content_sha256 text,p_reviewer_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare review_id uuid:=gen_random_uuid(); document_row public.ap_document_versions; mapped_status text;
begin
  if p_status not in ('CLEAR','QUARANTINED','HUMAN_REVIEW_REQUIRED','FAILED_CLOSED')
    or p_content_sha256 !~ '^[0-9a-f]{64}$' or length(btrim(p_detector_version))<3
    then raise exception 'reference_isolation_result_invalid'; end if;
  select * into document_row from public.ap_document_versions
    where id=p_document_version_id and customer_id=p_customer_id and is_current for update;
  if not found or document_row.sha256<>p_content_sha256 then raise exception 'reference_isolation_document_mismatch'; end if;
  if p_status='QUARANTINED' and not exists(select 1 from public.ap_sensitive_payloads
    where id=p_quarantined_payload_id and customer_id=p_customer_id) then raise exception 'reference_quarantine_payload_required'; end if;
  if p_status in ('HUMAN_REVIEW_REQUIRED','FAILED_CLOSED') and p_reviewer_id is not null then
    perform public.ap_require_material_reviewer(p_reviewer_id);
  end if;
  insert into public.ap_reference_isolation_reviews(
    id,document_version_id,customer_id,status,quarantined_payload_id,detector_version,content_sha256,
    reviewed_by,reviewed_at
  ) values(review_id,p_document_version_id,p_customer_id,p_status,p_quarantined_payload_id,
    p_detector_version,p_content_sha256,p_reviewer_id,case when p_reviewer_id is null then null else clock_timestamp() end);
  mapped_status:=case p_status when 'CLEAR' then 'CLEAR' when 'QUARANTINED' then 'DETECTED'
    when 'HUMAN_REVIEW_REQUIRED' then 'UNCERTAIN' else 'ERROR' end;
  update public.ap_document_versions set reference_isolation_status=mapped_status,
    processing_state=case when p_status='FAILED_CLOSED' then 'FAILED'::public.ap_document_processing_state else processing_state end,
    model_ready_at=case when p_status in ('HUMAN_REVIEW_REQUIRED','FAILED_CLOSED') then null else model_ready_at end,
    failure_code=case when p_status='FAILED_CLOSED' then 'REFERENCE_ISOLATION_FAILED_CLOSED'
      when p_status='HUMAN_REVIEW_REQUIRED' then 'REFERENCE_ISOLATION_HUMAN_REVIEW_REQUIRED' else failure_code end,
    updated_at=clock_timestamp() where id=document_row.id;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,p_reviewer_id,'REFERENCE_ISOLATION_RECORDED','DOCUMENT_VERSION',document_row.id,
    jsonb_build_object('status',p_status,'detectorVersion',p_detector_version),'chunk5-v1');
  return review_id;
end;
$$;

create or replace function public.ap_request_reference_regeneration(
  p_customer_id uuid,p_material_line_id uuid,p_prior_artifact_id uuid,p_permission_ids uuid[],
  p_request_key text,p_outbox_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare line_row public.ap_material_lines; purchase public.ap_material_purchases; intent public.ap_material_checkout_intents;
  revision public.ap_material_line_revisions; prior_artifact public.ap_generated_artifacts;
  permission_id uuid; permission public.ap_reference_permissions; all_confirmed timestamptz;
  regeneration_id uuid:=gen_random_uuid(); attempt_value integer; allocation_id uuid;
  requested_value timestamptz:=clock_timestamp(); capacity_value timestamptz;
  started_value timestamptz; due_value timestamptz; existing public.ap_reference_regenerations;
begin
  select * into existing from public.ap_reference_regenerations where request_key=p_request_key;
  if found then return jsonb_build_object('regenerationId',existing.id,'state',existing.state::text,
    'startedAt',existing.started_at,'dueAt',existing.due_at,'replayed',true); end if;
  select * into line_row from public.ap_material_lines where id=p_material_line_id for update;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  select * into intent from public.ap_material_checkout_intents where purchase_id=purchase.id;
  select * into revision from public.ap_material_line_revisions
    where line_id=line_row.id and version=line_row.active_revision and superseded_at is null;
  select * into prior_artifact from public.ap_generated_artifacts
    where id=p_prior_artifact_id and material_line_id=line_row.id and artifact_type='REFERENCE_SHEET';
  if purchase.customer_id<>p_customer_id or line_row.fulfillment<>'DELIVERED' or prior_artifact.id is null
    or not exists(select 1 from public.ap_generated_file_versions file
      where file.artifact_id=prior_artifact.id and file.downloads_revoked_at is not null)
    or coalesce(cardinality(p_permission_ids),0) not between 1 and 3
    or cardinality(p_permission_ids)<>cardinality(array(select distinct unnest(p_permission_ids)))
    then raise exception 'reference_regeneration_not_available'; end if;
  foreach permission_id in array p_permission_ids loop
    select * into permission from public.ap_reference_permissions where id=permission_id for update;
    if not found or permission.customer_id<>p_customer_id or permission.delivered_release_id<>intent.delivered_release_id
      or permission.job_snapshot_id<>revision.job_snapshot_id
      or permission.job_snapshot_hash<>(select content_sha256 from public.ap_job_snapshots where id=revision.job_snapshot_id)
      or permission.revoked_at is not null or permission.contact_version_changed_at is not null
      then raise exception 'reference_regeneration_permission_invalid'; end if;
  end loop;
  select max(attested_at) into all_confirmed from public.ap_reference_permissions where id=any(p_permission_ids);
  attempt_value:=coalesce((select max(attempt_number) from public.ap_reference_regenerations
    where material_line_id=line_row.id),0)+1;
  allocation_id:=public.ap_reserve_capacity(p_customer_id,'REFERENCE_REGENERATION',1,
    'reference-regeneration:'||p_request_key,requested_value+interval '30 minutes','[]'::jsonb,null);
  update public.ap_capacity_allocations set lifecycle='CONSUMED',debit_disposition='SPENT',
    consumed_at=clock_timestamp(),updated_at=clock_timestamp() where id=allocation_id returning consumed_at into capacity_value;
  insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
  values(allocation_id,'RESERVED','CONSUMED','HELD','SPENT','REFERENCE_REGENERATION_ACCEPTED');
  started_value:=greatest(requested_value,all_confirmed,capacity_value);
  due_value:=started_value+interval '24 hours';
  insert into public.ap_reference_regenerations(
    id,customer_id,material_line_id,prior_artifact_id,state,attempt_number,permission_ids,
    requested_at,all_permissions_confirmed_at,capacity_allocation_id,capacity_confirmed_at,
    started_at,due_at,request_key
  ) values(regeneration_id,p_customer_id,line_row.id,prior_artifact.id,'ACTIVE',attempt_value,p_permission_ids,
    requested_value,all_confirmed,allocation_id,capacity_value,started_value,due_value,p_request_key);
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('REFERENCE_REGENERATION_DEADLINE',regeneration_id,
    'reference-regeneration-deadline:'||regeneration_id::text,due_value);
  insert into public.ap_outbox_messages(
    id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at
  ) values(p_outbox_id,p_customer_id,line_row.delivered_order_id,'REFERENCE_REGENERATION_STARTED',
    regeneration_id::text,'reference-regeneration-started:'||regeneration_id::text,p_outbox_id::text,'QUEUED',requested_value)
  on conflict(deduplication_key) do nothing;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('OUTBOX_SEND',p_outbox_id,'outbox-send:'||p_outbox_id::text,requested_value)
  on conflict(idempotency_key) do nothing;
  return jsonb_build_object('regenerationId',regeneration_id,'state','ACTIVE',
    'startedAt',started_value,'dueAt',due_value,'replayed',false);
end;
$$;

create or replace function public.ap_commit_reference_regeneration(
  p_regeneration_id uuid,p_reviewer_id uuid,p_release_id uuid,p_outbox_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare regeneration public.ap_reference_regenerations; line_row public.ap_material_lines;
  artifact public.ap_generated_artifacts; file_row public.ap_generated_file_versions;
  quality public.ap_artifact_quality_reviews; permission_id uuid; now_at timestamptz:=clock_timestamp();
  existing_release uuid;
begin
  perform public.ap_require_material_reviewer(p_reviewer_id);
  select * into regeneration from public.ap_reference_regenerations where id=p_regeneration_id for update;
  if not found then raise exception 'reference_regeneration_not_found'; end if;
  if regeneration.state='DELIVERED' then return regeneration.delivered_release_id; end if;
  select * into line_row from public.ap_material_lines where id=regeneration.material_line_id for update;
  if regeneration.state<>'HUMAN_REVIEW' or regeneration.due_at<now_at or line_row.fulfillment<>'DELIVERED'
    then raise exception 'reference_regeneration_release_not_allowed'; end if;
  select * into artifact from public.ap_generated_artifacts
    where reference_regeneration_id=regeneration.id and artifact_type='REFERENCE_SHEET';
  select * into file_row from public.ap_generated_file_versions
    where artifact_id=artifact.id and version=artifact.current_file_version and superseded_at is null
      and downloads_revoked_at is null;
  select * into quality from public.ap_artifact_quality_reviews where file_version_id=file_row.id
    and invalidated_at is null and automated_passed_at is not null
    and content_approved_at is not null and visual_approved_at is not null;
  if artifact.id is null or file_row.id is null or quality.id is null then
    raise exception 'reference_regeneration_artifact_not_approved'; end if;
  foreach permission_id in array regeneration.permission_ids loop
    if not exists(select 1 from public.ap_reference_permissions where id=permission_id
      and customer_id=regeneration.customer_id and revoked_at is null and contact_version_changed_at is null)
      then raise exception 'reference_regeneration_permission_stale'; end if;
  end loop;
  select id into existing_release from public.ap_releases
    where material_line_id=line_row.id and release_kind='REFERENCE_REGENERATION'
      and version_bundle->>'regenerationId'=regeneration.id::text;
  if existing_release is not null then return existing_release; end if;
  perform public.ap_commit_release(p_release_id,regeneration.customer_id,line_row.delivered_order_id,line_row.id,
    'REFERENCE_REGENERATION',now_at,regeneration.due_at,
    jsonb_build_object('regenerationId',regeneration.id,'attemptNumber',regeneration.attempt_number,
      'lineRevisionId',artifact.source_line_revision_id),p_reviewer_id,
    jsonb_build_array(jsonb_build_object('memberType','GENERATED_ARTIFACT','memberId',artifact.id,'position',1)));
  update public.ap_reference_regenerations set state='DELIVERED',delivered_release_id=p_release_id
    where id=regeneration.id;
  update public.ap_capacity_allocations set lifecycle='COMPLETED',updated_at=now_at
    where id=regeneration.capacity_allocation_id and lifecycle='CONSUMED';
  insert into public.ap_outbox_messages(
    id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at
  ) values(p_outbox_id,regeneration.customer_id,line_row.delivered_order_id,'REFERENCE_REGENERATION_DELIVERED',
    p_release_id::text,'reference-regeneration-delivered:'||regeneration.id::text,p_outbox_id::text,'QUEUED',now_at)
  on conflict(deduplication_key) do nothing;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('OUTBOX_SEND',p_outbox_id,'outbox-send:'||p_outbox_id::text,now_at)
  on conflict(idempotency_key) do nothing;
  return p_release_id;
end;
$$;

create or replace function public.ap_revoke_linked_reference_artifacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update public.ap_generated_file_versions file set downloads_revoked_at=coalesce(file.downloads_revoked_at,clock_timestamp())
    from public.ap_artifact_reference_permissions link
    where link.reference_permission_id=new.id and file.artifact_id=link.artifact_id;
    update public.ap_artifact_quality_reviews quality set invalidated_at=coalesce(quality.invalidated_at,clock_timestamp())
    from public.ap_generated_file_versions file
    join public.ap_artifact_reference_permissions link on link.artifact_id=file.artifact_id
    where quality.file_version_id=file.id and link.reference_permission_id=new.id;
  end if;
  return new;
end;
$$;
create trigger ap_reference_permission_artifact_revocation
after update of revoked_at on public.ap_reference_permissions
for each row execute function public.ap_revoke_linked_reference_artifacts();

create or replace function public.ap_authorize_material_download(
  p_customer_id uuid,p_artifact_id uuid,p_file_version_id uuid,p_reauthenticated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare config public.ap_commerce_configuration; artifact public.ap_generated_artifacts;
  file_row public.ap_generated_file_versions; now_at timestamptz:=clock_timestamp(); expires_value timestamptz;
begin
  select * into config from public.ap_commerce_configuration where singleton;
  if config.download_ttl_seconds is distinct from 900 or config.reauthentication_window_seconds is distinct from 900
    or p_reauthenticated_at is null or p_reauthenticated_at>now_at
    or p_reauthenticated_at<now_at-interval '15 minutes'
    then raise exception 'fresh_reauthentication_required'; end if;
  select * into artifact from public.ap_generated_artifacts where id=p_artifact_id
    and customer_id=p_customer_id for update;
  select * into file_row from public.ap_generated_file_versions where id=p_file_version_id
    and artifact_id=artifact.id for update;
  if artifact.id is null or file_row.id is null
    or artifact.current_file_version<>file_row.version or file_row.superseded_at is not null
    or file_row.downloads_revoked_at is not null
    or not exists(select 1 from public.ap_release_members member
      join public.ap_releases release on release.id=member.release_id
      where member.member_type='GENERATED_ARTIFACT' and member.member_id=artifact.id
        and release.customer_id=p_customer_id)
    or exists(select 1 from public.ap_artifact_reference_permissions link
      join public.ap_reference_permissions permission on permission.id=link.reference_permission_id
      where link.artifact_id=artifact.id
        and (permission.revoked_at is not null or permission.contact_version_changed_at is not null))
    then raise exception 'material_download_unavailable'; end if;
  expires_value:=now_at+interval '15 minutes';
  insert into public.ap_material_download_audits(
    customer_id,artifact_id,file_version_id,checksum_sha256,issued_at,expires_at,reauthenticated_at,outcome
  ) values(p_customer_id,artifact.id,file_row.id,file_row.checksum_sha256,now_at,expires_value,
    p_reauthenticated_at,'ISSUED');
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'MATERIAL_DOWNLOAD_AUTHORIZED','GENERATED_FILE_VERSION',file_row.id,
    jsonb_build_object('artifactId',artifact.id,'version',file_row.version,
      'checksumSha256',file_row.checksum_sha256,'expiresAt',expires_value),'chunk5-v1');
  return jsonb_build_object('bucket',file_row.storage_bucket,'path',file_row.storage_path,
    'filename',file_row.safe_filename,'checksumSha256',file_row.checksum_sha256,
    'mimeType',file_row.mime_type,'version',file_row.version,'expiresAt',expires_value);
end;
$$;

create or replace function public.ap_open_postdelivery_false_claim_case(
  p_customer_id uuid,p_material_line_id uuid,p_artifact_id uuid,p_sensitive_payload_id uuid,
  p_non_sensitive_report jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare line_row public.ap_material_lines; purchase public.ap_material_purchases;
  case_id uuid:=gen_random_uuid(); now_at timestamptz:=clock_timestamp();
begin
  select * into line_row from public.ap_material_lines where id=p_material_line_id for update;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  if purchase.customer_id<>p_customer_id or line_row.fulfillment<>'DELIVERED'
    or jsonb_typeof(p_non_sensitive_report)<>'object' or p_non_sensitive_report='{}'::jsonb
    or not exists(select 1 from public.ap_sensitive_payloads
      where id=p_sensitive_payload_id and customer_id=p_customer_id)
    or not exists(select 1 from public.ap_generated_artifacts artifact
      join public.ap_release_members member on member.member_id=artifact.id and member.member_type='GENERATED_ARTIFACT'
      join public.ap_releases release on release.id=member.release_id and release.material_line_id=line_row.id
      where artifact.id=p_artifact_id and artifact.material_line_id=line_row.id and artifact.customer_id=p_customer_id)
    then raise exception 'postdelivery_correction_case_invalid'; end if;
  update public.ap_generated_file_versions file set downloads_revoked_at=coalesce(file.downloads_revoked_at,now_at)
    where file.artifact_id=p_artifact_id;
  update public.ap_artifact_quality_reviews quality set invalidated_at=coalesce(invalidated_at,now_at)
    from public.ap_generated_file_versions file where quality.file_version_id=file.id
      and file.artifact_id=p_artifact_id;
  insert into public.ap_material_support_cases(
    id,customer_id,material_line_id,artifact_id,sensitive_payload_id,case_kind,state,non_sensitive_fact_diff,opened_at
  ) values(case_id,p_customer_id,line_row.id,p_artifact_id,p_sensitive_payload_id,
    'POSTDELIVERY_MATERIAL_FALSE_CLAIM','OPEN',p_non_sensitive_report,now_at);
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'POSTDELIVERY_FALSE_CLAIM_CASE_OPENED','MATERIAL_SUPPORT_CASE',case_id,
    jsonb_build_object('materialLineId',line_row.id,'artifactId',p_artifact_id,
      'releasePreserved',true,'earnedRevenuePreserved',line_row.earned_revenue_at is not null,
      'automaticRefundCreated',false,'automaticRegenerationCreated',false),'chunk5-v1');
  return case_id;
end;
$$;

create or replace function public.ap_fail_reference_regeneration(
  p_regeneration_id uuid,p_reason_code text,p_outbox_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare regeneration public.ap_reference_regenerations; line_row public.ap_material_lines;
  now_at timestamptz:=clock_timestamp();
begin
  select * into regeneration from public.ap_reference_regenerations where id=p_regeneration_id for update;
  if not found then raise exception 'reference_regeneration_not_found'; end if;
  if regeneration.state in ('DELIVERED','FAILED') then return true; end if;
  if regeneration.due_at is null or now_at<=regeneration.due_at then
    raise exception 'reference_regeneration_not_overdue'; end if;
  select * into line_row from public.ap_material_lines where id=regeneration.material_line_id;
  update public.ap_reference_regenerations set state='FAILED',failure_code=left(p_reason_code,100)
    where id=regeneration.id;
  update public.ap_generated_file_versions file set downloads_revoked_at=coalesce(file.downloads_revoked_at,now_at)
    from public.ap_generated_artifacts artifact where file.artifact_id=artifact.id
      and artifact.reference_regeneration_id=regeneration.id;
  update public.ap_capacity_allocations set lifecycle='SUPERSEDED',updated_at=now_at
    where id=regeneration.capacity_allocation_id and lifecycle='CONSUMED';
  insert into public.ap_outbox_messages(
    id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at
  ) values(p_outbox_id,regeneration.customer_id,line_row.delivered_order_id,'REFERENCE_REGENERATION_FAILED',
    regeneration.id::text,'reference-regeneration-failed:'||regeneration.id::text,p_outbox_id::text,'QUEUED',now_at)
  on conflict(deduplication_key) do nothing;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('OUTBOX_SEND',p_outbox_id,'outbox-send:'||p_outbox_id::text,now_at)
  on conflict(idempotency_key) do nothing;
  return true;
end;
$$;

create or replace function public.ap_enqueue_chunk5_due_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare now_at timestamptz:=clock_timestamp(); inserted_count integer:=0; current_count integer;
begin
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  select 'MATERIAL_CHECKOUT_EXPIRY',intent.id,'material-checkout-expiry:'||intent.id::text,intent.expires_at
  from public.ap_material_checkout_intents intent
  where intent.state in ('PREFLIGHT','BLOCKED','READY','OPEN') and intent.expires_at is not null and intent.expires_at<=now_at
  on conflict(idempotency_key) do update set state=case when ap_scheduled_jobs.state='COMPLETED'
    then ap_scheduled_jobs.state else 'RETRY'::public.ap_scheduled_job_state end,
    run_at=least(ap_scheduled_jobs.run_at,excluded.run_at),lease_owner=null,lease_expires_at=null,updated_at=now_at;
  get diagnostics current_count=row_count; inserted_count:=inserted_count+current_count;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  select 'MATERIAL_LINE_DEADLINE',line.id,
    'material-line-deadline:'||line.id::text||':'||line.active_revision::text,line.materials_due_at
  from public.ap_material_lines line
  where line.fulfillment in ('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
    and line.materials_due_at is not null and line.materials_due_at<now_at
    and not exists(select 1 from public.ap_releases release where release.material_line_id=line.id
      and release.release_kind in ('MATERIAL_PAIR','MATERIAL_TRIPLE'))
  on conflict(idempotency_key) do update set state=case when ap_scheduled_jobs.state='COMPLETED'
    then ap_scheduled_jobs.state else 'RETRY'::public.ap_scheduled_job_state end,
    run_at=least(ap_scheduled_jobs.run_at,excluded.run_at),lease_owner=null,lease_expires_at=null,updated_at=now_at;
  get diagnostics current_count=row_count; inserted_count:=inserted_count+current_count;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  select 'MATERIAL_PROPOSAL_EXPIRY',proposal.id,'material-proposal-expiry:'||proposal.id::text,
    proposal.proposal_expires_at
  from public.ap_material_change_proposals proposal
  where proposal.state='PROPOSED' and proposal.proposal_expires_at<now_at
  on conflict(idempotency_key) do update set state=case when ap_scheduled_jobs.state='COMPLETED'
    then ap_scheduled_jobs.state else 'RETRY'::public.ap_scheduled_job_state end,
    run_at=least(ap_scheduled_jobs.run_at,excluded.run_at),lease_owner=null,lease_expires_at=null,updated_at=now_at;
  get diagnostics current_count=row_count; inserted_count:=inserted_count+current_count;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  select 'REFERENCE_REGENERATION_DEADLINE',regeneration.id,
    'reference-regeneration-deadline:'||regeneration.id::text,regeneration.due_at
  from public.ap_reference_regenerations regeneration
  where regeneration.state in ('ACTIVE','HUMAN_REVIEW') and regeneration.due_at<now_at
  on conflict(idempotency_key) do update set state=case when ap_scheduled_jobs.state='COMPLETED'
    then ap_scheduled_jobs.state else 'RETRY'::public.ap_scheduled_job_state end,
    run_at=least(ap_scheduled_jobs.run_at,excluded.run_at),lease_owner=null,lease_expires_at=null,updated_at=now_at;
  get diagnostics current_count=row_count; inserted_count:=inserted_count+current_count;
  return jsonb_build_object('observedAt',now_at,'enqueuedOrRefreshed',inserted_count);
end;
$$;

create or replace function public.ap_apply_chunk5_local_job(
  p_job_id uuid,p_owner text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare job public.ap_scheduled_jobs; intent public.ap_material_checkout_intents;
  line_row public.ap_material_lines; proposal public.ap_material_change_proposals;
  regeneration public.ap_reference_regenerations; purchase public.ap_material_purchases;
  refund_id uuid; applied jsonb; outbox_id uuid:=gen_random_uuid(); now_at timestamptz:=clock_timestamp();
begin
  select * into job from public.ap_scheduled_jobs where id=p_job_id for update;
  if not found or job.state<>'LEASED' or job.lease_owner<>p_owner or job.lease_expires_at<=now_at
    then raise exception 'chunk5_scheduled_job_lease_mismatch'; end if;
  if job.job_kind='MATERIAL_CHECKOUT_EXPIRY' then
    select * into intent from public.ap_material_checkout_intents where id=job.reference_id;
    if intent.id is not null and intent.state in ('PREFLIGHT','BLOCKED','READY','OPEN')
      and intent.expires_at<=now_at then perform public.ap_expire_material_checkout(intent.id,'SCHEDULED_EXPIRY'); end if;
    applied:=jsonb_build_object('kind',job.job_kind,'checkoutIntentId',job.reference_id);
  elsif job.job_kind='MATERIAL_LINE_DEADLINE' then
    select * into line_row from public.ap_material_lines where id=job.reference_id;
    select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
    if line_row.id is not null and line_row.materials_due_at<now_at
      and line_row.fulfillment in ('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE') then
      refund_id:=public.ap_start_material_line_refund(line_row.id,purchase.customer_id,'MATERIAL_DEADLINE_MISSED',true);
    end if;
    applied:=jsonb_build_object('kind',job.job_kind,'materialLineId',job.reference_id,'refundId',refund_id);
  elsif job.job_kind='MATERIAL_PROPOSAL_EXPIRY' then
    select * into proposal from public.ap_material_change_proposals where id=job.reference_id;
    if proposal.id is not null and proposal.state='PROPOSED' and proposal.proposal_expires_at<now_at
      then applied:=public.ap_expire_material_change(proposal.id);
      else applied:=jsonb_build_object('kind',job.job_kind,'proposalId',job.reference_id,'noOp',true); end if;
  elsif job.job_kind='REFERENCE_REGENERATION_DEADLINE' then
    select * into regeneration from public.ap_reference_regenerations where id=job.reference_id;
    if regeneration.id is not null and regeneration.state in ('ACTIVE','HUMAN_REVIEW')
      and regeneration.due_at<now_at then
      perform public.ap_fail_reference_regeneration(regeneration.id,'REFERENCE_REGENERATION_DEADLINE_MISSED',outbox_id);
    end if;
    applied:=jsonb_build_object('kind',job.job_kind,'regenerationId',job.reference_id);
  else
    raise exception 'unsupported_chunk5_local_job';
  end if;
  update public.ap_scheduled_jobs set state='COMPLETED',lease_owner=null,lease_expires_at=null,
    updated_at=now_at where id=job.id;
  return applied;
end;
$$;

create or replace function public.ap_chunk5_monitor_snapshot()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'materialsCheckoutOpen',(select count(*) from public.ap_material_checkout_intents where state='OPEN'),
    'materialsCheckoutExpiredPendingWorker',(select count(*) from public.ap_material_checkout_intents
      where state in ('PREFLIGHT','BLOCKED','READY','OPEN') and expires_at<clock_timestamp()),
    'materialsLinesApproachingDeadline',(select count(*) from public.ap_material_lines
      where fulfillment in ('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
        and materials_due_at between clock_timestamp() and clock_timestamp()+interval '2 hours'),
    'materialsLinesPastDeadline',(select count(*) from public.ap_material_lines
      where fulfillment in ('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
        and materials_due_at<clock_timestamp()),
    'materialProposalsAwaitingResponse',(select count(*) from public.ap_material_change_proposals where state='PROPOSED'),
    'referenceRegenerationsActive',(select count(*) from public.ap_reference_regenerations
      where state in ('ACTIVE','HUMAN_REVIEW')),
    'referenceRegenerationsPastDeadline',(select count(*) from public.ap_reference_regenerations
      where state in ('ACTIVE','HUMAN_REVIEW') and due_at<clock_timestamp()),
    'artifactQaAwaitingHuman',(select count(*) from public.ap_artifact_quality_reviews
      where automated_passed_at is not null and invalidated_at is null
        and (content_approved_at is null or visual_approved_at is null)),
    'revokedHostedFiles',(select count(*) from public.ap_generated_file_versions where downloads_revoked_at is not null),
    'openFalseClaimCases',(select count(*) from public.ap_material_support_cases where state='OPEN')
  );
$$;

create or replace function public.ap_guard_material_line_v2()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then raise exception 'material_line_history_is_immutable'; end if;
  if old.purchase_id<>new.purchase_id or old.delivered_order_id<>new.delivered_order_id
    or old.payment_attempt_id<>new.payment_attempt_id or old.payment_allocation_key<>new.payment_allocation_key
    or old.allocated_amount_cents<>new.allocated_amount_cents or old.selection_confirmed_at is distinct from new.selection_confirmed_at
    then raise exception 'material_line_financial_identity_is_immutable'; end if;
  if new.active_revision<old.active_revision then raise exception 'material_line_revision_cannot_regress'; end if;
  if old.earned_revenue_at is not null and new.earned_revenue_at is distinct from old.earned_revenue_at
    then raise exception 'earned_material_revenue_is_immutable'; end if;
  if new.earned_revenue_at is not null and new.fulfillment<>'DELIVERED'
    then raise exception 'earned_material_revenue_requires_delivery'; end if;
  if old.fulfillment='DELIVERED' and new.fulfillment<>'DELIVERED'
    then raise exception 'delivered_material_line_cannot_regress'; end if;
  return new;
end;
$$;
create trigger ap_material_line_v2_guard before update or delete on public.ap_material_lines
for each row execute function public.ap_guard_material_line_v2();

create or replace function public.ap_guard_submission_rule_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then raise exception 'submission_rule_history_is_immutable'; end if;
  if (to_jsonb(new)-array['is_current','superseded_at'])<>(to_jsonb(old)-array['is_current','superseded_at'])
    or old.is_current=false or (new.is_current and new.superseded_at is not null)
    then raise exception 'submission_rule_content_is_immutable'; end if;
  return new;
end;
$$;
create trigger ap_submission_rule_history_guard before update or delete on public.ap_employer_submission_rules
for each row execute function public.ap_guard_submission_rule_history();

do $$ declare table_name text; begin
  foreach table_name in array array[
    'ap_employer_submission_rules','ap_material_checkout_intents','ap_material_checkout_items',
    'ap_material_checkout_references','ap_material_listing_checks','ap_material_change_proposals',
    'ap_artifact_quality_reviews','ap_reference_isolation_reviews','ap_reference_regenerations',
    'ap_artifact_reference_permissions','ap_material_download_audits','ap_material_support_cases'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public,anon,authenticated',table_name);
    execute format('grant all privileges on public.%I to service_role',table_name);
  end loop;
end $$;

grant select on public.ap_material_checkout_intents,public.ap_reference_isolation_reviews,
  public.ap_reference_regenerations,public.ap_material_download_audits,public.ap_material_support_cases
  to authenticated;
grant select on public.ap_release_members,public.ap_employer_submission_rules
  to authenticated;
create policy ap_release_members_owner_select on public.ap_release_members
  for select to authenticated using (exists(select 1 from public.ap_releases release
    where release.id=release_id and public.ap_can_access_customer(release.customer_id)));
create policy ap_employer_submission_rules_customer_evaluation_select on public.ap_employer_submission_rules
  for select to authenticated using (exists(select 1 from public.ap_match_evaluations evaluation
    where evaluation.job_snapshot_id=job_snapshot_id and public.ap_can_access_customer(evaluation.customer_id)));
create policy ap_material_checkout_intents_owner_select on public.ap_material_checkout_intents
  for select to authenticated using (public.ap_can_access_customer(customer_id));
create policy ap_reference_isolation_reviews_owner_select on public.ap_reference_isolation_reviews
  for select to authenticated using (public.ap_can_access_customer(customer_id));
create policy ap_reference_regenerations_owner_select on public.ap_reference_regenerations
  for select to authenticated using (public.ap_can_access_customer(customer_id));
create policy ap_material_download_audits_owner_select on public.ap_material_download_audits
  for select to authenticated using (public.ap_can_access_customer(customer_id));
create policy ap_material_support_cases_owner_select on public.ap_material_support_cases
  for select to authenticated using (public.ap_can_access_customer(customer_id));

grant select on public.ap_material_checkout_items,public.ap_material_checkout_references,
  public.ap_material_listing_checks,public.ap_material_change_proposals,
  public.ap_artifact_quality_reviews,public.ap_artifact_reference_permissions to authenticated;
create policy ap_material_checkout_items_owner_select on public.ap_material_checkout_items
  for select to authenticated using (exists(select 1 from public.ap_material_checkout_intents intent
    where intent.id=checkout_intent_id and public.ap_can_access_customer(intent.customer_id)));
create policy ap_material_checkout_references_owner_select on public.ap_material_checkout_references
  for select to authenticated using (exists(select 1 from public.ap_material_checkout_items item
    join public.ap_material_checkout_intents intent on intent.id=item.checkout_intent_id
    where item.id=checkout_item_id and public.ap_can_access_customer(intent.customer_id)));
create policy ap_material_listing_checks_owner_select on public.ap_material_listing_checks
  for select to authenticated using (exists(select 1 from public.ap_material_lines line
    join public.ap_material_purchases purchase on purchase.id=line.purchase_id
    where line.id=material_line_id and public.ap_can_access_customer(purchase.customer_id)));
create policy ap_material_change_proposals_owner_select on public.ap_material_change_proposals
  for select to authenticated using (exists(select 1 from public.ap_material_lines line
    join public.ap_material_purchases purchase on purchase.id=line.purchase_id
    where line.id=material_line_id and public.ap_can_access_customer(purchase.customer_id)));
create policy ap_artifact_quality_reviews_owner_select on public.ap_artifact_quality_reviews
  for select to authenticated using (exists(select 1 from public.ap_generated_file_versions file
    join public.ap_generated_artifacts artifact on artifact.id=file.artifact_id
    where file.id=file_version_id and public.ap_can_access_customer(artifact.customer_id)));
create policy ap_artifact_reference_permissions_owner_select on public.ap_artifact_reference_permissions
  for select to authenticated using (exists(select 1 from public.ap_generated_artifacts artifact
    where artifact.id=artifact_id and public.ap_can_access_customer(artifact.customer_id)));

revoke all on public.ap_material_purchase_status from public,anon;
grant select on public.ap_material_purchase_status to authenticated,service_role;

revoke all on function public.ap_commit_release(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,uuid,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.ap_activate_material_line_revision(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.ap_claim_material_entitlement(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.ap_release_fully_refunded_entitlement(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.ap_queue_material_line_refund(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;

revoke all on function public.ap_require_material_reviewer(uuid) from public,anon,authenticated;
revoke all on function public.ap_append_material_entitlement_state_v2(uuid,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.ap_upsert_employer_submission_rules(uuid,uuid,text,uuid[],text,text,text[],integer,integer,text,text,text,text,integer,text,text,text,jsonb,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.ap_begin_material_checkout(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text,text,boolean,boolean,boolean) from public,anon,authenticated;
revoke all on function public.ap_promote_material_checkout(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.ap_expire_material_checkout(uuid,text) from public,anon,authenticated;
revoke all on function public.ap_apply_verified_material_payment(text,text,text,timestamptz,uuid,text,text,text,text,integer,text,text,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.ap_start_material_line_refund(uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.ap_record_material_listing_check(uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.ap_offer_material_substitution(uuid,uuid,uuid,uuid,text,timestamptz,integer,text) from public,anon,authenticated;
revoke all on function public.ap_propose_material_fact_correction(uuid,uuid,uuid,jsonb,boolean,boolean,text,timestamptz,integer,text) from public,anon,authenticated;
revoke all on function public.ap_consume_material_revision_capacity(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.ap_accept_material_substitution(uuid,uuid,text,boolean,uuid[],text,uuid) from public,anon,authenticated;
revoke all on function public.ap_accept_material_fact_correction(uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.ap_decline_material_change(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.ap_expire_material_change(uuid) from public,anon,authenticated;
revoke all on function public.ap_amend_material_reference_scope(uuid,uuid,boolean,uuid[],text) from public,anon,authenticated;
revoke all on function public.ap_register_material_artifact_version(uuid,uuid,uuid,uuid,public.ap_artifact_type,uuid,uuid,uuid,uuid,uuid[],jsonb,text,text,text,text,text,text,integer,text,text,jsonb,jsonb,text,integer,text,text,text,text,text,text,text[],boolean) from public,anon,authenticated;
revoke all on function public.ap_record_material_human_approval(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.ap_commit_material_release_v2(uuid,uuid,uuid,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.ap_record_reference_isolation(uuid,uuid,text,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.ap_request_reference_regeneration(uuid,uuid,uuid,uuid[],text,uuid) from public,anon,authenticated;
revoke all on function public.ap_commit_reference_regeneration(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.ap_open_postdelivery_false_claim_case(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.ap_fail_reference_regeneration(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.ap_enqueue_chunk5_due_jobs() from public,anon,authenticated;
revoke all on function public.ap_apply_chunk5_local_job(uuid,text) from public,anon,authenticated;
revoke all on function public.ap_chunk5_monitor_snapshot() from public,anon,authenticated;

grant execute on function public.ap_require_material_reviewer(uuid) to service_role;
grant execute on function public.ap_append_material_entitlement_state_v2(uuid,text,uuid,uuid) to service_role;
grant execute on function public.ap_upsert_employer_submission_rules(uuid,uuid,text,uuid[],text,text,text[],integer,integer,text,text,text,text,integer,text,text,text,jsonb,text,text,text,timestamptz) to service_role;
grant execute on function public.ap_begin_material_checkout(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text,text,boolean,boolean,boolean) to service_role;
grant execute on function public.ap_promote_material_checkout(uuid,text,timestamptz) to service_role;
grant execute on function public.ap_expire_material_checkout(uuid,text) to service_role;
grant execute on function public.ap_apply_verified_material_payment(text,text,text,timestamptz,uuid,text,text,text,text,integer,text,text,timestamptz,uuid) to service_role;
grant execute on function public.ap_start_material_line_refund(uuid,uuid,text,boolean) to service_role;
grant execute on function public.ap_record_material_listing_check(uuid,uuid,text,text,uuid,text) to service_role;
grant execute on function public.ap_offer_material_substitution(uuid,uuid,uuid,uuid,text,timestamptz,integer,text) to service_role;
grant execute on function public.ap_propose_material_fact_correction(uuid,uuid,uuid,jsonb,boolean,boolean,text,timestamptz,integer,text) to service_role;
grant execute on function public.ap_consume_material_revision_capacity(uuid,uuid,uuid,text) to service_role;
grant execute on function public.ap_accept_material_substitution(uuid,uuid,text,boolean,uuid[],text,uuid) to service_role;
grant execute on function public.ap_accept_material_fact_correction(uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.ap_decline_material_change(uuid,uuid,text) to service_role;
grant execute on function public.ap_expire_material_change(uuid) to service_role;
grant execute on function public.ap_amend_material_reference_scope(uuid,uuid,boolean,uuid[],text) to service_role;
grant execute on function public.ap_register_material_artifact_version(uuid,uuid,uuid,uuid,public.ap_artifact_type,uuid,uuid,uuid,uuid,uuid[],jsonb,text,text,text,text,text,text,integer,text,text,jsonb,jsonb,text,integer,text,text,text,text,text,text,text[],boolean) to service_role;
grant execute on function public.ap_record_material_human_approval(uuid,uuid,text,text) to service_role;
grant execute on function public.ap_commit_material_release_v2(uuid,uuid,uuid,jsonb,text,uuid) to service_role;
grant execute on function public.ap_record_reference_isolation(uuid,uuid,text,uuid,text,text,uuid) to service_role;
grant execute on function public.ap_request_reference_regeneration(uuid,uuid,uuid,uuid[],text,uuid) to service_role;
grant execute on function public.ap_commit_reference_regeneration(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz) to service_role;
grant execute on function public.ap_open_postdelivery_false_claim_case(uuid,uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.ap_fail_reference_regeneration(uuid,text,uuid) to service_role;
grant execute on function public.ap_enqueue_chunk5_due_jobs() to service_role;
grant execute on function public.ap_apply_chunk5_local_job(uuid,text) to service_role;
grant execute on function public.ap_chunk5_monitor_snapshot() to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,content_sha256,completed_at)
values('202609070031','CHUNK5_MATERIALS_DELIVERY_V1',0,
  encode(extensions.digest(convert_to('chunk5-materials-delivery-v1','UTF8'),'sha256'),'hex'),clock_timestamp())
on conflict(migration_id,checkpoint) do nothing;
