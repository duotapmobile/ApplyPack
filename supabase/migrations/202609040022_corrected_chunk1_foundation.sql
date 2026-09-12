-- Corrected-contract Chunk 1 foundation. This migration is additive: legacy
-- tables remain readable and are backfilled only into compatibility records.

create extension if not exists btree_gist with schema extensions;

create type public.ap_draft_state as enum ('IN_PROGRESS','COMPLETE','LOCKED_TO_CHECKOUT','CONVERTED','EXPIRED');
create type public.ap_document_kind as enum ('RESUME','PRIOR_COVER_LETTER');
create type public.ap_document_processing_state as enum ('UPLOADED','QUARANTINED','SCANNING','EXTRACTING','READY','FAILED','SUPERSEDED');
create type public.ap_evidence_verification as enum ('EXTRACTED_UNCONFIRMED','CUSTOMER_CONFIRMED','HUMAN_VERIFIED','CUSTOMER_REJECTED','DISPUTED');
create type public.ap_candidate_fact_source as enum ('DOCUMENT','CUSTOMER_ASSERTION','HUMAN_VERIFICATION');
create type public.ap_experience_kind as enum ('PAID_EMPLOYMENT','SELF_EMPLOYMENT_BUSINESS','CONTRACT_FREELANCE','VOLUNTEER','PROJECT','EDUCATION','CAREER_BREAK','CAREGIVING');
create type public.ap_job_origin as enum ('APPLYPACK_FOUND','CUSTOMER_SUPPLIED');
create type public.ap_requirement_node_kind as enum ('ALL_OF','ANY_OF','CRITERION');
create type public.ap_criterion_type as enum ('WORK_MODE','GEOGRAPHY','COMMUTE','EMPLOYMENT_TYPE','COMPENSATION','SCHEDULE','TRAVEL_PHYSICAL','DUTY_EXCLUSION','AUTHORIZATION_SPONSORSHIP','EDUCATION','CERTIFICATION_LICENSE','EXPERIENCE','RESPONSIBILITY','TOOL_CAPABILITY','BENEFIT','INDUSTRY_DOMAIN','CUSTOMER_TITLE_RESTRICTION','CUSTOM_EXCLUSION','LISTING_APPLICATION_PATH');
create type public.ap_criterion_result as enum ('PASS','FAIL','UNKNOWN');
create type public.ap_resolution_issue as enum ('NONE','CANDIDATE_MISSING','EMPLOYER_OMITTED','PARSER_UNCERTAIN','EVIDENCE_CONFLICT');
create type public.ap_unknown_treatment as enum ('BLOCK','ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING','IMMATERIAL_ALTERNATIVE');
create type public.ap_eligibility_disposition as enum ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS','INELIGIBLE','NEEDS_CANDIDATE_INPUT','NEEDS_HUMAN_REVIEW','INVALID');
create type public.ap_salary_status as enum ('PUBLISHED_MEETS_MINIMUM','PUBLISHED_OVERLAPS_MINIMUM','PUBLISHED_BELOW_MINIMUM','PUBLISHED_NONCOMPARABLE','UNPUBLISHED','ESTIMATE_ONLY');
create type public.ap_salary_gate_disposition as enum ('PASS','FAIL','ALLOWED_WITH_WARNING','NEEDS_HUMAN_REVIEW','NOT_APPLICABLE');
create type public.ap_application_readiness as enum ('READY','NEEDS_CUSTOMER_ACTION','BLOCKED');
create type public.ap_presentation_risk as enum ('LOW','MEDIUM','HIGH','NOT_ASSESSED');
create type public.ap_feasibility_run_state as enum ('NOT_RUN','PENDING','COMPLETE','STALE','ERROR');
create type public.ap_feasibility_outcome as enum ('LIKELY','LIMITED','INFEASIBLE');
create type public.ap_feasibility_reason as enum ('INVENTORY_SHORTAGE','QUALIFICATION_GAP','EVIDENCE_GAP','CONSTRAINT_COLLISION','COMPENSATION_BELOW_MINIMUM','COMPENSATION_UNCONFIRMED');
create type public.ap_resolution_blocker as enum ('NONE','NEEDS_CANDIDATE_INPUT','NEEDS_HUMAN_REVIEW');
create type public.ap_capacity_resource as enum ('SEARCH','MATERIALS','REFERENCE_REGENERATION');
create type public.ap_capacity_lifecycle as enum ('NONE','RESERVED','CONSUMED','COMPLETED','SUPERSEDED','RELEASED','EXPIRED');
create type public.ap_capacity_debit as enum ('NONE','HELD','SPENT','RETURNED');
create type public.ap_checkout_state as enum ('NONE','OPEN','CANCELED','EXPIRED','COMPLETED','FAILED');
create type public.ap_payment_settlement as enum ('UNPAID','PROCESSING','PAID','FAILED');
create type public.ap_payment_dispute as enum ('NONE','OPEN','WON','LOST');
create type public.ap_refund_scope as enum ('FULL_SEARCH','DUPLICATE_ATTEMPT','STALE_ATTEMPT','MATERIAL_LINE');
create type public.ap_refund_state as enum ('PENDING','SUCCEEDED','FAILED');
create type public.ap_search_fulfillment as enum ('QUEUED','RESEARCHING','HUMAN_REVIEW','ADJUSTMENT_REQUIRED','READY_TO_RELEASE','DELIVERED','CANCELED');
create type public.ap_adjustment_state as enum ('NONE','PROPOSED','ACCEPTED','DECLINED','EXPIRED');
create type public.ap_outbox_state as enum ('QUEUED','SENDING','SENT','RETRY','DEAD_LETTER');
create type public.ap_material_readiness as enum ('PENDING','BLOCKED_ON_CUSTOMER_INPUT','CHECKOUT_ELIGIBLE');
create type public.ap_material_fulfillment as enum ('NOT_PURCHASED','PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE','DELIVERED','CANCELED');
create type public.ap_material_substitution as enum ('NONE','REQUIRED','OFFERED','ACCEPTED','DECLINED','EXPIRED');
create type public.ap_command_state as enum ('CREATING','CREATED','APPLYING','APPLIED','COMPENSATING','COMPENSATED','FAILED');
create type public.ap_artifact_type as enum ('RESUME','COVER_LETTER','REFERENCE_SHEET');
create type public.ap_retention_state as enum ('ACTIVE','EXPIRY_PENDING','DELETE_PENDING','DELETED','CRYPTO_SHREDDED','LEGAL_HOLD');
create type public.ap_reference_permission as enum ('UNCONFIRMED','CONFIRMED','REVOKED');
create type public.ap_scheduled_job_state as enum ('QUEUED','LEASED','RETRY','COMPLETED','DEAD_LETTER');

create table public.ap_anonymous_drafts (
  id uuid primary key,
  capability_secret_hash text not null unique check (capability_secret_hash ~ '^[0-9a-f]{64}$'),
  capability_version integer not null default 1 check (capability_version > 0),
  state public.ap_draft_state not null default 'IN_PROGRESS',
  version bigint not null default 1 check (version > 0),
  current_step integer not null default 0 check (current_step between 0 and 6),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  access_email_normalized text,
  converted_customer_id uuid references public.profiles(id),
  converted_intake_id uuid references public.intakes(id),
  capability_rotated_at timestamptz,
  expires_at timestamptz not null,
  retention_state public.ap_retention_state not null default 'ACTIVE',
  retention_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (access_email_normalized is null or access_email_normalized = lower(trim(access_email_normalized))),
  check (expires_at > created_at),
  check ((state = 'CONVERTED') = (converted_intake_id is not null))
);
create index ap_anonymous_drafts_expiry_idx on public.ap_anonymous_drafts(expires_at) where state not in ('CONVERTED','EXPIRED');

create table public.ap_sensitive_payloads (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references public.ap_anonymous_drafts(id),
  customer_id uuid references public.profiles(id),
  ciphertext bytea not null,
  encryption_algorithm text not null check (encryption_algorithm = 'AES-256-GCM'),
  encrypted_data_key bytea not null check (octet_length(encrypted_data_key) > 0),
  nonce bytea not null check (octet_length(nonce) = 12),
  authentication_tag bytea not null check (octet_length(authentication_tag) = 16),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  kms_key_identity text not null,
  kms_key_version text not null,
  encryption_context_hash text not null check (encryption_context_hash ~ '^[0-9a-f]{64}$'),
  retention_state public.ap_retention_state not null default 'ACTIVE',
  retention_due_at timestamptz,
  created_at timestamptz not null default now(),
  check ((draft_id is not null)::integer + (customer_id is not null)::integer = 1),
  unique(id, content_sha256)
);

create table public.ap_document_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references public.ap_anonymous_drafts(id),
  intake_id uuid references public.intakes(id),
  customer_id uuid references public.profiles(id),
  kind public.ap_document_kind not null,
  version integer not null check (version > 0),
  processing_state public.ap_document_processing_state not null default 'UPLOADED',
  is_current boolean not null default true,
  supersedes_id uuid references public.ap_document_versions(id),
  safe_display_name text not null check (length(safe_display_name) between 1 and 255),
  storage_bucket text not null check (storage_bucket = 'customer-source-documents'),
  storage_path text not null unique,
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  claimed_mime_type text not null,
  verified_mime_type text not null check (verified_mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  malware_status text not null default 'PENDING' check (malware_status in ('PENDING','CLEAN','BLOCKED','ERROR')),
  malware_provider_ref text,
  parse_status text not null default 'PENDING' check (parse_status in ('PENDING','SUCCEEDED','BLOCKED','ERROR')),
  parser_identity text,
  parser_limits jsonb,
  reference_isolation_status text not null default 'PENDING' check (reference_isolation_status in ('PENDING','CLEAR','DETECTED','UNCERTAIN','ERROR')),
  leak_scan_status text not null default 'PENDING' check (leak_scan_status in ('PENDING','CLEAR','BLOCKED','ERROR')),
  permitted_model_policy text,
  model_ready_at timestamptz,
  failure_code text,
  retention_state public.ap_retention_state not null default 'ACTIVE',
  retention_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((draft_id is not null)::integer + (intake_id is not null)::integer = 1),
  check (customer_id is not null or draft_id is not null),
  check (claimed_mime_type = verified_mime_type),
  check ((processing_state = 'READY') = (model_ready_at is not null)),
  unique(draft_id, kind, version),
  unique(intake_id, kind, version)
);
create unique index ap_document_versions_current_draft_idx on public.ap_document_versions(draft_id, kind) where draft_id is not null and is_current;
create unique index ap_document_versions_current_intake_idx on public.ap_document_versions(intake_id, kind) where intake_id is not null and is_current;
create index ap_document_versions_pipeline_idx on public.ap_document_versions(processing_state, created_at) where processing_state not in ('READY','FAILED','SUPERSEDED');

create table public.ap_intake_snapshots (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references public.ap_anonymous_drafts(id),
  intake_id uuid references public.intakes(id),
  customer_id uuid references public.profiles(id),
  parent_snapshot_id uuid references public.ap_intake_snapshots(id),
  version integer not null check (version > 0),
  snapshot_kind text not null check (snapshot_kind in ('INITIAL','PRE_ACTIVATION_EDIT','SEARCH_ADJUSTMENT','MATERIAL_FACT_REVISION')),
  access_email_normalized text not null check (access_email_normalized = lower(trim(access_email_normalized))),
  payer_receipt_email text,
  document_contact_email text,
  desired_activities jsonb not null check (jsonb_typeof(desired_activities) = 'array'),
  avoided_activities jsonb not null check (jsonb_typeof(avoided_activities) = 'array'),
  optional_titles jsonb not null check (jsonb_typeof(optional_titles) = 'array'),
  confirmed_title_restriction jsonb check (confirmed_title_restriction is null or jsonb_typeof(confirmed_title_restriction) = 'object'),
  optional_industries jsonb not null check (jsonb_typeof(optional_industries) = 'array'),
  blocked_industries jsonb not null check (jsonb_typeof(blocked_industries) = 'array'),
  search_breadth text not null check (search_breadth in ('CLOSE_TO_PREVIOUS_WORK','ADJACENT_OPPORTUNITIES','BROADEST_SUPPORTED_SCOPE')),
  guidance_requested boolean not null,
  work_modes jsonb not null check (jsonb_typeof(work_modes) = 'array'),
  us_state_or_dc text,
  employment_types jsonb not null check (jsonb_typeof(employment_types) = 'array'),
  schedules jsonb not null check (jsonb_typeof(schedules) = 'array'),
  travel jsonb not null check (jsonb_typeof(travel) = 'object'),
  benefits jsonb not null check (jsonb_typeof(benefits) = 'object'),
  dealbreakers jsonb not null check (jsonb_typeof(dealbreakers) = 'array'),
  currency text not null default 'USD' check (currency = 'USD'),
  salary_target_cents integer check (salary_target_cents is null or salary_target_cents >= 0),
  salary_hard_minimum_cents integer check (salary_hard_minimum_cents is null or salary_hard_minimum_cents >= 0),
  salary_minimum_flexible boolean not null,
  salary_period text check (salary_period is null or salary_period in ('HOUR','YEAR')),
  salary_basis text check (salary_basis is null or salary_basis in ('BASE','GUARANTEED_TOTAL')),
  salary_overlap_policy text not null,
  salary_unpublished_policy text not null,
  salary_noncomparable_policy text not null,
  salary_variable_pay_policy text not null,
  employer_unknown_policy jsonb not null check (jsonb_typeof(employer_unknown_policy) = 'object'),
  prior_cover_letter_use text not null check (prior_cover_letter_use in ('FACT_EXTRACTION_ONLY','FACT_EXTRACTION_AND_VOICE','NEITHER')),
  targeted_authorization_answers jsonb not null check (jsonb_typeof(targeted_authorization_answers) = 'object'),
  sensitive_payload_id uuid references public.ap_sensitive_payloads(id),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  canonicalization_version text not null,
  schema_version text not null,
  finalized_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(draft_id, version),
  unique(intake_id, version),
  unique(id, content_sha256)
);

create table public.ap_independent_verification_sources (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  encrypted_payload_id uuid not null references public.ap_sensitive_payloads(id),
  source_type text not null,
  source_locator text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  reviewer_id uuid not null references public.profiles(id),
  verified_at timestamptz not null,
  retention_state public.ap_retention_state not null default 'ACTIVE',
  retention_due_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.ap_candidate_facts (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references public.ap_anonymous_drafts(id),
  customer_id uuid references public.profiles(id),
  snapshot_id uuid references public.ap_intake_snapshots(id),
  semantic_key text not null,
  value_kind text not null,
  typed_value jsonb not null check (jsonb_typeof(typed_value) = 'object'),
  source_kind public.ap_candidate_fact_source not null,
  document_version_id uuid references public.ap_document_versions(id),
  customer_assertion_snapshot_id uuid references public.ap_intake_snapshots(id),
  assertion_control_id text,
  supplied_source_id uuid references public.ap_independent_verification_sources(id),
  source_locator text not null,
  human_reviewer_id uuid references public.profiles(id),
  extraction_confidence numeric(5,4) check (extraction_confidence between 0 and 1),
  verification public.ap_evidence_verification not null,
  confirmed_or_corrected_at timestamptz,
  catalog_version text not null,
  schema_version text not null,
  starts_on date,
  ends_on date,
  calendar_duration_days integer check (calendar_duration_days is null or calendar_duration_days >= 0),
  intensity_percent numeric(5,2) check (intensity_percent is null or intensity_percent between 0 and 100),
  capability_status text check (capability_status is null or capability_status in ('CAN_DO_NOW','DONE_BEFORE_NEEDS_REFRESHER','BASIC_EXPOSURE','NOT_DONE','UNSURE')),
  supersedes_fact_id uuid references public.ap_candidate_facts(id),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  check ((draft_id is not null)::integer + (customer_id is not null)::integer >= 1),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (
    (source_kind = 'DOCUMENT' and document_version_id is not null and customer_assertion_snapshot_id is null and assertion_control_id is null and supplied_source_id is null and human_reviewer_id is null)
    or (source_kind = 'CUSTOMER_ASSERTION' and document_version_id is null and customer_assertion_snapshot_id is not null and assertion_control_id is not null and supplied_source_id is null and human_reviewer_id is null)
    or (source_kind = 'HUMAN_VERIFICATION' and document_version_id is null and customer_assertion_snapshot_id is null and assertion_control_id is null and supplied_source_id is not null and human_reviewer_id is not null)
  ),
  check (verification <> 'HUMAN_VERIFIED' or source_kind = 'HUMAN_VERIFICATION')
);
create index ap_candidate_facts_owner_key_idx on public.ap_candidate_facts(customer_id, semantic_key) where superseded_at is null;

create table public.ap_candidate_fact_conflicts (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references public.ap_candidate_facts(id),
  conflicting_fact_id uuid not null references public.ap_candidate_facts(id),
  resolution text not null check (resolution in ('OPEN','CUSTOMER_CORRECTION','CUSTOMER_REJECTION','HUMAN_REVIEW','DISPUTED')),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (fact_id <> conflicting_fact_id),
  unique(fact_id, conflicting_fact_id)
);

create table public.ap_experience_identities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id),
  draft_id uuid references public.ap_anonymous_drafts(id),
  kind public.ap_experience_kind not null,
  label text not null,
  starts_on date,
  ends_on date,
  calendar_duration_days integer check (calendar_duration_days is null or calendar_duration_days >= 0),
  intensity_percent numeric(5,2) check (intensity_percent is null or intensity_percent between 0 and 100),
  occupational_credit_eligible boolean not null,
  source_fact_id uuid not null references public.ap_candidate_facts(id),
  created_at timestamptz not null default now(),
  check ((draft_id is not null)::integer + (customer_id is not null)::integer >= 1),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (kind not in ('CAREER_BREAK','CAREGIVING') or occupational_credit_eligible = false)
);

create table public.ap_catalog_versions (
  id uuid primary key default gen_random_uuid(),
  catalog_kind text not null,
  version text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(catalog_kind, version)
);

create table public.ap_inventory_versions (
  id uuid primary key default gen_random_uuid(),
  cutoff_at timestamptz not null,
  source_registry_version text not null,
  query_version text not null,
  parser_version text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table public.ap_feasibility_coverage_plans (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.ap_intake_snapshots(id),
  inventory_version_id uuid not null references public.ap_inventory_versions(id),
  plan_version text not null,
  typed_inputs jsonb not null check (jsonb_typeof(typed_inputs) = 'object'),
  coverage_disposition text not null check (coverage_disposition in ('REQUIRED','NOT_REQUIRED_CONSTRAINT_COLLISION')),
  constraint_proof jsonb check (constraint_proof is null or jsonb_typeof(constraint_proof) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check ((coverage_disposition = 'NOT_REQUIRED_CONSTRAINT_COLLISION') = (constraint_proof is not null))
);

create table public.ap_feasibility_coverage_cells (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ap_feasibility_coverage_plans(id) on delete cascade,
  source_id text not null,
  authorization_mode text not null,
  query_fingerprint text not null check (query_fingerprint ~ '^[0-9a-f]{64}$'),
  pagination_bound integer not null check (pagination_bound > 0),
  lookback_bound interval not null check (lookback_bound > interval '0 seconds'),
  result_bound integer not null check (result_bound > 0),
  execution_path text not null check (execution_path in ('MANUAL','AUTOMATED')),
  terminal_outcome text check (terminal_outcome in ('SUCCEEDED_WITH_RESULTS','SUCCEEDED_EMPTY','FAILED','PENDING')),
  cursor_or_stop_reason text,
  result_count integer check (result_count is null or result_count >= 0),
  parser_result jsonb check (parser_result is null or jsonb_typeof(parser_result) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  unique(plan_id, source_id, query_fingerprint)
);

create table public.ap_feasibility_assessments (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.ap_intake_snapshots(id),
  coverage_plan_id uuid not null references public.ap_feasibility_coverage_plans(id),
  state public.ap_feasibility_run_state not null default 'NOT_RUN',
  outcome public.ap_feasibility_outcome,
  resolution_blocker public.ap_resolution_blocker not null default 'NONE',
  preliminarily_deliverable_count integer check (preliminarily_deliverable_count is null or preliminarily_deliverable_count >= 0),
  reviewable_count integer check (reviewable_count is null or reviewable_count >= 0),
  excluded_count integer check (excluded_count is null or excluded_count >= 0),
  reasons public.ap_feasibility_reason[] not null default '{}',
  primary_reason public.ap_feasibility_reason,
  rules_version text not null,
  expires_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  check ((state = 'COMPLETE') = (outcome is not null)),
  check (state <> 'COMPLETE' or (preliminarily_deliverable_count is not null and reviewable_count is not null and excluded_count is not null)),
  check (state <> 'COMPLETE' or (
    (outcome = 'LIKELY' and preliminarily_deliverable_count >= 10)
    or (outcome = 'LIMITED' and preliminarily_deliverable_count < 10 and preliminarily_deliverable_count + reviewable_count >= 1)
    or (outcome = 'INFEASIBLE' and preliminarily_deliverable_count = 0 and reviewable_count = 0)
  )),
  check (
    (cardinality(reasons) = 0 and primary_reason is null)
    or (cardinality(reasons) > 0 and primary_reason = case
      when 'CONSTRAINT_COLLISION' = any(reasons) then 'CONSTRAINT_COLLISION'::public.ap_feasibility_reason
      when 'QUALIFICATION_GAP' = any(reasons) then 'QUALIFICATION_GAP'::public.ap_feasibility_reason
      when 'EVIDENCE_GAP' = any(reasons) then 'EVIDENCE_GAP'::public.ap_feasibility_reason
      when 'COMPENSATION_BELOW_MINIMUM' = any(reasons) then 'COMPENSATION_BELOW_MINIMUM'::public.ap_feasibility_reason
      when 'COMPENSATION_UNCONFIRMED' = any(reasons) then 'COMPENSATION_UNCONFIRMED'::public.ap_feasibility_reason
      else 'INVENTORY_SHORTAGE'::public.ap_feasibility_reason end)
  )
);

create or replace function public.ap_guard_feasibility_completion()
returns trigger language plpgsql set search_path = '' as $$
declare plan public.ap_feasibility_coverage_plans;
begin
  select * into plan from public.ap_feasibility_coverage_plans where id = new.coverage_plan_id;
  if not found or plan.snapshot_id <> new.snapshot_id then raise exception 'feasibility_plan_snapshot_mismatch'; end if;
  if new.state = 'COMPLETE' then
    if plan.coverage_disposition = 'REQUIRED' and (
      not exists (select 1 from public.ap_feasibility_coverage_cells where plan_id = plan.id)
      or exists (select 1 from public.ap_feasibility_coverage_cells where plan_id = plan.id and terminal_outcome not in ('SUCCEEDED_WITH_RESULTS','SUCCEEDED_EMPTY'))
    ) then raise exception 'feasibility_coverage_incomplete'; end if;
    if plan.coverage_disposition = 'NOT_REQUIRED_CONSTRAINT_COLLISION' and (
      new.outcome <> 'INFEASIBLE'
      or not ('CONSTRAINT_COLLISION' = any(new.reasons))
    ) then raise exception 'constraint_collision_outcome_required'; end if;
  end if;
  return new;
end;
$$;
create trigger ap_feasibility_completion_guard before insert or update on public.ap_feasibility_assessments for each row execute function public.ap_guard_feasibility_completion();

create table public.ap_job_snapshots (
  id uuid primary key default gen_random_uuid(),
  legacy_job_id uuid references public.jobs(id),
  origin public.ap_job_origin not null,
  discovery_source text not null,
  external_job_id text,
  canonical_application_url text not null check (canonical_application_url ~ '^https://'),
  application_host_type text not null check (application_host_type in ('EMPLOYER_HOSTED','APPROVED_THIRD_PARTY')),
  canonical_employer_listing_url text,
  source_url text not null check (source_url ~ '^https://'),
  company text not null,
  exact_title text not null,
  normalized_fingerprint text not null check (normalized_fingerprint ~ '^[0-9a-f]{64}$'),
  captured_listing jsonb not null check (jsonb_typeof(captured_listing) in ('object','string')),
  retrieved_at timestamptz not null,
  posted_on date,
  posted_date_unknown boolean not null,
  live_verified_at timestamptz not null,
  compensation_text text,
  compensation_source text,
  location_and_work_mode jsonb not null check (jsonb_typeof(location_and_work_mode) = 'object'),
  parser_version text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check ((posted_on is null) = posted_date_unknown)
);

create table public.ap_requirement_nodes (
  id uuid primary key default gen_random_uuid(),
  job_snapshot_id uuid not null references public.ap_job_snapshots(id) on delete cascade,
  parent_id uuid references public.ap_requirement_nodes(id),
  position integer not null check (position >= 0),
  node_kind public.ap_requirement_node_kind not null,
  criterion_type public.ap_criterion_type,
  stable_criterion_id uuid,
  semantic_key text,
  requirement_strength text check (requirement_strength is null or requirement_strength in ('REQUIRED','PREFERRED','INFORMATIONAL','UNCLEAR')),
  source_locator text,
  parser_certainty numeric(5,4) check (parser_certainty is null or parser_certainty between 0 and 1),
  criterion_version text,
  typed_value jsonb,
  created_at timestamptz not null default now(),
  check (
    (node_kind in ('ALL_OF','ANY_OF') and criterion_type is null and typed_value is null)
    or (node_kind = 'CRITERION' and criterion_type is not null and stable_criterion_id is not null and semantic_key is not null and requirement_strength is not null and source_locator is not null and parser_certainty is not null and criterion_version is not null and jsonb_typeof(typed_value) = 'object')
  ),
  unique(job_snapshot_id, parent_id, position)
);

create table public.ap_human_review_records (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  reviewer_id uuid not null references public.profiles(id),
  snapshot_id uuid not null references public.ap_intake_snapshots(id),
  review_kind text not null,
  compared_tasks jsonb check (compared_tasks is null or jsonb_typeof(compared_tasks) = 'array'),
  task_similarity text,
  complexity text,
  autonomy text,
  scope text,
  domain_context text,
  duration_and_intensity jsonb check (duration_and_intensity is null or jsonb_typeof(duration_and_intensity) = 'object'),
  essential_tools jsonb check (essential_tools is null or jsonb_typeof(essential_tools) = 'array'),
  rationale text not null,
  catalog_version text not null,
  decision jsonb not null check (jsonb_typeof(decision) = 'object'),
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.ap_match_evaluations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  snapshot_id uuid not null references public.ap_intake_snapshots(id),
  job_snapshot_id uuid not null references public.ap_job_snapshots(id),
  eligibility public.ap_eligibility_disposition not null,
  root_result public.ap_criterion_result not null,
  leaf_results jsonb not null check (jsonb_typeof(leaf_results) = 'array'),
  resolution_issues public.ap_resolution_issue[] not null,
  unknown_treatments public.ap_unknown_treatment[] not null,
  satisfaction_paths jsonb not null check (jsonb_typeof(satisfaction_paths) = 'array'),
  categorical_evidence_sufficient boolean not null,
  fit_score numeric(7,4) check (fit_score between 0 and 100),
  fit_components jsonb not null check (jsonb_typeof(fit_components) = 'array'),
  evidence_confidence numeric(7,4) check (evidence_confidence between 0 and 100),
  confidence_components jsonb not null check (jsonb_typeof(confidence_components) = 'object'),
  salary_status public.ap_salary_status not null,
  salary_disposition public.ap_salary_gate_disposition not null,
  soft_preferences jsonb not null check (jsonb_typeof(soft_preferences) = 'object'),
  application_readiness public.ap_application_readiness not null,
  presentation_risk public.ap_presentation_risk not null,
  presentation_risk_reasons jsonb not null check (jsonb_typeof(presentation_risk_reasons) = 'array'),
  warnings jsonb not null check (jsonb_typeof(warnings) = 'array'),
  candidate_fact_ids uuid[] not null,
  job_evidence jsonb not null check (jsonb_typeof(job_evidence) = 'array'),
  version_bundle jsonb not null check (jsonb_typeof(version_bundle) = 'object'),
  human_review_id uuid references public.ap_human_review_records(id),
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  unique(snapshot_id, job_snapshot_id, version_bundle)
);

create table public.ap_capacity_pools (
  id uuid primary key default gen_random_uuid(),
  resource public.ap_capacity_resource not null unique,
  enabled boolean not null default false,
  configuration_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ap_capacity_buckets (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.ap_capacity_pools(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  total_units integer not null check (total_units >= 0),
  staffing_version text not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  exclude using gist (pool_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
);

create table public.ap_capacity_allocations (
  id uuid primary key default gen_random_uuid(),
  bucket_id uuid not null references public.ap_capacity_buckets(id),
  customer_id uuid references public.profiles(id),
  draft_id uuid references public.ap_anonymous_drafts(id),
  units integer not null check (units > 0),
  lifecycle public.ap_capacity_lifecycle not null,
  debit_disposition public.ap_capacity_debit not null,
  order_id uuid references public.orders(id),
  material_line_id uuid,
  criteria_revision_id uuid,
  request_key text not null unique,
  staffing_version text not null,
  reserved_at timestamptz,
  consumed_at timestamptz,
  returned_at timestamptz,
  expires_at timestamptz,
  audit_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (customer_id is not null or draft_id is not null),
  check (
    (lifecycle = 'NONE' and debit_disposition = 'NONE')
    or (lifecycle = 'RESERVED' and debit_disposition = 'HELD' and reserved_at is not null and expires_at is not null)
    or (lifecycle in ('CONSUMED','COMPLETED') and debit_disposition = 'SPENT' and consumed_at is not null)
    or (lifecycle = 'SUPERSEDED' and ((debit_disposition = 'SPENT' and consumed_at is not null) or (debit_disposition = 'RETURNED' and consumed_at is null and returned_at is not null)))
    or (lifecycle in ('RELEASED','EXPIRED') and debit_disposition = 'RETURNED' and consumed_at is null and returned_at is not null)
  )
);
create index ap_capacity_allocations_debit_idx on public.ap_capacity_allocations(bucket_id, debit_disposition);

create table public.ap_capacity_allocation_members (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.ap_capacity_allocations(id) on delete cascade,
  material_line_id uuid,
  revision_id uuid,
  units integer not null default 1 check (units > 0),
  unique(allocation_id, material_line_id, revision_id)
);

create table public.ap_capacity_audit (
  id bigint generated always as identity primary key,
  allocation_id uuid not null references public.ap_capacity_allocations(id),
  from_lifecycle public.ap_capacity_lifecycle,
  to_lifecycle public.ap_capacity_lifecycle not null,
  from_debit public.ap_capacity_debit,
  to_debit public.ap_capacity_debit not null,
  actor_id uuid references public.profiles(id),
  reason_code text not null,
  occurred_at timestamptz not null default now()
);

create table public.ap_quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id),
  draft_id uuid references public.ap_anonymous_drafts(id),
  snapshot_id uuid not null references public.ap_intake_snapshots(id),
  feasibility_assessment_id uuid not null references public.ap_feasibility_assessments(id),
  price_cents integer not null check (price_cents = 2000),
  currency text not null check (currency = 'USD'),
  tax_inclusive boolean not null check (tax_inclusive),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id, content_sha256),
  check (customer_id is not null or draft_id is not null)
);

create table public.ap_external_commands (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id),
  draft_id uuid references public.ap_anonymous_drafts(id),
  command_kind text not null,
  provider text not null,
  immutable_input_sha256 text not null check (immutable_input_sha256 ~ '^[0-9a-f]{64}$'),
  provider_idempotency_key text not null unique,
  state public.ap_command_state not null default 'CREATING',
  provider_object_id text,
  reconciliation_state text not null default 'NOT_REQUIRED' check (reconciliation_state in ('NOT_REQUIRED','REQUIRED','IN_PROGRESS','RECONCILED','FAILED')),
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_object_id),
  check (customer_id is not null or draft_id is not null)
);

create table public.ap_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id),
  draft_id uuid references public.ap_anonymous_drafts(id),
  quote_id uuid references public.ap_quotes(id),
  command_id uuid not null unique references public.ap_external_commands(id),
  capacity_allocation_id uuid references public.ap_capacity_allocations(id),
  state public.ap_checkout_state not null default 'NONE',
  provider_checkout_session_id text unique,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (customer_id is not null or draft_id is not null),
  check (state <> 'OPEN' or (provider_checkout_session_id is not null and expires_at is not null and quote_id is not null and capacity_allocation_id is not null))
);

alter table public.ap_anonymous_drafts add column checkout_attempt_id uuid references public.ap_checkout_attempts(id);

create table public.ap_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id),
  draft_id uuid references public.ap_anonymous_drafts(id),
  checkout_attempt_id uuid references public.ap_checkout_attempts(id),
  legacy_payment_id uuid unique references public.payments(id),
  provider text not null,
  provider_payment_id text unique,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'USD'),
  settlement public.ap_payment_settlement not null default 'UNPAID',
  dispute public.ap_payment_dispute not null default 'NONE',
  payment_verified_at timestamptz,
  dispute_opened_at timestamptz,
  dispute_resolved_at timestamptz,
  funds_secured_at timestamptz,
  funds_reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (customer_id is not null or draft_id is not null),
  check ((settlement = 'PAID') = (payment_verified_at is not null)),
  check (dispute <> 'WON' or (dispute_resolved_at is not null and funds_secured_at is not null)),
  check (dispute <> 'LOST' or (dispute_resolved_at is not null and funds_reversed_at is not null)),
  check (dispute not in ('WON','LOST') or dispute_opened_at is not null)
);

create table public.ap_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null unique,
  event_type text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  signature_verified_at timestamptz not null,
  applied_at timestamptz,
  failure_code text,
  received_at timestamptz not null default now()
);

create table public.ap_search_services (
  id uuid primary key default gen_random_uuid(),
  legacy_order_id uuid not null unique references public.orders(id),
  customer_id uuid not null references public.profiles(id),
  quote_id uuid references public.ap_quotes(id),
  winning_payment_attempt_id uuid unique references public.ap_payment_attempts(id),
  original_snapshot_id uuid references public.ap_intake_snapshots(id),
  active_snapshot_id uuid references public.ap_intake_snapshots(id),
  capacity_allocation_id uuid references public.ap_capacity_allocations(id),
  fulfillment public.ap_search_fulfillment not null default 'QUEUED',
  adjustment public.ap_adjustment_state not null default 'NONE',
  intake_completed_at timestamptz,
  capacity_confirmed_at timestamptz,
  service_started_at timestamptz,
  delivery_due_at timestamptz,
  search_activated_at timestamptz,
  legacy_record boolean not null default false,
  version_bundle jsonb not null default '{}'::jsonb check (jsonb_typeof(version_bundle) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (legacy_record or search_activated_at is null or (quote_id is not null and winning_payment_attempt_id is not null and original_snapshot_id is not null and capacity_allocation_id is not null and service_started_at is not null and delivery_due_at = service_started_at + interval '24 hours'))
);
create unique index ap_one_activated_search_per_quote on public.ap_search_services(quote_id) where quote_id is not null and search_activated_at is not null;

create table public.ap_criteria_amendments (
  id uuid primary key default gen_random_uuid(),
  search_service_id uuid not null references public.ap_search_services(id),
  parent_snapshot_id uuid not null references public.ap_intake_snapshots(id),
  child_snapshot_id uuid references public.ap_intake_snapshots(id),
  state public.ap_adjustment_state not null default 'PROPOSED',
  criteria_diff jsonb not null check (jsonb_typeof(criteria_diff) = 'object'),
  proposal_expires_at timestamptz not null,
  accepted_at timestamptz,
  revised_capacity_allocation_id uuid references public.ap_capacity_allocations(id),
  revision_started_at timestamptz,
  revision_due_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check ((state = 'ACCEPTED') = (accepted_at is not null)),
  check (revision_started_at is null or revision_due_at = revision_started_at + interval '24 hours')
);

create table public.ap_material_purchases (
  id uuid primary key default gen_random_uuid(),
  legacy_cart_id uuid unique references public.apply_pack_carts(id),
  customer_id uuid not null references public.profiles(id),
  payment_attempt_id uuid references public.ap_payment_attempts(id),
  amount_cents integer not null check (amount_cents > 0 and amount_cents % 800 = 0),
  currency text not null check (currency = 'USD'),
  created_at timestamptz not null default now()
);

create table public.ap_material_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.ap_material_purchases(id),
  delivered_order_id uuid not null references public.orders(id),
  delivered_match_id uuid not null references public.job_matches(id),
  payment_attempt_id uuid not null references public.ap_payment_attempts(id),
  payment_allocation_key text not null unique,
  allocated_amount_cents integer not null check (allocated_amount_cents = 800),
  readiness public.ap_material_readiness not null default 'PENDING',
  fulfillment public.ap_material_fulfillment not null default 'NOT_PURCHASED',
  substitution public.ap_material_substitution not null default 'NONE',
  selected_reference_sheet boolean not null default false,
  active_revision integer not null default 1 check (active_revision > 0),
  selection_confirmed_at timestamptz,
  materials_payment_verified_at timestamptz,
  materials_capacity_confirmed_at timestamptz,
  materials_started_at timestamptz,
  materials_due_at timestamptz,
  earned_revenue_at timestamptz,
  created_at timestamptz not null default now(),
  check (materials_started_at is null or materials_due_at = materials_started_at + interval '24 hours')
);

create table public.ap_material_line_revisions (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.ap_material_lines(id),
  version integer not null check (version > 0),
  revision_kind text not null check (revision_kind in ('ORIGINAL','SUBSTITUTION','FACT_CORRECTION','REFERENCE_SCOPE')),
  parent_revision_id uuid references public.ap_material_line_revisions(id),
  job_snapshot_id uuid references public.ap_job_snapshots(id),
  fact_diff jsonb check (fact_diff is null or jsonb_typeof(fact_diff) = 'object'),
  reference_scope jsonb check (reference_scope is null or jsonb_typeof(reference_scope) = 'object'),
  capacity_allocation_id uuid references public.ap_capacity_allocations(id),
  accepted_at timestamptz,
  started_at timestamptz,
  due_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  check (started_at is null or due_at = started_at + interval '24 hours'),
  unique(line_id, version)
);

alter table public.ap_capacity_allocations add constraint ap_capacity_material_line_fk foreign key (material_line_id) references public.ap_material_lines(id);
alter table public.ap_capacity_allocation_members add constraint ap_capacity_member_line_fk foreign key (material_line_id) references public.ap_material_lines(id);
alter table public.ap_capacity_allocation_members add constraint ap_capacity_member_revision_fk foreign key (revision_id) references public.ap_material_line_revisions(id);

create table public.ap_material_entitlement_history (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.ap_material_lines(id),
  delivered_order_id uuid not null references public.orders(id),
  delivered_match_id uuid not null references public.job_matches(id),
  revision_id uuid references public.ap_material_line_revisions(id),
  state text not null check (state in ('OPEN','PAID','DELIVERED','REFUND_PENDING','DISPUTED','FULLY_REFUNDED','RELEASED')),
  supersedes_id uuid references public.ap_material_entitlement_history(id),
  created_at timestamptz not null default now()
);

create table public.ap_material_entitlement_claims (
  delivered_order_id uuid not null references public.orders(id),
  delivered_match_id uuid not null references public.job_matches(id),
  entitlement_history_id uuid not null unique references public.ap_material_entitlement_history(id),
  claimed_at timestamptz not null default now(),
  released_at timestamptz,
  primary key(delivered_order_id, delivered_match_id),
  check (released_at is null)
);

create table public.ap_refund_operations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  payment_attempt_id uuid not null references public.ap_payment_attempts(id),
  material_line_id uuid references public.ap_material_lines(id),
  scope public.ap_refund_scope not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'USD'),
  idempotency_key text not null unique,
  provider_command_id uuid unique references public.ap_external_commands(id),
  state public.ap_refund_state not null default 'PENDING',
  required boolean not null default true,
  superseded_at timestamptz,
  provider_refund_id text unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((scope = 'MATERIAL_LINE') = (material_line_id is not null)),
  check ((state = 'SUCCEEDED') = (completed_at is not null))
);

create unique index ap_one_active_refund_scope on public.ap_refund_operations(
  payment_attempt_id,
  scope,
  (coalesce(material_line_id, '00000000-0000-0000-0000-000000000000'::uuid))
) where superseded_at is null;

create or replace function public.ap_guard_refund_integrity()
returns trigger language plpgsql set search_path = '' as $$
declare payment public.ap_payment_attempts; line public.ap_material_lines; successful_total integer;
begin
  if tg_op = 'UPDATE' and (
    (to_jsonb(new) - array['state','completed_at','provider_refund_id','provider_command_id','superseded_at']) <>
    (to_jsonb(old) - array['state','completed_at','provider_refund_id','provider_command_id','superseded_at'])
    or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
  ) then raise exception 'immutable_refund_operation_identity'; end if;
  select * into payment from public.ap_payment_attempts where id = new.payment_attempt_id;
  if not found or payment.customer_id is distinct from new.customer_id or payment.currency <> new.currency then
    raise exception 'refund_payment_subject_mismatch';
  end if;
  if new.scope = 'MATERIAL_LINE' then
    select * into line from public.ap_material_lines where id = new.material_line_id and payment_attempt_id = new.payment_attempt_id;
    if not found or line.allocated_amount_cents <> new.amount_cents then raise exception 'material_line_refund_amount_mismatch'; end if;
  elsif new.amount_cents <> payment.amount_cents then
    raise exception 'full_attempt_refund_amount_mismatch';
  end if;
  if new.state = 'SUCCEEDED' and new.superseded_at is null then
    select coalesce(sum(amount_cents), 0)::integer into successful_total
    from public.ap_refund_operations
    where payment_attempt_id = new.payment_attempt_id and state = 'SUCCEEDED' and superseded_at is null and id <> new.id;
    if successful_total + new.amount_cents > payment.amount_cents then raise exception 'refund_total_exceeds_payment'; end if;
  end if;
  return new;
end;
$$;
create trigger ap_refund_integrity_guard before insert or update on public.ap_refund_operations for each row execute function public.ap_guard_refund_integrity();
create view public.ap_payment_refund_aggregates as
select p.id as payment_attempt_id,
  coalesce(sum(r.amount_cents) filter (where r.state = 'SUCCEEDED' and r.superseded_at is null), 0)::integer as refunded_amount_cents,
  case
    when coalesce(sum(r.amount_cents) filter (where r.state = 'SUCCEEDED' and r.superseded_at is null), 0) = p.amount_cents then 'FULL'
    when bool_or(r.state = 'PENDING' and r.superseded_at is null) then 'PENDING'
    when bool_or(r.state = 'FAILED' and r.required and r.superseded_at is null) then 'FAILED'
    when coalesce(sum(r.amount_cents) filter (where r.state = 'SUCCEEDED' and r.superseded_at is null), 0) > 0 then 'PARTIAL'
    else 'NONE'
  end as refund_aggregate,
  coalesce(sum(r.amount_cents) filter (where r.state = 'SUCCEEDED' and r.superseded_at is null), 0) = p.amount_cents as fully_refunded
from public.ap_payment_attempts p
left join public.ap_refund_operations r on r.payment_attempt_id = p.id
group by p.id, p.amount_cents;

create table public.ap_outbox_messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id),
  order_id uuid references public.orders(id),
  message_kind text not null,
  recipient_ref text not null,
  payload_ref uuid references public.ap_sensitive_payloads(id),
  deduplication_key text not null unique,
  provider_idempotency_key text not null unique,
  state public.ap_outbox_state not null default 'QUEUED',
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  provider_message_id text,
  reconciliation_state text not null default 'NOT_REQUIRED',
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ap_releases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  order_id uuid not null references public.orders(id),
  material_line_id uuid references public.ap_material_lines(id),
  release_kind text not null check (release_kind in ('SEARCH_EXACT_TEN','MATERIAL_PAIR','MATERIAL_TRIPLE','REFERENCE_REGENERATION')),
  committed_at timestamptz not null,
  active_due_at timestamptz not null,
  version_bundle jsonb not null check (jsonb_typeof(version_bundle) = 'object'),
  human_approved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (committed_at <= active_due_at)
);

create table public.ap_release_members (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.ap_releases(id),
  member_type text not null check (member_type in ('JOB_MATCH','GENERATED_ARTIFACT')),
  member_id uuid not null,
  position integer,
  created_at timestamptz not null default now(),
  unique(release_id, member_type, member_id),
  unique(release_id, member_type, position)
);

create table public.ap_generated_artifacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  order_id uuid not null references public.orders(id),
  material_line_id uuid references public.ap_material_lines(id),
  job_snapshot_id uuid references public.ap_job_snapshots(id),
  artifact_type public.ap_artifact_type not null,
  source_snapshot_id uuid not null references public.ap_intake_snapshots(id),
  source_line_revision_id uuid references public.ap_material_line_revisions(id),
  claim_provenance jsonb not null check (jsonb_typeof(claim_provenance) = 'object'),
  generator_version text not null,
  current_file_version integer not null default 0,
  retention_state public.ap_retention_state not null default 'ACTIVE',
  retention_due_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.ap_generated_file_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.ap_generated_artifacts(id),
  version integer not null check (version > 0),
  storage_bucket text not null,
  storage_path text not null unique,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  human_content_approved_by uuid references public.profiles(id),
  human_content_approved_at timestamptz,
  human_visual_approved_by uuid references public.profiles(id),
  human_visual_approved_at timestamptz,
  superseded_at timestamptz,
  downloads_revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(artifact_id, version)
);

create table public.ap_reference_records (
  id uuid primary key default gen_random_uuid(),
  opaque_client_id uuid not null unique default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  current_version integer not null default 1,
  removed_at timestamptz,
  retention_state public.ap_retention_state not null default 'ACTIVE',
  retention_due_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.ap_reference_record_versions (
  id uuid primary key default gen_random_uuid(),
  reference_record_id uuid not null references public.ap_reference_records(id),
  version integer not null check (version > 0),
  encrypted_payload_id uuid not null references public.ap_sensitive_payloads(id),
  payload_schema_version text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  permission_status public.ap_reference_permission not null default 'UNCONFIRMED',
  permission_last_confirmed_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique(reference_record_id, version)
);

create table public.ap_reference_permissions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  reference_record_version_id uuid not null references public.ap_reference_record_versions(id),
  delivered_release_id uuid not null references public.ap_releases(id),
  job_snapshot_id uuid not null references public.ap_job_snapshots(id),
  job_snapshot_hash text not null check (job_snapshot_hash ~ '^[0-9a-f]{64}$'),
  employer_snapshot text not null,
  exact_position_snapshot text not null,
  permission_text_version text not null,
  attested_at timestamptz not null,
  revoked_at timestamptz,
  contact_version_changed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(reference_record_version_id, delivered_release_id, job_snapshot_id, permission_text_version),
  check (contact_version_changed_at is null or revoked_at is not null)
);

alter table public.ap_generated_artifacts add column reference_permission_id uuid references public.ap_reference_permissions(id);
alter table public.ap_generated_artifacts add constraint ap_reference_sheet_permission_required check ((artifact_type = 'REFERENCE_SHEET') = (reference_permission_id is not null));

create table public.ap_reference_staff_access (
  id bigint generated always as identity primary key,
  reference_record_id uuid not null references public.ap_reference_records(id),
  staff_id uuid not null references public.profiles(id),
  purpose text not null,
  accessed_at timestamptz not null default now()
);

create table public.ap_scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  job_kind text not null,
  reference_id uuid not null,
  idempotency_key text not null unique,
  state public.ap_scheduled_job_state not null default 'QUEUED',
  run_at timestamptz not null,
  lease_owner text,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'LEASED') = (lease_owner is not null and lease_expires_at is not null))
);

create table public.ap_audit_events (
  id bigint generated always as identity primary key,
  customer_id uuid references public.profiles(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  non_sensitive_details jsonb not null default '{}'::jsonb,
  audit_version text not null,
  occurred_at timestamptz not null default now()
);

create table public.ap_migration_checkpoints (
  migration_id text not null,
  checkpoint text not null,
  rows_processed bigint not null default 0,
  content_sha256 text,
  completed_at timestamptz,
  primary key(migration_id, checkpoint)
);

create table public.ap_feature_flags (
  flag text primary key,
  enabled boolean not null default false,
  approval_reference text,
  updated_at timestamptz not null default now(),
  check (not enabled or approval_reference is not null)
);
insert into public.ap_feature_flags(flag, enabled) values ('CUSTOMER_SUPPLIED_INGESTION', false);
create table public.ap_commerce_configuration (
  singleton boolean primary key default true check (singleton),
  currency text not null default 'USD' check (currency = 'USD'),
  search_price_cents integer not null default 2000 check (search_price_cents = 2000),
  material_line_price_cents integer not null default 800 check (material_line_price_cents = 800),
  tax_inclusive boolean not null default true check (tax_inclusive),
  tax_configuration_approved boolean not null default false,
  tax_approval_reference text,
  checkout_enabled boolean generated always as (tax_configuration_approved and tax_approval_reference is not null) stored,
  updated_at timestamptz not null default now(),
  check (not tax_configuration_approved or tax_approval_reference is not null)
);
insert into public.ap_commerce_configuration(singleton) values (true);

create table public.ap_retention_configuration (
  singleton boolean primary key default true check (singleton),
  unpaid_draft_seconds integer check (unpaid_draft_seconds > 0),
  unpaid_file_seconds integer check (unpaid_file_seconds > 0),
  privacy_policy_approval_reference text,
  approved boolean not null default false,
  cleanup_enabled boolean generated always as (
    approved and unpaid_draft_seconds is not null and unpaid_file_seconds is not null and privacy_policy_approval_reference is not null
  ) stored,
  updated_at timestamptz not null default now(),
  check (not approved or (unpaid_draft_seconds is not null and unpaid_file_seconds is not null and privacy_policy_approval_reference is not null))
);
insert into public.ap_retention_configuration(singleton) values (true);

create or replace function public.ap_guard_checkout_configuration()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.state = 'OPEN' and (tg_op = 'INSERT' or old.state is distinct from new.state) then
    if not coalesce((select checkout_enabled from public.ap_commerce_configuration where singleton), false) then
      raise exception 'checkout_disabled_tax_configuration_unapproved';
    end if;
    if not exists (
      select 1 from public.ap_quotes q join public.ap_feasibility_assessments f on f.id = q.feasibility_assessment_id join public.ap_capacity_allocations a on a.id = new.capacity_allocation_id
      where q.id = new.quote_id and q.invalidated_at is null and q.expires_at > now()
        and f.snapshot_id = q.snapshot_id and f.invalidated_at is null and f.state = 'COMPLETE' and f.outcome = 'LIKELY' and f.resolution_blocker = 'NONE'
        and q.customer_id is not distinct from new.customer_id and q.draft_id is not distinct from new.draft_id
        and a.customer_id is not distinct from new.customer_id and a.draft_id is not distinct from new.draft_id
        and a.lifecycle = 'RESERVED' and a.debit_disposition = 'HELD' and a.expires_at > now()
        and new.expires_at <= q.expires_at and new.expires_at <= a.expires_at
    ) then raise exception 'checkout_subject_quote_or_capacity_invalid'; end if;
  end if;
  return new;
end;
$$;
create trigger ap_checkout_configuration_guard before insert or update on public.ap_checkout_attempts for each row execute function public.ap_guard_checkout_configuration();

create or replace function public.ap_guard_state_transition()
returns trigger language plpgsql set search_path = '' as $$
declare old_row jsonb := to_jsonb(old); new_row jsonb := to_jsonb(new); old_state text := old_row ->> 'state'; new_state text := new_row ->> 'state'; old_lifecycle text := old_row ->> 'lifecycle'; new_lifecycle text := new_row ->> 'lifecycle'; old_debit text := old_row ->> 'debit_disposition'; new_debit text := new_row ->> 'debit_disposition';
begin
  if tg_table_name = 'ap_anonymous_drafts' and old_state is distinct from new_state and not (
    (old_state = 'IN_PROGRESS' and new_state in ('COMPLETE','LOCKED_TO_CHECKOUT','EXPIRED')) or
    (old_state = 'COMPLETE' and new_state in ('IN_PROGRESS','LOCKED_TO_CHECKOUT','EXPIRED')) or
    (old_state = 'LOCKED_TO_CHECKOUT' and new_state in ('COMPLETE','CONVERTED','EXPIRED'))
  ) then raise exception 'invalid_draft_transition'; end if;
  old_state := old_row ->> 'processing_state'; new_state := new_row ->> 'processing_state';
  if tg_table_name = 'ap_document_versions' and old_state is distinct from new_state and not (
    (old_state = 'UPLOADED' and new_state in ('QUARANTINED','FAILED','SUPERSEDED')) or
    (old_state = 'QUARANTINED' and new_state in ('SCANNING','FAILED','SUPERSEDED')) or
    (old_state = 'SCANNING' and new_state in ('EXTRACTING','FAILED','SUPERSEDED')) or
    (old_state = 'EXTRACTING' and new_state in ('READY','FAILED','SUPERSEDED')) or
    (old_state = 'FAILED' and new_state in ('QUARANTINED','SUPERSEDED')) or
    (old_state = 'READY' and new_state = 'SUPERSEDED')
  ) then raise exception 'invalid_document_transition'; end if;
  old_state := old_row ->> 'state'; new_state := new_row ->> 'state';
  if tg_table_name = 'ap_checkout_attempts' and old_state is distinct from new_state and not (
    (old_state = 'NONE' and new_state = 'OPEN') or
    (old_state = 'OPEN' and new_state in ('CANCELED','EXPIRED','COMPLETED','FAILED'))
  ) then raise exception 'invalid_checkout_transition'; end if;
  if tg_table_name = 'ap_payment_attempts' then
    if old_row ->> 'settlement' is distinct from new_row ->> 'settlement' and not (
      (old_row ->> 'settlement' = 'UNPAID' and new_row ->> 'settlement' in ('PROCESSING','PAID','FAILED')) or
      (old_row ->> 'settlement' = 'PROCESSING' and new_row ->> 'settlement' in ('PAID','FAILED'))
    ) then raise exception 'invalid_payment_settlement_transition'; end if;
    if old_row ->> 'dispute' is distinct from new_row ->> 'dispute' and not (
      (old_row ->> 'dispute' = 'NONE' and new_row ->> 'dispute' = 'OPEN') or
      (old_row ->> 'dispute' = 'OPEN' and new_row ->> 'dispute' in ('WON','LOST'))
    ) then raise exception 'invalid_payment_dispute_transition'; end if;
  end if;
  if tg_table_name = 'ap_refund_operations' and old_state is distinct from new_state and not (
    old_state = 'PENDING' and new_state in ('SUCCEEDED','FAILED')
  ) then raise exception 'invalid_refund_transition'; end if;
  if tg_table_name = 'ap_capacity_allocations' and (old_lifecycle is distinct from new_lifecycle or old_debit is distinct from new_debit) then
    if old_debit = 'SPENT' and new_debit <> 'SPENT' then raise exception 'spent_capacity_cannot_return'; end if;
    if not (
      (old_lifecycle = 'NONE' and old_debit = 'NONE' and new_lifecycle = 'RESERVED' and new_debit = 'HELD') or
      (old_lifecycle = 'RESERVED' and old_debit = 'HELD' and ((new_lifecycle = 'CONSUMED' and new_debit = 'SPENT') or (new_lifecycle in ('RELEASED','EXPIRED','SUPERSEDED') and new_debit = 'RETURNED'))) or
      (old_lifecycle = 'CONSUMED' and old_debit = 'SPENT' and new_lifecycle in ('COMPLETED','SUPERSEDED') and new_debit = 'SPENT') or
      (old_lifecycle = 'COMPLETED' and old_debit = 'SPENT' and new_lifecycle = 'SUPERSEDED' and new_debit = 'SPENT')
    ) then raise exception 'invalid_capacity_transition'; end if;
  end if;
  return new;
end;
$$;create trigger ap_draft_state_guard before update on public.ap_anonymous_drafts for each row execute function public.ap_guard_state_transition();
create trigger ap_document_state_guard before update on public.ap_document_versions for each row execute function public.ap_guard_state_transition();
create trigger ap_checkout_state_guard before update on public.ap_checkout_attempts for each row execute function public.ap_guard_state_transition();
create trigger ap_payment_state_guard before update on public.ap_payment_attempts for each row execute function public.ap_guard_state_transition();
create trigger ap_refund_state_guard before update on public.ap_refund_operations for each row execute function public.ap_guard_state_transition();
create trigger ap_capacity_state_guard before update on public.ap_capacity_allocations for each row execute function public.ap_guard_state_transition();
create or replace function public.ap_block_customer_supplied_without_approval()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.origin = 'CUSTOMER_SUPPLIED' and not coalesce((select enabled from public.ap_feature_flags where flag = 'CUSTOMER_SUPPLIED_INGESTION'), false) then
    raise exception 'customer_supplied_ingestion_disabled';
  end if;
  return new;
end;
$$;
create trigger ap_job_snapshot_customer_supplied_guard before insert or update on public.ap_job_snapshots for each row execute function public.ap_block_customer_supplied_without_approval();

create or replace function public.ap_prevent_immutable_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable_record';
end;
$$;

create or replace function public.ap_guard_invalidatable_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE'
    or (to_jsonb(new) - 'invalidated_at') <> (to_jsonb(old) - 'invalidated_at')
    or old.invalidated_at is not null
    or new.invalidated_at is null
  then raise exception 'immutable_record'; end if;
  return new;
end;
$$;

create or replace function public.ap_guard_supersedable_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE'
    or (to_jsonb(new) - 'superseded_at') <> (to_jsonb(old) - 'superseded_at')
    or old.superseded_at is not null
    or new.superseded_at is null
  then raise exception 'immutable_record'; end if;
  return new;
end;
$$;
create or replace function public.ap_guard_candidate_fact_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-array['verification','confirmed_or_corrected_at','superseded_at']) <> (to_jsonb(old)-array['verification','confirmed_or_corrected_at','superseded_at'])
    or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
    or (old.verification='EXTRACTED_UNCONFIRMED' and new.verification not in ('EXTRACTED_UNCONFIRMED','CUSTOMER_CONFIRMED','CUSTOMER_REJECTED','DISPUTED'))
    or (old.verification='CUSTOMER_CONFIRMED' and new.verification not in ('CUSTOMER_CONFIRMED','DISPUTED'))
    or (old.verification in ('HUMAN_VERIFIED','CUSTOMER_REJECTED','DISPUTED') and new.verification<>old.verification)
  then raise exception 'invalid_candidate_fact_mutation'; end if;
  return new;
end;
$$;
create trigger ap_candidate_fact_guard before update or delete on public.ap_candidate_facts for each row execute function public.ap_guard_candidate_fact_update();
create or replace function public.ap_guard_reference_record_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-array['current_version','removed_at','retention_state','retention_due_at']) <> (to_jsonb(old)-array['current_version','removed_at','retention_state','retention_due_at'])
    or new.current_version < old.current_version or (old.removed_at is not null and new.removed_at is distinct from old.removed_at) then raise exception 'immutable_reference_identity'; end if;
  return new;
end;
$$;
create trigger ap_reference_record_identity_guard before update or delete on public.ap_reference_records for each row execute function public.ap_guard_reference_record_update();

create or replace function public.ap_guard_reference_version_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-array['permission_status','permission_last_confirmed_at','superseded_at']) <> (to_jsonb(old)-array['permission_status','permission_last_confirmed_at','superseded_at'])
    or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
    or (old.permission_status='CONFIRMED' and new.permission_status='UNCONFIRMED')
    or (old.permission_status='REVOKED' and new.permission_status<>'REVOKED') then raise exception 'immutable_reference_version'; end if;
  return new;
end;
$$;
create trigger ap_reference_version_guard before update or delete on public.ap_reference_record_versions for each row execute function public.ap_guard_reference_version_update();

create or replace function public.ap_guard_reference_permission_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-array['revoked_at','contact_version_changed_at']) <> (to_jsonb(old)-array['revoked_at','contact_version_changed_at'])
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then raise exception 'immutable_reference_permission_scope'; end if;
  return new;
end;
$$;
create trigger ap_reference_permission_scope_guard before update or delete on public.ap_reference_permissions for each row execute function public.ap_guard_reference_permission_update();
create trigger ap_catalog_versions_immutable before update or delete on public.ap_catalog_versions for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_inventory_versions_immutable before update or delete on public.ap_inventory_versions for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_feasibility_coverage_plans_immutable before update or delete on public.ap_feasibility_coverage_plans for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_capacity_buckets_immutable before update or delete on public.ap_capacity_buckets for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_capacity_allocation_members_immutable before update or delete on public.ap_capacity_allocation_members for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_releases_immutable before update or delete on public.ap_releases for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_release_members_immutable before update or delete on public.ap_release_members for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_human_review_records_immutable before update or delete on public.ap_human_review_records for each row execute function public.ap_guard_invalidatable_immutable();
create trigger ap_match_evaluations_immutable before update or delete on public.ap_match_evaluations for each row execute function public.ap_guard_invalidatable_immutable();
create trigger ap_material_line_revisions_immutable before update or delete on public.ap_material_line_revisions for each row execute function public.ap_guard_supersedable_immutable();create trigger ap_independent_verification_sources_immutable before update or delete on public.ap_independent_verification_sources for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_sensitive_payloads_immutable before update or delete on public.ap_sensitive_payloads for each row execute function public.ap_prevent_immutable_mutation();
create or replace function public.ap_guard_quote_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'invalidated_at') <> (to_jsonb(old) - 'invalidated_at') or old.invalidated_at is not null or new.invalidated_at is null then
    raise exception 'immutable_quote';
  end if;
  return new;
end;
$$;
create trigger ap_quotes_immutable before update or delete on public.ap_quotes for each row execute function public.ap_guard_quote_immutable();
create trigger ap_entitlement_history_immutable before update or delete on public.ap_material_entitlement_history for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_intake_snapshots_immutable before update or delete on public.ap_intake_snapshots for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_job_snapshots_immutable before update or delete on public.ap_job_snapshots for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_provider_events_immutable before update or delete on public.ap_provider_events for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_capacity_audit_immutable before update or delete on public.ap_capacity_audit for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_audit_events_immutable before update or delete on public.ap_audit_events for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_reference_staff_access_immutable before update or delete on public.ap_reference_staff_access for each row execute function public.ap_prevent_immutable_mutation();

create or replace function public.ap_lock_anonymous_draft_to_checkout(p_draft_id uuid, p_secret_hash text, p_checkout_attempt_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.ap_checkout_attempts where id = p_checkout_attempt_id and draft_id = p_draft_id and state = 'OPEN') then raise exception 'anonymous_checkout_unavailable'; end if;
  update public.ap_anonymous_drafts set state = 'LOCKED_TO_CHECKOUT', checkout_attempt_id = p_checkout_attempt_id, version = version + 1, updated_at = now()
    where id = p_draft_id and capability_secret_hash = p_secret_hash and state = 'COMPLETE' and expires_at > now();
  if not found then raise exception 'draft_capability_invalid'; end if;
  return true;
end;
$$;

create or replace function public.ap_return_anonymous_draft_after_checkout(p_draft_id uuid, p_secret_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ap_anonymous_drafts d set state = 'COMPLETE', version = d.version + 1, updated_at = now()
    where d.id = p_draft_id and d.capability_secret_hash = p_secret_hash and d.state = 'LOCKED_TO_CHECKOUT' and d.expires_at > now()
      and exists (select 1 from public.ap_checkout_attempts c where c.id = d.checkout_attempt_id and c.state in ('CANCELED','EXPIRED','FAILED'));
  if not found then raise exception 'draft_capability_invalid'; end if;
  return true;
end;
$$;

create or replace function public.ap_create_anonymous_draft(p_draft_id uuid, p_secret_hash text, p_expires_at timestamptz)
returns table(id uuid, version bigint, state public.ap_draft_state, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if p_draft_id is null or p_secret_hash !~ '^[0-9a-f]{64}$' or p_expires_at <= now() then raise exception 'invalid_draft_configuration'; end if;
  return query insert into public.ap_anonymous_drafts(id, capability_secret_hash, expires_at)
    values (p_draft_id, p_secret_hash, p_expires_at)
    returning ap_anonymous_drafts.id, ap_anonymous_drafts.version, ap_anonymous_drafts.state, ap_anonymous_drafts.expires_at;
end;
$$;

create or replace function public.ap_read_anonymous_draft(p_draft_id uuid, p_secret_hash text)
returns table(id uuid, version bigint, state public.ap_draft_state, current_step integer, answers jsonb, expires_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select d.id, d.version, d.state, d.current_step, d.answers, d.expires_at
  from public.ap_anonymous_drafts d
  where d.id = p_draft_id and d.capability_secret_hash = p_secret_hash and d.expires_at > now() and d.state not in ('CONVERTED','EXPIRED');
$$;

create or replace function public.ap_save_anonymous_draft(p_draft_id uuid, p_secret_hash text, p_expected_version bigint, p_current_step integer, p_answers jsonb)
returns table(id uuid, version bigint, state public.ap_draft_state, current_step integer, answers jsonb, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare d public.ap_anonymous_drafts;
begin
  if jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 65536 or p_current_step not between 0 and 6 then raise exception 'invalid_draft_payload'; end if;
  select * into d from public.ap_anonymous_drafts
    where ap_anonymous_drafts.id = p_draft_id and ap_anonymous_drafts.capability_secret_hash = p_secret_hash and ap_anonymous_drafts.expires_at > now()
    for update;
  if not found or d.state not in ('IN_PROGRESS','COMPLETE') then raise exception 'draft_capability_invalid'; end if;
  if d.version <> p_expected_version then raise exception using message = 'draft_version_conflict', detail = d.version::text, errcode = '40001'; end if;
  return query update public.ap_anonymous_drafts
    set current_step = p_current_step, answers = p_answers, version = ap_anonymous_drafts.version + 1, updated_at = now()
    where ap_anonymous_drafts.id = p_draft_id
    returning ap_anonymous_drafts.id, ap_anonymous_drafts.version, ap_anonymous_drafts.state, ap_anonymous_drafts.current_step, ap_anonymous_drafts.answers, ap_anonymous_drafts.expires_at;
end;
$$;

create or replace function public.ap_rotate_anonymous_draft_capability(p_draft_id uuid, p_secret_hash text, p_new_secret_hash text, p_customer_id uuid, p_intake_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ap_anonymous_drafts set
    capability_secret_hash = p_new_secret_hash,
    capability_version = capability_version + 1,
    capability_rotated_at = now(),
    converted_customer_id = p_customer_id,
    converted_intake_id = p_intake_id,
    state = 'CONVERTED',
    updated_at = now()
  where id = p_draft_id and capability_secret_hash = p_secret_hash and state = 'LOCKED_TO_CHECKOUT';
  return found;
end;
$$;

create or replace function public.ap_register_anonymous_document(
  p_draft_id uuid, p_secret_hash text, p_expected_draft_version bigint, p_document_id uuid,
  p_kind public.ap_document_kind, p_name text, p_path text, p_size integer,
  p_claimed_mime text, p_verified_mime text, p_sha256 text
)
returns table(document_id uuid, document_version integer, draft_version bigint)
language plpgsql security definer set search_path = '' as $$
declare d public.ap_anonymous_drafts; next_version integer; prior_id uuid;
begin
  select * into d from public.ap_anonymous_drafts where id = p_draft_id and capability_secret_hash = p_secret_hash and expires_at > now() for update;
  if not found or d.state not in ('IN_PROGRESS','COMPLETE') then raise exception 'draft_capability_invalid'; end if;
  if d.version <> p_expected_draft_version then raise exception using message = 'draft_version_conflict', detail = d.version::text, errcode = '40001'; end if;
  if p_path not like 'anonymous/' || p_draft_id::text || '/%' then raise exception 'invalid_storage_path'; end if;
  select id, version into prior_id, next_version from public.ap_document_versions where draft_id = p_draft_id and kind = p_kind and is_current for update;
  next_version := coalesce(next_version, 0) + 1;
  if prior_id is not null then update public.ap_document_versions set is_current = false, processing_state = 'SUPERSEDED', updated_at = now() where id = prior_id; end if;
  insert into public.ap_document_versions(id, draft_id, kind, version, processing_state, supersedes_id, safe_display_name, storage_bucket, storage_path, size_bytes, claimed_mime_type, verified_mime_type, sha256)
    values (p_document_id, p_draft_id, p_kind, next_version, 'QUARANTINED', prior_id, p_name, 'customer-source-documents', p_path, p_size, p_claimed_mime, p_verified_mime, p_sha256);
  update public.ap_anonymous_drafts set version = version + 1, updated_at = now() where id = p_draft_id returning version into d.version;
  return query select p_document_id, next_version, d.version;
end;
$$;

create or replace function public.ap_apply_document_pipeline_result(
  p_document_id uuid, p_expected_version integer, p_state public.ap_document_processing_state,
  p_malware_status text, p_parse_status text, p_reference_status text, p_leak_status text,
  p_parser_identity text, p_parser_limits jsonb, p_model_policy text, p_failure_code text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ap_document_versions set
    processing_state = p_state,
    malware_status = p_malware_status,
    parse_status = p_parse_status,
    reference_isolation_status = p_reference_status,
    leak_scan_status = p_leak_status,
    parser_identity = p_parser_identity,
    parser_limits = p_parser_limits,
    permitted_model_policy = p_model_policy,
    failure_code = p_failure_code,
    model_ready_at = case when p_state = 'READY' then now() else null end,
    updated_at = now()
  where id = p_document_id and version = p_expected_version and is_current and processing_state <> 'SUPERSEDED';
  return found;
end;
$$;

create or replace function public.ap_remove_anonymous_document(
  p_draft_id uuid, p_secret_hash text, p_expected_draft_version bigint,
  p_kind public.ap_document_kind
)
returns table(document_id uuid, storage_bucket text, storage_path text, draft_version bigint)
language plpgsql security definer set search_path = '' as $$
declare d public.ap_anonymous_drafts; current_document public.ap_document_versions;
begin
  select * into d from public.ap_anonymous_drafts
    where id = p_draft_id and capability_secret_hash = p_secret_hash and expires_at > now()
    for update;
  if not found or d.state not in ('IN_PROGRESS','COMPLETE') then raise exception 'draft_capability_invalid'; end if;
  if d.version <> p_expected_draft_version then
    raise exception using message = 'draft_version_conflict', detail = d.version::text, errcode = '40001';
  end if;
  select * into current_document from public.ap_document_versions
    where draft_id = p_draft_id and kind = p_kind and is_current for update;
  if not found then raise exception 'document_not_found'; end if;
  update public.ap_document_versions
    set is_current = false, processing_state = 'SUPERSEDED', updated_at = now()
    where id = current_document.id;
  update public.ap_anonymous_drafts set version = version + 1, updated_at = now()
    where id = p_draft_id returning version into d.version;
  return query select current_document.id, current_document.storage_bucket,
    current_document.storage_path, d.version;
end;
$$;
create or replace function public.ap_capacity_available(p_bucket_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(0, b.total_units - coalesce(sum(a.units) filter (where a.debit_disposition in ('HELD','SPENT')), 0))::integer
  from public.ap_capacity_buckets b left join public.ap_capacity_allocations a on a.bucket_id = b.id
  where b.id = p_bucket_id group by b.id, b.total_units;
$$;

create or replace function public.ap_reserve_capacity(
  p_customer_id uuid, p_resource public.ap_capacity_resource, p_units integer, p_request_key text,
  p_expires_at timestamptz, p_members jsonb default '[]'::jsonb, p_draft_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pool_row public.ap_capacity_pools; bucket_row public.ap_capacity_buckets; new_allocation_id uuid; member jsonb;
begin
  if p_units < 1 or p_expires_at <= now() or abs(extract(epoch from (p_expires_at - now())) - 1800) > 5 or jsonb_typeof(p_members) <> 'array' or (p_customer_id is null and p_draft_id is null) then raise exception 'invalid_capacity_request'; end if;
  select * into pool_row from public.ap_capacity_pools where resource = p_resource and enabled for update;
  if not found then raise exception 'capacity_unconfigured'; end if;
  select b.* into bucket_row from public.ap_capacity_buckets b
    where b.pool_id = pool_row.id and b.starts_at <= now() and b.ends_at >= p_expires_at
      and public.ap_capacity_available(b.id) >= p_units
    order by b.ends_at, b.id for update skip locked limit 1;
  if not found then raise exception 'capacity_unavailable'; end if;
  insert into public.ap_capacity_allocations(bucket_id, customer_id, draft_id, units, lifecycle, debit_disposition, request_key, staffing_version, reserved_at, expires_at, audit_version)
    values (bucket_row.id, p_customer_id, p_draft_id, p_units, 'RESERVED', 'HELD', p_request_key, bucket_row.staffing_version, now(), p_expires_at, 'v1')
    returning id into new_allocation_id;
  for member in select value from jsonb_array_elements(p_members) loop
    insert into public.ap_capacity_allocation_members(allocation_id, material_line_id, revision_id, units)
      values (new_allocation_id, nullif(member ->> 'materialLineId','')::uuid, nullif(member ->> 'revisionId','')::uuid, coalesce((member ->> 'units')::integer, 1));
  end loop;
  if (select coalesce(sum(units), 0) from public.ap_capacity_allocation_members where allocation_id = new_allocation_id) not in (0, p_units) then raise exception 'capacity_member_units_mismatch'; end if;
  if p_resource = 'MATERIALS' and (
    jsonb_array_length(p_members) = 0
    or exists (
      select 1
      from public.ap_capacity_allocation_members
      where allocation_id = new_allocation_id and material_line_id is null
    )
    or (select coalesce(sum(units), 0) from public.ap_capacity_allocation_members where allocation_id = new_allocation_id) <> p_units
  ) then raise exception 'materials_capacity_requires_complete_line_members'; end if;
  insert into public.ap_capacity_audit(allocation_id, to_lifecycle, to_debit, reason_code) values (new_allocation_id, 'RESERVED', 'HELD', 'RESERVED');
  return new_allocation_id;
end;
$$;

create or replace function public.ap_release_unconsumed_capacity(p_allocation_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare prior public.ap_capacity_allocations;
begin
  select * into prior from public.ap_capacity_allocations where id = p_allocation_id for update;
  if not found then return false; end if;
  if prior.debit_disposition = 'SPENT' or prior.consumed_at is not null then raise exception 'spent_capacity_cannot_return'; end if;
  if prior.lifecycle not in ('RESERVED') then return false; end if;
  update public.ap_capacity_allocations set lifecycle = 'RELEASED', debit_disposition = 'RETURNED', returned_at = now(), updated_at = now() where id = p_allocation_id;
  insert into public.ap_capacity_audit(allocation_id, from_lifecycle, to_lifecycle, from_debit, to_debit, reason_code)
    values (p_allocation_id, prior.lifecycle, 'RELEASED', prior.debit_disposition, 'RETURNED', p_reason);
  return true;
end;
$$;

create or replace function public.ap_invalidate_pre_activation_snapshot(
  p_customer_id uuid, p_prior_snapshot_id uuid, p_new_snapshot_id uuid, p_reason text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare allocation public.ap_capacity_allocations;
begin
  if not exists (
    select 1 from public.ap_intake_snapshots prior join public.ap_intake_snapshots child on child.id = p_new_snapshot_id
    where prior.id = p_prior_snapshot_id and prior.customer_id = p_customer_id
      and child.customer_id = p_customer_id and child.parent_snapshot_id = prior.id
      and child.snapshot_kind = 'PRE_ACTIVATION_EDIT'
  ) then raise exception 'invalid_snapshot_revision'; end if;
  if exists (select 1 from public.ap_search_services where customer_id = p_customer_id and search_activated_at is not null and (original_snapshot_id = p_prior_snapshot_id or active_snapshot_id = p_prior_snapshot_id)) then
    raise exception 'post_activation_requires_criteria_amendment';
  end if;
  update public.ap_feasibility_assessments set invalidated_at = now() where snapshot_id = p_prior_snapshot_id and invalidated_at is null;
  update public.ap_quotes set invalidated_at = now() where snapshot_id = p_prior_snapshot_id and invalidated_at is null;
  update public.ap_match_evaluations set invalidated_at = now() where snapshot_id = p_prior_snapshot_id and invalidated_at is null;
  update public.ap_human_review_records set invalidated_at = now() where snapshot_id = p_prior_snapshot_id and invalidated_at is null;
  for allocation in select * from public.ap_capacity_allocations where customer_id = p_customer_id and criteria_revision_id = p_prior_snapshot_id and lifecycle = 'RESERVED' for update loop
    update public.ap_capacity_allocations set lifecycle = 'SUPERSEDED', debit_disposition = 'RETURNED', returned_at = now(), updated_at = now() where id = allocation.id;
    insert into public.ap_capacity_audit(allocation_id, from_lifecycle, to_lifecycle, from_debit, to_debit, reason_code)
      values (allocation.id, allocation.lifecycle, 'SUPERSEDED', allocation.debit_disposition, 'RETURNED', p_reason);
  end loop;
  update public.ap_search_services set active_snapshot_id = p_new_snapshot_id, updated_at = now()
    where customer_id = p_customer_id and search_activated_at is null and active_snapshot_id = p_prior_snapshot_id;
  return true;
end;
$$;

create or replace function public.ap_accept_criteria_amendment(
  p_amendment_id uuid, p_child_snapshot_id uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare amendment public.ap_criteria_amendments; service public.ap_search_services; allocation public.ap_capacity_allocations;
begin
  select * into amendment from public.ap_criteria_amendments where id = p_amendment_id for update;
  if not found or amendment.state <> 'PROPOSED' or amendment.proposal_expires_at <= now() then raise exception 'amendment_not_acceptable'; end if;
  select * into service from public.ap_search_services where id = amendment.search_service_id and search_activated_at is not null for update;
  if not found then raise exception 'search_not_active'; end if;
  if not exists (select 1 from public.ap_intake_snapshots where id = p_child_snapshot_id and parent_snapshot_id = amendment.parent_snapshot_id and customer_id = service.customer_id and snapshot_kind = 'SEARCH_ADJUSTMENT') then
    raise exception 'invalid_adjustment_snapshot';
  end if;
  update public.ap_feasibility_assessments set invalidated_at = now() where snapshot_id = amendment.parent_snapshot_id and invalidated_at is null;
  update public.ap_match_evaluations set invalidated_at = now() where snapshot_id = amendment.parent_snapshot_id and invalidated_at is null;
  update public.ap_human_review_records set invalidated_at = now() where snapshot_id = amendment.parent_snapshot_id and invalidated_at is null;
  for allocation in select * from public.ap_capacity_allocations where customer_id = service.customer_id and criteria_revision_id = amendment.parent_snapshot_id and lifecycle in ('RESERVED','CONSUMED','COMPLETED') for update loop
    update public.ap_capacity_allocations set lifecycle = 'SUPERSEDED', debit_disposition = case when allocation.debit_disposition = 'SPENT' then 'SPENT'::public.ap_capacity_debit else 'RETURNED'::public.ap_capacity_debit end,
      returned_at = case when allocation.debit_disposition = 'SPENT' then returned_at else now() end, updated_at = now() where id = allocation.id;
    insert into public.ap_capacity_audit(allocation_id, from_lifecycle, to_lifecycle, from_debit, to_debit, reason_code)
      values (allocation.id, allocation.lifecycle, 'SUPERSEDED', allocation.debit_disposition, (case when allocation.debit_disposition = 'SPENT' then 'SPENT' else 'RETURNED' end)::public.ap_capacity_debit, 'CRITERIA_AMENDMENT_ACCEPTED');
  end loop;
  update public.ap_criteria_amendments set state = 'ACCEPTED', child_snapshot_id = p_child_snapshot_id,
    accepted_at = now(), revision_started_at = now(), revision_due_at = now() + interval '24 hours'
    where id = p_amendment_id;
  update public.ap_search_services set active_snapshot_id = p_child_snapshot_id, adjustment = 'ACCEPTED', updated_at = now() where id = service.id;
  return true;
end;
$$;

create or replace function public.ap_activate_material_line_revision(
  p_line_id uuid, p_new_revision_id uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare line public.ap_material_lines; prior public.ap_material_line_revisions; next_revision public.ap_material_line_revisions; allocation public.ap_capacity_allocations;
begin
  select * into line from public.ap_material_lines where id = p_line_id for update;
  if not found or line.materials_payment_verified_at is null then raise exception 'paid_material_line_required'; end if;
  select * into prior from public.ap_material_line_revisions where line_id = p_line_id and version = line.active_revision for update;
  select * into next_revision from public.ap_material_line_revisions where id = p_new_revision_id and line_id = p_line_id and parent_revision_id = prior.id and revision_kind in ('FACT_CORRECTION','REFERENCE_SCOPE','SUBSTITUTION') for update;
  if not found then raise exception 'invalid_material_revision'; end if;
  update public.ap_material_line_revisions set superseded_at = now() where id = prior.id;
  update public.ap_generated_file_versions f set superseded_at = coalesce(f.superseded_at, now()), downloads_revoked_at = coalesce(f.downloads_revoked_at, now())
    from public.ap_generated_artifacts a where f.artifact_id = a.id and a.material_line_id = p_line_id and a.source_line_revision_id = prior.id;
  for allocation in select * from public.ap_capacity_allocations where material_line_id = p_line_id and criteria_revision_id = prior.id and lifecycle in ('RESERVED','CONSUMED','COMPLETED') for update loop
    update public.ap_capacity_allocations set lifecycle = 'SUPERSEDED', debit_disposition = case when allocation.debit_disposition = 'SPENT' then 'SPENT'::public.ap_capacity_debit else 'RETURNED'::public.ap_capacity_debit end,
      returned_at = case when allocation.debit_disposition = 'SPENT' then returned_at else now() end, updated_at = now() where id = allocation.id;
    insert into public.ap_capacity_audit(allocation_id, from_lifecycle, to_lifecycle, from_debit, to_debit, reason_code)
      values (allocation.id, allocation.lifecycle, 'SUPERSEDED', allocation.debit_disposition, (case when allocation.debit_disposition = 'SPENT' then 'SPENT' else 'RETURNED' end)::public.ap_capacity_debit, 'MATERIAL_REVISION_SUPERSEDED');
  end loop;
  update public.ap_material_lines set active_revision = next_revision.version where id = p_line_id;
  return true;
end;
$$;

create or replace function public.ap_claim_material_entitlement(p_entitlement_history_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare entitlement public.ap_material_entitlement_history;
begin
  select * into entitlement from public.ap_material_entitlement_history where id = p_entitlement_history_id and state in ('OPEN','PAID','DELIVERED','REFUND_PENDING','DISPUTED') for update;
  if not found then raise exception 'entitlement_not_claimable'; end if;
  insert into public.ap_material_entitlement_claims(delivered_order_id, delivered_match_id, entitlement_history_id)
    values (entitlement.delivered_order_id, entitlement.delivered_match_id, entitlement.id);
  return true;
exception when unique_violation then raise exception 'material_match_already_claimed';
end;
$$;

create or replace function public.ap_release_fully_refunded_entitlement(p_entitlement_history_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare entitlement public.ap_material_entitlement_history; claim public.ap_material_entitlement_claims; allocated integer; refunded integer;
begin
  select * into entitlement from public.ap_material_entitlement_history where id = p_entitlement_history_id and state = 'FULLY_REFUNDED' for update;
  if not found then raise exception 'terminal_full_refund_required'; end if;
  select l.allocated_amount_cents,
    coalesce(sum(r.amount_cents) filter (where r.state = 'SUCCEEDED' and r.superseded_at is null), 0)::integer
    into allocated, refunded
    from public.ap_material_lines l left join public.ap_refund_operations r on r.material_line_id = l.id
    where l.id = entitlement.line_id group by l.allocated_amount_cents;
  if refunded <> allocated then raise exception 'successful_full_line_refund_required'; end if;
  select * into claim from public.ap_material_entitlement_claims
    where delivered_order_id = entitlement.delivered_order_id and delivered_match_id = entitlement.delivered_match_id for update;
  if not found then return false; end if;
  insert into public.ap_material_entitlement_history(line_id, delivered_order_id, delivered_match_id, revision_id, state, supersedes_id)
    values (entitlement.line_id, entitlement.delivered_order_id, entitlement.delivered_match_id, entitlement.revision_id, 'RELEASED', entitlement.id);
  delete from public.ap_material_entitlement_claims
    where delivered_order_id = entitlement.delivered_order_id and delivered_match_id = entitlement.delivered_match_id;
  return true;
end;
$$;
create or replace function public.ap_create_reference_record(
  p_customer_id uuid, p_encrypted_payload_id uuid, p_payload_schema_version text, p_payload_sha256 text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare reference_id uuid; version_id uuid;
begin
  if not exists (select 1 from public.ap_sensitive_payloads where id = p_encrypted_payload_id and customer_id = p_customer_id) then raise exception 'reference_payload_unavailable'; end if;
  insert into public.ap_reference_records(customer_id) values (p_customer_id) returning id into reference_id;
  insert into public.ap_reference_record_versions(reference_record_id,version,encrypted_payload_id,payload_schema_version,payload_sha256)
    values (reference_id,1,p_encrypted_payload_id,p_payload_schema_version,p_payload_sha256) returning id into version_id;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
    values (p_customer_id,'REFERENCE_CREATED','REFERENCE_RECORD',reference_id,jsonb_build_object('versionId',version_id),'v1');
  return reference_id;
end;
$$;

create or replace function public.ap_confirm_reference_version(p_customer_id uuid, p_reference_version_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ap_reference_record_versions v set permission_status='CONFIRMED',permission_last_confirmed_at=now()
    from public.ap_reference_records r where v.id=p_reference_version_id and r.id=v.reference_record_id and r.customer_id=p_customer_id
      and r.removed_at is null and v.version=r.current_version and v.superseded_at is null and v.permission_status='UNCONFIRMED';
  if not found then raise exception 'reference_version_not_confirmable'; end if;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,audit_version) values (p_customer_id,'REFERENCE_CONTACT_CONFIRMED','REFERENCE_VERSION',p_reference_version_id,'v1');
  return true;
end;
$$;

create or replace function public.ap_replace_reference(
  p_customer_id uuid, p_reference_record_id uuid, p_encrypted_payload_id uuid,
  p_payload_schema_version text, p_payload_sha256 text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare reference_row public.ap_reference_records; prior_version public.ap_reference_record_versions; next_id uuid;
begin
  select * into reference_row from public.ap_reference_records where id=p_reference_record_id and customer_id=p_customer_id and removed_at is null for update;
  if not found or not exists(select 1 from public.ap_sensitive_payloads where id=p_encrypted_payload_id and customer_id=p_customer_id) then raise exception 'reference_unavailable'; end if;
  select * into prior_version from public.ap_reference_record_versions where reference_record_id=reference_row.id and version=reference_row.current_version for update;
  update public.ap_reference_record_versions set permission_status='REVOKED',superseded_at=now() where id=prior_version.id;
  update public.ap_reference_permissions set revoked_at=coalesce(revoked_at,now()),contact_version_changed_at=now()
    where customer_id=p_customer_id and reference_record_version_id=prior_version.id and revoked_at is null;
  update public.ap_generated_file_versions f set downloads_revoked_at=coalesce(f.downloads_revoked_at,now())
    from public.ap_generated_artifacts a join public.ap_reference_permissions rp on rp.id=a.reference_permission_id
    where f.artifact_id=a.id and rp.reference_record_version_id=prior_version.id;
  insert into public.ap_reference_record_versions(reference_record_id,version,encrypted_payload_id,payload_schema_version,payload_sha256)
    values (reference_row.id,reference_row.current_version+1,p_encrypted_payload_id,p_payload_schema_version,p_payload_sha256) returning id into next_id;
  update public.ap_reference_records set current_version=current_version+1 where id=reference_row.id;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
    values (p_customer_id,'REFERENCE_REPLACED','REFERENCE_RECORD',reference_row.id,jsonb_build_object('priorVersionId',prior_version.id,'nextVersionId',next_id),'v1');
  return next_id;
end;
$$;

create or replace function public.ap_grant_reference_permission(
  p_customer_id uuid, p_reference_version_id uuid, p_delivered_release_id uuid,
  p_job_snapshot_id uuid, p_job_snapshot_hash text, p_employer_snapshot text,
  p_exact_position_snapshot text, p_permission_text_version text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare permission_id uuid;
begin
  if not exists (
    select 1 from public.ap_reference_record_versions v join public.ap_reference_records r on r.id=v.reference_record_id
    join public.ap_job_snapshots j on j.id=p_job_snapshot_id join public.ap_releases rel on rel.id=p_delivered_release_id
    where v.id=p_reference_version_id and r.customer_id=p_customer_id and r.removed_at is null
      and v.version=r.current_version and v.superseded_at is null and v.permission_status='CONFIRMED'
      and j.content_sha256=p_job_snapshot_hash and rel.customer_id=p_customer_id and rel.committed_at is not null
  ) then raise exception 'exact_job_reference_permission_invalid'; end if;
  insert into public.ap_reference_permissions(customer_id,reference_record_version_id,delivered_release_id,job_snapshot_id,job_snapshot_hash,employer_snapshot,exact_position_snapshot,permission_text_version,attested_at)
    values (p_customer_id,p_reference_version_id,p_delivered_release_id,p_job_snapshot_id,p_job_snapshot_hash,p_employer_snapshot,p_exact_position_snapshot,p_permission_text_version,now())
    returning id into permission_id;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
    values (p_customer_id,'REFERENCE_EXACT_JOB_PERMISSION_GRANTED','REFERENCE_PERMISSION',permission_id,jsonb_build_object('jobSnapshotId',p_job_snapshot_id),'v1');
  return permission_id;
end;
$$;

create or replace function public.ap_revoke_reference_permission(p_customer_id uuid,p_permission_id uuid,p_reason_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ap_reference_permissions set revoked_at=coalesce(revoked_at,now()) where id=p_permission_id and customer_id=p_customer_id;
  if not found then raise exception 'reference_permission_unavailable'; end if;
  update public.ap_generated_file_versions f set downloads_revoked_at=coalesce(f.downloads_revoked_at,now())
    from public.ap_generated_artifacts a where f.artifact_id=a.id and a.reference_permission_id=p_permission_id;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
    values (p_customer_id,'REFERENCE_PERMISSION_REVOKED','REFERENCE_PERMISSION',p_permission_id,jsonb_build_object('reasonCode',p_reason_code),'v1');
  return true;
end;
$$;

create or replace function public.ap_remove_reference(p_customer_id uuid,p_reference_record_id uuid,p_reason_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ap_reference_records set removed_at=coalesce(removed_at,now()),retention_state='DELETE_PENDING' where id=p_reference_record_id and customer_id=p_customer_id;
  if not found then raise exception 'reference_unavailable'; end if;
  update public.ap_reference_record_versions v set permission_status='REVOKED' from public.ap_reference_records r where v.reference_record_id=r.id and r.id=p_reference_record_id and v.version=r.current_version;
  update public.ap_reference_permissions p set revoked_at=coalesce(p.revoked_at,now())
    from public.ap_reference_record_versions v where p.reference_record_version_id=v.id and v.reference_record_id=p_reference_record_id;
  update public.ap_generated_file_versions f set downloads_revoked_at=coalesce(f.downloads_revoked_at,now())
    from public.ap_generated_artifacts a join public.ap_reference_permissions rp on rp.id=a.reference_permission_id
    join public.ap_reference_record_versions v on v.id=rp.reference_record_version_id
    where f.artifact_id=a.id and v.reference_record_id=p_reference_record_id;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
    values (p_customer_id,'REFERENCE_REMOVED','REFERENCE_RECORD',p_reference_record_id,jsonb_build_object('reasonCode',p_reason_code),'v1');
  return true;
end;
$$;

create or replace function public.ap_record_reference_staff_access(p_reference_record_id uuid,p_staff_id uuid,p_purpose text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare access_id bigint;
begin
  if p_purpose not in ('FULFILLMENT','CUSTOMER_SUPPORT','SECURITY_INCIDENT','LEGAL_HOLD') or not exists(select 1 from public.profiles where id=p_staff_id and role in ('operator','admin')) then raise exception 'reference_staff_access_denied'; end if;
  insert into public.ap_reference_staff_access(reference_record_id,staff_id,purpose) values (p_reference_record_id,p_staff_id,p_purpose) returning id into access_id;
  return access_id;
end;
$$;

create or replace function public.ap_commit_release(
  p_release_id uuid,p_customer_id uuid,p_order_id uuid,p_material_line_id uuid,p_release_kind text,
  p_committed_at timestamptz,p_active_due_at timestamptz,p_version_bundle jsonb,p_human_approved_by uuid,p_members jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare expected_count integer; member jsonb; artifact_types text[];
begin
  expected_count := case p_release_kind when 'SEARCH_EXACT_TEN' then 10 when 'MATERIAL_PAIR' then 2 when 'MATERIAL_TRIPLE' then 3 when 'REFERENCE_REGENERATION' then 1 else 0 end;
  if expected_count=0 or jsonb_typeof(p_members)<>'array' or jsonb_array_length(p_members)<>expected_count then raise exception 'atomic_release_member_count_invalid'; end if;
  if p_release_kind like 'MATERIAL_%' and p_material_line_id is null then raise exception 'material_release_line_required'; end if;
  insert into public.ap_releases(id,customer_id,order_id,material_line_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by)
    values (p_release_id,p_customer_id,p_order_id,p_material_line_id,p_release_kind,p_committed_at,p_active_due_at,p_version_bundle,p_human_approved_by);
  for member in select value from jsonb_array_elements(p_members) loop
    if member->>'memberType'='JOB_MATCH' then
      if p_release_kind<>'SEARCH_EXACT_TEN' or not exists(select 1 from public.job_matches where id=(member->>'memberId')::uuid and search_order_id=p_order_id) then raise exception 'invalid_search_release_member'; end if;
    elsif member->>'memberType'='GENERATED_ARTIFACT' then
      if not exists(select 1 from public.ap_generated_artifacts a join public.ap_generated_file_versions f on f.artifact_id=a.id and f.version=a.current_file_version
        where a.id=(member->>'memberId')::uuid and a.customer_id=p_customer_id and a.order_id=p_order_id
          and a.material_line_id is not distinct from p_material_line_id and f.superseded_at is null
          and f.human_content_approved_at is not null and f.human_visual_approved_at is not null) then raise exception 'unapproved_artifact_release_member'; end if;
    else raise exception 'invalid_release_member_type'; end if;
    insert into public.ap_release_members(release_id,member_type,member_id,position)
      values (p_release_id,member->>'memberType',(member->>'memberId')::uuid,(member->>'position')::integer);
  end loop;
  if p_release_kind in ('MATERIAL_PAIR','MATERIAL_TRIPLE') then
    select array_agg(a.artifact_type::text order by a.artifact_type::text) into artifact_types
      from public.ap_release_members m join public.ap_generated_artifacts a on a.id=m.member_id where m.release_id=p_release_id;
    if (p_release_kind='MATERIAL_PAIR' and artifact_types<>array['COVER_LETTER','RESUME'])
      or (p_release_kind='MATERIAL_TRIPLE' and artifact_types<>array['COVER_LETTER','REFERENCE_SHEET','RESUME']) then raise exception 'atomic_material_release_types_invalid'; end if;
    update public.ap_material_lines set earned_revenue_at=coalesce(earned_revenue_at,p_committed_at),fulfillment='DELIVERED' where id=p_material_line_id;
  end if;
  return p_release_id;
end;
$$;
create or replace function public.ap_claim_scheduled_jobs(p_owner text, p_limit integer default 10)
returns setof public.ap_scheduled_jobs language plpgsql security definer set search_path = '' as $$
begin
  if length(trim(p_owner)) < 3 or p_limit not between 1 and 50 then raise exception 'invalid_job_claim'; end if;
  return query with candidates as (
    select id from public.ap_scheduled_jobs where run_at <= now() and (state in ('QUEUED','RETRY') or (state = 'LEASED' and lease_expires_at <= now()))
    order by run_at, id for update skip locked limit p_limit
  ) update public.ap_scheduled_jobs j set state = 'LEASED', lease_owner = p_owner, lease_expires_at = now() + interval '5 minutes', attempts = attempts + 1, updated_at = now()
    from candidates where j.id = candidates.id returning j.*;
end;
$$;

create or replace function public.ap_claim_retention_cleanup(p_owner text, p_limit integer default 10)
returns setof public.ap_scheduled_jobs language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select cleanup_enabled from public.ap_retention_configuration where singleton), false) then
    raise exception 'retention_cleanup_disabled_unapproved';
  end if;
  insert into public.ap_scheduled_jobs(job_kind, reference_id, idempotency_key, run_at)
  select 'ANONYMOUS_DRAFT_RETENTION', id, 'retention:draft:' || id::text, retention_due_at
  from public.ap_anonymous_drafts where retention_due_at is not null and retention_due_at <= now() and state not in ('CONVERTED','EXPIRED')
  on conflict (idempotency_key) do nothing;
  insert into public.ap_scheduled_jobs(job_kind, reference_id, idempotency_key, run_at)
  select 'SOURCE_DOCUMENT_RETENTION', id, 'retention:document:' || id::text, retention_due_at
  from public.ap_document_versions where retention_due_at is not null and retention_due_at <= now() and retention_state = 'ACTIVE'
  on conflict (idempotency_key) do nothing;
  return query select * from public.ap_claim_scheduled_jobs(p_owner, p_limit);
end;
$$;

-- Backfill compatibility records without modifying legacy paid orders.
insert into public.ap_payment_attempts(customer_id, legacy_payment_id, provider, provider_payment_id, amount_cents, currency, settlement, dispute, payment_verified_at)
select coalesce(o.customer_id, c.customer_id), p.id, p.provider, p.provider_payment_id, p.amount_cents, 'USD',
  case when lower(p.status) in ('paid','refunded') then 'PAID'::public.ap_payment_settlement when lower(p.status) = 'failed' then 'FAILED'::public.ap_payment_settlement else 'PROCESSING'::public.ap_payment_settlement end,
  'NONE', case when lower(p.status) in ('paid','refunded') then p.created_at else null end
from public.payments p left join public.orders o on o.id = p.order_id left join public.apply_pack_carts c on c.id = p.apply_pack_cart_id
where coalesce(o.customer_id, c.customer_id) is not null
on conflict (legacy_payment_id) do nothing;

insert into public.ap_search_services(legacy_order_id, customer_id, winning_payment_attempt_id, fulfillment, intake_completed_at, service_started_at, delivery_due_at, search_activated_at, legacy_record, version_bundle)
select o.id, o.customer_id, p.id,
  case when o.status::text in ('delivered','delivered_refunded') then 'DELIVERED'::public.ap_search_fulfillment
       when o.status::text in ('cancelled','refunded') then 'CANCELED'::public.ap_search_fulfillment
       when o.status::text in ('paid','in_fulfillment','delivery_processing') then 'RESEARCHING'::public.ap_search_fulfillment
       else 'QUEUED'::public.ap_search_fulfillment end,
  i.criteria_approved_at, o.paid_at, o.delivery_deadline,
  case when o.paid_at is not null then o.paid_at else null end,
  true, jsonb_build_object('legacySchema','202609030021','legacyOrderStatus',o.status::text)
from public.orders o left join public.intakes i on i.id = o.intake_id
left join public.ap_payment_attempts p on p.legacy_payment_id = (select payments.id from public.payments where payments.order_id = o.id order by payments.created_at limit 1)
where o.product_kind = 'job_search'
on conflict (legacy_order_id) do nothing;

insert into public.ap_migration_checkpoints(migration_id, checkpoint, rows_processed, completed_at)
values ('202609040022', 'LEGACY_ORDERS_V1', (select count(*) from public.orders where paid_at is not null), now())
on conflict (migration_id, checkpoint) do update set rows_processed = excluded.rows_processed, completed_at = excluded.completed_at;

create view public.ap_legacy_order_compatibility as
select o.*, s.id as corrected_search_service_id, s.fulfillment as corrected_fulfillment, p.id as corrected_payment_attempt_id, p.settlement as corrected_settlement
from public.orders o left join public.ap_search_services s on s.legacy_order_id = o.id
left join public.ap_payment_attempts p on p.id = s.winning_payment_attempt_id;

-- Default-deny access. Anonymous capability access is only through the
-- service-role RPCs above; the Data API never receives a raw secret hash.
do $$ declare table_name text; begin
  foreach table_name in array array[
    'ap_anonymous_drafts','ap_sensitive_payloads','ap_independent_verification_sources','ap_document_versions','ap_intake_snapshots','ap_candidate_facts','ap_candidate_fact_conflicts','ap_experience_identities','ap_catalog_versions','ap_inventory_versions','ap_feasibility_coverage_plans','ap_feasibility_coverage_cells','ap_feasibility_assessments','ap_job_snapshots','ap_requirement_nodes','ap_human_review_records','ap_match_evaluations','ap_capacity_pools','ap_capacity_buckets','ap_capacity_allocations','ap_capacity_allocation_members','ap_capacity_audit','ap_quotes','ap_external_commands','ap_checkout_attempts','ap_payment_attempts','ap_provider_events','ap_search_services','ap_criteria_amendments','ap_material_purchases','ap_material_lines','ap_material_line_revisions','ap_material_entitlement_history','ap_material_entitlement_claims','ap_refund_operations','ap_outbox_messages','ap_releases','ap_release_members','ap_generated_artifacts','ap_generated_file_versions','ap_reference_records','ap_reference_record_versions','ap_reference_permissions','ap_reference_staff_access','ap_scheduled_jobs','ap_audit_events','ap_migration_checkpoints','ap_feature_flags','ap_commerce_configuration','ap_retention_configuration'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant all privileges on public.%I to service_role', table_name);
  end loop;
end $$;

revoke all on public.ap_payment_refund_aggregates, public.ap_legacy_order_compatibility from public, anon, authenticated;
grant select on public.ap_payment_refund_aggregates, public.ap_legacy_order_compatibility to service_role;

create or replace function public.ap_can_access_customer(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_customer_id = auth.uid() or public.is_admin();
$$;
revoke all on function public.ap_can_access_customer(uuid) from public, anon;
grant execute on function public.ap_can_access_customer(uuid) to authenticated, service_role;

do $$ declare row record; begin
  for row in select * from (values
    ('ap_intake_snapshots','customer_id'),('ap_independent_verification_sources','customer_id'),('ap_candidate_facts','customer_id'),('ap_experience_identities','customer_id'),
    ('ap_human_review_records','customer_id'),('ap_match_evaluations','customer_id'),('ap_capacity_allocations','customer_id'),
    ('ap_quotes','customer_id'),('ap_external_commands','customer_id'),('ap_checkout_attempts','customer_id'),
    ('ap_payment_attempts','customer_id'),('ap_search_services','customer_id'),('ap_material_purchases','customer_id'),
    ('ap_refund_operations','customer_id'),('ap_outbox_messages','customer_id'),('ap_releases','customer_id'),
    ('ap_generated_artifacts','customer_id'),('ap_reference_records','customer_id'),('ap_reference_permissions','customer_id'),
    ('ap_audit_events','customer_id')
  ) as policies(table_name, owner_column) loop
    execute format('grant select on public.%I to authenticated', row.table_name);
    execute format('create policy %I on public.%I for select to authenticated using (public.ap_can_access_customer(%I))', row.table_name || '_owner_select', row.table_name, row.owner_column);
  end loop;
end $$;

-- Child records inherit ownership through their protected parent.
grant select on public.ap_candidate_fact_conflicts, public.ap_material_lines, public.ap_material_line_revisions,
  public.ap_material_entitlement_history, public.ap_material_entitlement_claims, public.ap_generated_file_versions,
  public.ap_reference_record_versions, public.ap_reference_staff_access to authenticated;
create policy ap_candidate_fact_conflicts_owner_select on public.ap_candidate_fact_conflicts for select to authenticated using (
  exists(select 1 from public.ap_candidate_facts f where f.id = fact_id and public.ap_can_access_customer(f.customer_id)));
create policy ap_material_lines_owner_select on public.ap_material_lines for select to authenticated using (
  exists(select 1 from public.ap_material_purchases p where p.id = purchase_id and public.ap_can_access_customer(p.customer_id)));
create policy ap_material_line_revisions_owner_select on public.ap_material_line_revisions for select to authenticated using (
  exists(select 1 from public.ap_material_lines l join public.ap_material_purchases p on p.id = l.purchase_id where l.id = line_id and public.ap_can_access_customer(p.customer_id)));
create policy ap_material_entitlement_history_owner_select on public.ap_material_entitlement_history for select to authenticated using (
  exists(select 1 from public.ap_material_lines l join public.ap_material_purchases p on p.id = l.purchase_id where l.id = line_id and public.ap_can_access_customer(p.customer_id)));
create policy ap_material_entitlement_claims_owner_select on public.ap_material_entitlement_claims for select to authenticated using (
  exists(select 1 from public.ap_material_entitlement_history h join public.ap_material_lines l on l.id = h.line_id join public.ap_material_purchases p on p.id = l.purchase_id where h.id = entitlement_history_id and public.ap_can_access_customer(p.customer_id)));
create policy ap_generated_file_versions_owner_select on public.ap_generated_file_versions for select to authenticated using (
  exists(select 1 from public.ap_generated_artifacts a where a.id = artifact_id and public.ap_can_access_customer(a.customer_id)));
create policy ap_reference_record_versions_owner_select on public.ap_reference_record_versions for select to authenticated using (
  exists(select 1 from public.ap_reference_records r where r.id = reference_record_id and public.ap_can_access_customer(r.customer_id)));
create policy ap_reference_staff_access_owner_select on public.ap_reference_staff_access for select to authenticated using (
  exists(select 1 from public.ap_reference_records r where r.id = reference_record_id and public.ap_can_access_customer(r.customer_id)));

-- RPCs are service-role only. Application routes authenticate capabilities and
-- call them through the server-only administrative client.
revoke all on function public.ap_lock_anonymous_draft_to_checkout(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.ap_return_anonymous_draft_after_checkout(uuid,text) from public, anon, authenticated;
revoke all on function public.ap_create_anonymous_draft(uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.ap_read_anonymous_draft(uuid,text) from public, anon, authenticated;
revoke all on function public.ap_save_anonymous_draft(uuid,text,bigint,integer,jsonb) from public, anon, authenticated;
revoke all on function public.ap_rotate_anonymous_draft_capability(uuid,text,text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.ap_register_anonymous_document(uuid,text,bigint,uuid,public.ap_document_kind,text,text,integer,text,text,text) from public, anon, authenticated;
revoke all on function public.ap_apply_document_pipeline_result(uuid,integer,public.ap_document_processing_state,text,text,text,text,text,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.ap_remove_anonymous_document(uuid,text,bigint,public.ap_document_kind) from public, anon, authenticated;
revoke all on function public.ap_capacity_available(uuid) from public, anon, authenticated;
revoke all on function public.ap_reserve_capacity(uuid,public.ap_capacity_resource,integer,text,timestamptz,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.ap_release_unconsumed_capacity(uuid,text) from public, anon, authenticated;
revoke all on function public.ap_invalidate_pre_activation_snapshot(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.ap_accept_criteria_amendment(uuid,uuid) from public, anon, authenticated;
revoke all on function public.ap_activate_material_line_revision(uuid,uuid) from public, anon, authenticated;
revoke all on function public.ap_claim_material_entitlement(uuid) from public, anon, authenticated;
revoke all on function public.ap_release_fully_refunded_entitlement(uuid) from public, anon, authenticated;
revoke all on function public.ap_create_reference_record(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.ap_confirm_reference_version(uuid,uuid) from public, anon, authenticated;
revoke all on function public.ap_replace_reference(uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.ap_grant_reference_permission(uuid,uuid,uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.ap_revoke_reference_permission(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.ap_remove_reference(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.ap_record_reference_staff_access(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.ap_commit_release(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.ap_claim_scheduled_jobs(text,integer) from public, anon, authenticated;
revoke all on function public.ap_claim_retention_cleanup(text,integer) from public, anon, authenticated;
grant execute on function public.ap_lock_anonymous_draft_to_checkout(uuid,text,uuid) to service_role;
grant execute on function public.ap_return_anonymous_draft_after_checkout(uuid,text) to service_role;
grant execute on function public.ap_create_anonymous_draft(uuid,text,timestamptz) to service_role;
grant execute on function public.ap_read_anonymous_draft(uuid,text) to service_role;
grant execute on function public.ap_save_anonymous_draft(uuid,text,bigint,integer,jsonb) to service_role;
grant execute on function public.ap_rotate_anonymous_draft_capability(uuid,text,text,uuid,uuid) to service_role;
grant execute on function public.ap_register_anonymous_document(uuid,text,bigint,uuid,public.ap_document_kind,text,text,integer,text,text,text) to service_role;
grant execute on function public.ap_apply_document_pipeline_result(uuid,integer,public.ap_document_processing_state,text,text,text,text,text,jsonb,text,text) to service_role;
grant execute on function public.ap_remove_anonymous_document(uuid,text,bigint,public.ap_document_kind) to service_role;
grant execute on function public.ap_capacity_available(uuid) to service_role;
grant execute on function public.ap_reserve_capacity(uuid,public.ap_capacity_resource,integer,text,timestamptz,jsonb,uuid) to service_role;
grant execute on function public.ap_release_unconsumed_capacity(uuid,text) to service_role;
grant execute on function public.ap_invalidate_pre_activation_snapshot(uuid,uuid,uuid,text) to service_role;
grant execute on function public.ap_accept_criteria_amendment(uuid,uuid) to service_role;
grant execute on function public.ap_activate_material_line_revision(uuid,uuid) to service_role;
grant execute on function public.ap_claim_material_entitlement(uuid) to service_role;
grant execute on function public.ap_release_fully_refunded_entitlement(uuid) to service_role;
grant execute on function public.ap_create_reference_record(uuid,uuid,text,text) to service_role;
grant execute on function public.ap_confirm_reference_version(uuid,uuid) to service_role;
grant execute on function public.ap_replace_reference(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.ap_grant_reference_permission(uuid,uuid,uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.ap_revoke_reference_permission(uuid,uuid,text) to service_role;
grant execute on function public.ap_remove_reference(uuid,uuid,text) to service_role;
grant execute on function public.ap_record_reference_staff_access(uuid,uuid,text) to service_role;
grant execute on function public.ap_commit_release(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,uuid,jsonb) to service_role;
grant execute on function public.ap_claim_scheduled_jobs(text,integer) to service_role;
grant execute on function public.ap_claim_retention_cleanup(text,integer) to service_role;

update storage.buckets set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
where id = 'customer-source-documents';
