-- Corrected-contract Chunk 4: fail-closed commerce, verified payment,
-- scoped access, exact-ten release, adjustments, refunds, and durable outbox.
-- This migration is additive. Legacy commerce remains readable but the new
-- search checkout route uses only the ap_* state machines below.

create type public.ap_access_capability_kind as enum ('IMMEDIATE_ORDER','EMAIL_ACCESS');
create type public.ap_access_capability_state as enum ('ISSUED','CONSUMED','EXPIRED','REVOKED');
create type public.ap_staff_review_decision as enum ('APPROVED','REJECTED','EVIDENCE_REQUIRED','CUSTOMER_INPUT_REQUIRED');

alter table public.ap_commerce_configuration
  add column pricing_version text,
  add column tax_version text,
  add column terms_version text,
  add column privacy_version text,
  add column canonical_site_url text,
  add column access_callback_url text,
  add column provider_idempotent_email_approved boolean not null default false,
  add column provider_email_approval_reference text,
  add column payment_provider text check (payment_provider is null or payment_provider = 'stripe'),
  add column payment_api_version text,
  add column immediate_payment_methods text[] not null default '{}',
  add column release_verification_ttl_seconds integer check (release_verification_ttl_seconds is null or release_verification_ttl_seconds = 3600),
  add constraint ap_commerce_canonical_site_url_check check (canonical_site_url is null or canonical_site_url ~ '^https://[A-Za-z0-9.-]+(?::[0-9]+)?$'),
  add constraint ap_commerce_access_callback_url_check check (access_callback_url is null or access_callback_url ~ '^https://[A-Za-z0-9.-]+(?::[0-9]+)?/auth/callback$'),
  add constraint ap_commerce_email_provider_approval_check check (not provider_idempotent_email_approved or provider_email_approval_reference is not null);

create table public.ap_snapshot_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.ap_anonymous_drafts(id),
  snapshot_id uuid not null unique references public.ap_intake_snapshots(id),
  terms_version text not null,
  privacy_version text not null,
  acceptance_sha256 text not null check (acceptance_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default now(),
  unique(draft_id, terms_version, privacy_version, acceptance_sha256)
);

alter table public.ap_quotes
  add column capacity_allocation_id uuid references public.ap_capacity_allocations(id),
  add column pricing_version text,
  add column tax_version text,
  add column terms_version text,
  add column privacy_version text,
  add column idempotency_key text,
  add constraint ap_quote_capacity_unique unique (capacity_allocation_id),
  add constraint ap_quote_idempotency_unique unique (idempotency_key);

alter table public.ap_external_commands
  add column lease_expires_at timestamptz,
  add column applied_at timestamptz,
  add column compensated_at timestamptz,
  add column result_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(result_metadata) = 'object'),
  add constraint ap_command_creating_lease_check check (
    state <> 'CREATING' or command_kind='CREATE_CHECKOUT' or lease_expires_at is not null
  ),
  add constraint ap_command_applied_time_check check (state <> 'APPLIED' or applied_at is not null),
  add constraint ap_command_compensated_time_check check (state <> 'COMPENSATED' or compensated_at is not null);

alter table public.ap_checkout_attempts
  add column browser_capability_secret_hash text check (browser_capability_secret_hash is null or browser_capability_secret_hash ~ '^[0-9a-f]{64}$'),
  add column email_capability_secret_hash text check (email_capability_secret_hash is null or email_capability_secret_hash ~ '^[0-9a-f]{64}$'),
  add column access_payload_id uuid references public.ap_sensitive_payloads(id),
  add column promoted_at timestamptz,
  add column invalidated_at timestamptz,
  add column stale_reason text,
  add column reacquisition_attempted_at timestamptz,
  add column reacquired_capacity_allocation_id uuid references public.ap_capacity_allocations(id),
  add column capacity_exception_at timestamptz,
  add column capacity_exception_reason text,
  add constraint ap_checkout_browser_capability_unique unique (browser_capability_secret_hash),
  add constraint ap_checkout_email_capability_unique unique (email_capability_secret_hash);

alter table public.ap_payment_attempts
  add column provider_checkout_session_id text,
  add column provider_event_id text,
  add column payer_receipt_email text,
  add column provider_payment_status text,
  add column payment_method_type text,
  add column payment_command_id uuid references public.ap_external_commands(id),
  add column immediate_charge_verified boolean not null default false,
  add constraint ap_payment_checkout_session_unique unique (provider_checkout_session_id),
  add constraint ap_payment_event_unique unique (provider_event_id),
  add constraint ap_payment_immediate_charge_check check (
    settlement <> 'PAID' or checkout_attempt_id is null or immediate_charge_verified
  ),
  add constraint ap_payment_command_unique unique (payment_command_id);

drop trigger ap_provider_events_immutable on public.ap_provider_events;
alter table public.ap_provider_events add column result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object');
create or replace function public.ap_guard_provider_event_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE'
    or (to_jsonb(new) - array['applied_at','failure_code','result']) <> (to_jsonb(old) - array['applied_at','failure_code','result'])
    or old.applied_at is not null
    or old.failure_code is not null
    or (new.applied_at is null and new.failure_code is null)
    or (new.applied_at is not null and new.failure_code is not null)
  then raise exception 'immutable_provider_event'; end if;
  return new;
end;
$$;
create trigger ap_provider_events_guard before update or delete on public.ap_provider_events for each row execute function public.ap_guard_provider_event_update();

alter table public.ap_search_services
  add column revenue_earned_at timestamptz,
  add column capacity_exception_at timestamptz,
  add column capacity_exception_reason text,
  add column refund_started_at timestamptz,
  add column canceled_at timestamptz,
  add column active_deadline_revision integer not null default 1 check (active_deadline_revision > 0),
  add constraint ap_search_revenue_release_check check (revenue_earned_at is null or fulfillment = 'DELIVERED'),
  add constraint ap_search_capacity_exception_check check ((capacity_exception_at is null) = (capacity_exception_reason is null));
create unique index ap_one_activated_search_per_snapshot on public.ap_search_services(original_snapshot_id)
  where original_snapshot_id is not null and search_activated_at is not null;

alter table public.ap_criteria_amendments
  add column current_valid_count integer check (current_valid_count is null or current_valid_count between 0 and 9),
  add column reason_codes text[] not null default '{}',
  add column blocking_constraints jsonb not null default '{}'::jsonb check (jsonb_typeof(blocking_constraints) = 'object'),
  add column proposed_snapshot_patch jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_snapshot_patch) = 'object'),
  add column estimated_revision_seconds integer check (estimated_revision_seconds is null or estimated_revision_seconds > 0),
  add column accepted_by uuid references public.profiles(id),
  add column acceptance_idempotency_key text,
  add column decline_idempotency_key text,
  add column accepted_snapshot_content_sha256 text check (accepted_snapshot_content_sha256 is null or accepted_snapshot_content_sha256 ~ '^[0-9a-f]{64}$'),
  add column declined_at timestamptz,
  add column decline_reason text,
  add constraint ap_amendment_expiry_before_due check (proposal_expires_at > created_at);
create unique index ap_criteria_amendment_acceptance_idempotency on public.ap_criteria_amendments(acceptance_idempotency_key)
  where acceptance_idempotency_key is not null;
create unique index ap_criteria_amendment_decline_idempotency on public.ap_criteria_amendments(decline_idempotency_key)
  where decline_idempotency_key is not null;

alter table public.ap_refund_operations
  add column reason_code text,
  add column requested_at timestamptz not null default now(),
  add column failed_at timestamptz,
  add column retry_count integer not null default 0 check (retry_count >= 0),
  add column last_error_code text,
  add column provider_event_id text,
  add constraint ap_refund_provider_event_unique unique (provider_event_id),
  add constraint ap_refund_failure_time_check check (
    state <> 'FAILED' or provider_command_id is null or failed_at is not null
  );

create or replace function public.ap_guard_refund_integrity()
returns trigger language plpgsql set search_path = '' as $$
declare payment public.ap_payment_attempts; line public.ap_material_lines; successful_total integer;
begin
  if tg_op='DELETE' then raise exception 'immutable_refund_operation_identity'; end if;
  if tg_op='UPDATE' and (
    (to_jsonb(new)-array['state','completed_at','provider_refund_id','provider_command_id','superseded_at',
      'failed_at','retry_count','last_error_code','provider_event_id'])
      <>
    (to_jsonb(old)-array['state','completed_at','provider_refund_id','provider_command_id','superseded_at',
      'failed_at','retry_count','last_error_code','provider_event_id'])
    or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
    or (old.provider_refund_id is not null and new.provider_refund_id is distinct from old.provider_refund_id
      and not (old.state='FAILED' and new.state='PENDING' and new.provider_refund_id is null
        and new.provider_command_id is distinct from old.provider_command_id
        and new.retry_count=old.retry_count+1))
    or old.state='SUCCEEDED' and new.state<>'SUCCEEDED'
    or old.retry_count>new.retry_count
  ) then raise exception 'immutable_refund_operation_identity'; end if;
  select * into payment from public.ap_payment_attempts where id=new.payment_attempt_id;
  if not found or payment.customer_id is distinct from new.customer_id or payment.currency<>new.currency
    then raise exception 'refund_payment_subject_mismatch'; end if;
  if new.scope='MATERIAL_LINE' then
    select * into line from public.ap_material_lines where id=new.material_line_id
      and payment_attempt_id=new.payment_attempt_id;
    if not found or line.allocated_amount_cents<>new.amount_cents
      then raise exception 'material_line_refund_amount_mismatch'; end if;
  elsif new.amount_cents<>payment.amount_cents then raise exception 'full_attempt_refund_amount_mismatch'; end if;
  if new.state='SUCCEEDED' and new.superseded_at is null then
    select coalesce(sum(amount_cents),0)::integer into successful_total
    from public.ap_refund_operations
    where payment_attempt_id=new.payment_attempt_id and state='SUCCEEDED'
      and superseded_at is null and id<>new.id;
    if successful_total+new.amount_cents>payment.amount_cents
      then raise exception 'refund_total_exceeds_payment'; end if;
  end if;
  return new;
end;
$$;

-- Chunk 1 intentionally allowed only terminal refund transitions. Chunk 4 adds an
-- explicit, audited retry edge while keeping every other regression prohibited.
drop trigger ap_refund_state_guard on public.ap_refund_operations;
create or replace function public.ap_guard_refund_state_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state is distinct from new.state and not (
    (old.state='PENDING' and new.state in ('SUCCEEDED','FAILED'))
    or (
      old.state='FAILED' and new.state='PENDING'
      and old.failed_at is not null
      and new.failed_at is not distinct from old.failed_at
      and new.retry_count=old.retry_count+1
      and new.provider_command_id is distinct from old.provider_command_id
      and new.provider_refund_id is null
      and new.provider_event_id is null
      and new.last_error_code is null
    )
  ) then raise exception 'invalid_refund_transition'; end if;
  return new;
end;
$$;
create trigger ap_refund_state_guard before update on public.ap_refund_operations
for each row execute function public.ap_guard_refund_state_transition();
drop trigger ap_refund_integrity_guard on public.ap_refund_operations;
create trigger ap_refund_integrity_guard before insert or update or delete on public.ap_refund_operations
for each row execute function public.ap_guard_refund_integrity();

alter table public.ap_outbox_messages
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column first_submitted_at timestamptz,
  add column dead_lettered_at timestamptz,
  add column provider_idempotency_expires_at timestamptz,
  add constraint ap_outbox_lease_check check (state <> 'SENDING' or (lease_owner is not null and lease_expires_at is not null)),
  add constraint ap_outbox_dead_letter_check check (state <> 'DEAD_LETTER' or dead_lettered_at is not null);

create table public.ap_order_access_capabilities (
  id uuid primary key default gen_random_uuid(),
  checkout_attempt_id uuid not null references public.ap_checkout_attempts(id),
  order_id uuid not null references public.orders(id),
  customer_id uuid not null references public.profiles(id),
  kind public.ap_access_capability_kind not null,
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  state public.ap_access_capability_state not null default 'ISSUED',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  issued_at timestamptz not null default now(),
  check (expires_at = issued_at + interval '15 minutes'),
  check ((state = 'CONSUMED') = (consumed_at is not null)),
  check ((state = 'REVOKED') = (revoked_at is not null)),
  unique(checkout_attempt_id, kind)
);
alter table public.ap_order_access_capabilities
  drop constraint ap_order_access_capabilities_checkout_attempt_id_kind_key;
create unique index ap_one_issued_order_access_capability
  on public.ap_order_access_capabilities(checkout_attempt_id,kind) where state='ISSUED';

alter table public.job_matches
  add column release_evaluation_id uuid references public.ap_match_evaluations(id),
  add column release_explanation jsonb not null default '{}'::jsonb check (jsonb_typeof(release_explanation)='object'),
  add column allowed_unknown_warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(allowed_unknown_warnings)='array'),
  add column source_provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(source_provenance)='object'),
  add column compensation_status text,
  add column posted_on date,
  add column posted_date_unknown boolean not null default true,
  add column last_checked_at timestamptz;
create unique index ap_job_matches_release_evaluation_unique on public.job_matches(release_evaluation_id)
  where release_evaluation_id is not null;
create unique index ap_one_exact_ten_release_per_order on public.ap_releases(order_id,release_kind)
  where release_kind='SEARCH_EXACT_TEN';

create table public.ap_search_deadline_history (
  id uuid primary key default gen_random_uuid(),
  search_service_id uuid not null references public.ap_search_services(id),
  revision integer not null check (revision > 0),
  reason text not null check (reason in ('INITIAL_ACTIVATION','ADJUSTMENT_ACCEPTED')),
  started_at timestamptz not null,
  due_at timestamptz not null,
  capacity_allocation_id uuid not null references public.ap_capacity_allocations(id),
  criteria_snapshot_id uuid not null references public.ap_intake_snapshots(id),
  created_at timestamptz not null default now(),
  check (due_at = started_at + interval '24 hours'),
  unique(search_service_id, revision)
);

create table public.ap_job_release_reviews (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  search_service_id uuid not null references public.ap_search_services(id),
  evaluation_id uuid not null references public.ap_match_evaluations(id),
  reviewer_id uuid not null references public.profiles(id),
  decision public.ap_staff_review_decision not null,
  bound_snapshot_id uuid not null references public.ap_intake_snapshots(id),
  bound_job_snapshot_id uuid not null references public.ap_job_snapshots(id),
  bound_fact_ids uuid[] not null,
  bound_version_bundle jsonb not null check (jsonb_typeof(bound_version_bundle) = 'object'),
  reviewed_at timestamptz not null default now(),
  invalidated_at timestamptz,
  rationale text not null check (length(btrim(rationale)) >= 20)
);
create unique index ap_current_job_release_review on public.ap_job_release_reviews(search_service_id,evaluation_id) where invalidated_at is null;

create table public.ap_search_package_reviews (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  search_service_id uuid not null references public.ap_search_services(id),
  selection_run_id uuid not null references public.ap_match_selection_runs(id),
  reviewer_id uuid not null references public.profiles(id),
  decision public.ap_staff_review_decision not null,
  evaluation_ids uuid[] not null check (cardinality(evaluation_ids) = 10),
  version_bundle jsonb not null check (jsonb_typeof(version_bundle) = 'object'),
  checklist jsonb not null check (jsonb_typeof(checklist) = 'object'),
  rationale text not null check (length(btrim(rationale)) >= 20),
  reviewed_at timestamptz not null default now(),
  invalidated_at timestamptz
);
create unique index ap_current_search_package_review on public.ap_search_package_reviews(search_service_id) where invalidated_at is null;

create table public.ap_operational_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  category text not null check (category in ('CAPACITY','WEBHOOK','DEADLINE','ADJUSTMENT','REFUND','OUTBOX','REVIEW','WORKER')),
  severity text not null check (severity in ('INFO','WARNING','CRITICAL')),
  reference_id uuid,
  state text not null default 'OPEN' check (state in ('OPEN','ACKNOWLEDGED','RESOLVED')),
  non_sensitive_details jsonb not null default '{}'::jsonb check (jsonb_typeof(non_sensitive_details) = 'object'),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);

create trigger ap_snapshot_legal_acceptances_immutable before update or delete on public.ap_snapshot_legal_acceptances for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_search_deadline_history_immutable before update or delete on public.ap_search_deadline_history for each row execute function public.ap_prevent_immutable_mutation();

create or replace function public.ap_guard_staff_review_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'invalidated_at') <> (to_jsonb(old) - 'invalidated_at')
    or old.invalidated_at is not null or new.invalidated_at is null then raise exception 'immutable_staff_review'; end if;
  return new;
end;
$$;
create trigger ap_job_release_reviews_guard before update or delete on public.ap_job_release_reviews for each row execute function public.ap_guard_staff_review_update();
create trigger ap_search_package_reviews_guard before update or delete on public.ap_search_package_reviews for each row execute function public.ap_guard_staff_review_update();

create or replace function public.ap_guard_external_command_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'external_command_delete_forbidden'; end if;
  if old.state <> new.state and not (
    (old.state='CREATING' and new.state in ('CREATED','COMPENSATING','FAILED')) or
    (old.state='CREATED' and new.state in ('APPLYING','COMPENSATING','FAILED')) or
    (old.state='APPLYING' and new.state in ('APPLIED','COMPENSATING','FAILED')) or
    (old.state='COMPENSATING' and new.state in ('COMPENSATED','FAILED'))
  ) then raise exception 'invalid_external_command_transition'; end if;
  if old.provider_idempotency_key <> new.provider_idempotency_key
    or old.immutable_input_sha256 <> new.immutable_input_sha256
    or old.provider <> new.provider
    or old.command_kind <> new.command_kind then raise exception 'immutable_external_command_identity'; end if;
  return new;
end;
$$;
create trigger ap_external_command_transition_guard before update or delete on public.ap_external_commands for each row execute function public.ap_guard_external_command_transition();

create or replace function public.ap_record_snapshot_legal_acceptance(
  p_draft_id uuid, p_secret_hash text, p_snapshot_id uuid, p_terms_version text,
  p_privacy_version text, p_acceptance_sha256 text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare configuration public.ap_commerce_configuration; acceptance_id uuid;
begin
  select * into configuration from public.ap_commerce_configuration where singleton;
  if not found or configuration.terms_version is null or configuration.privacy_version is null
    or p_terms_version <> configuration.terms_version or p_privacy_version <> configuration.privacy_version
    then raise exception 'current_legal_versions_unavailable'; end if;
  if p_acceptance_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid_legal_acceptance_hash'; end if;
  if not exists (
    select 1 from public.ap_anonymous_drafts d
    join public.ap_intake_snapshots s on s.id=p_snapshot_id and s.draft_id=d.id
    where d.id=p_draft_id and d.capability_secret_hash=p_secret_hash
      and d.finalized_snapshot_id=p_snapshot_id and d.state='COMPLETE' and d.expires_at>now()
  ) then raise exception 'draft_capability_invalid'; end if;
  insert into public.ap_snapshot_legal_acceptances(draft_id,snapshot_id,terms_version,privacy_version,acceptance_sha256)
  values(p_draft_id,p_snapshot_id,p_terms_version,p_privacy_version,p_acceptance_sha256)
  on conflict(snapshot_id) do nothing returning id into acceptance_id;
  if acceptance_id is null then
    select id into acceptance_id from public.ap_snapshot_legal_acceptances where snapshot_id=p_snapshot_id
      and draft_id=p_draft_id and terms_version=p_terms_version and privacy_version=p_privacy_version
      and acceptance_sha256=p_acceptance_sha256;
  end if;
  if acceptance_id is null then raise exception 'snapshot_legal_acceptance_conflict'; end if;
  return acceptance_id;
end;
$$;

-- Pool-row serialization makes the earliest eligible (ends_at, id) choice
-- deterministic under contention. Every HELD and SPENT unit is counted.
create or replace function public.ap_reserve_capacity(
  p_customer_id uuid, p_resource public.ap_capacity_resource, p_units integer, p_request_key text,
  p_expires_at timestamptz, p_members jsonb default '[]'::jsonb, p_draft_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare pool_row public.ap_capacity_pools; bucket_row public.ap_capacity_buckets; existing public.ap_capacity_allocations;
  new_allocation_id uuid; member jsonb;
begin
  if p_units < 1 or p_expires_at <= clock_timestamp()
    or jsonb_typeof(p_members) <> 'array' or (p_customer_id is null and p_draft_id is null)
    or nullif(btrim(p_request_key),'') is null then raise exception 'invalid_capacity_request'; end if;
  select * into existing from public.ap_capacity_allocations where request_key=p_request_key;
  if found then
    if existing.customer_id is distinct from p_customer_id or existing.draft_id is distinct from p_draft_id
      or existing.units<>p_units then raise exception 'capacity_idempotency_conflict'; end if;
    return existing.id;
  end if;
  select * into pool_row from public.ap_capacity_pools where resource=p_resource and enabled for update;
  if not found then raise exception 'capacity_unconfigured'; end if;
  select b.* into bucket_row from public.ap_capacity_buckets b
  where b.pool_id=pool_row.id and b.starts_at<=clock_timestamp() and b.ends_at>=p_expires_at
    and b.total_units - coalesce((select sum(a.units) from public.ap_capacity_allocations a
      where a.bucket_id=b.id and a.debit_disposition in ('HELD','SPENT')),0) >= p_units
  order by b.ends_at,b.id for update limit 1;
  if not found then raise exception 'capacity_unavailable'; end if;
  insert into public.ap_capacity_allocations(bucket_id,customer_id,draft_id,units,lifecycle,debit_disposition,
    request_key,staffing_version,reserved_at,expires_at,audit_version)
  values(bucket_row.id,p_customer_id,p_draft_id,p_units,'RESERVED','HELD',p_request_key,bucket_row.staffing_version,
    clock_timestamp(),p_expires_at,'chunk4-v1') returning id into new_allocation_id;
  for member in select value from jsonb_array_elements(p_members) loop
    insert into public.ap_capacity_allocation_members(allocation_id,material_line_id,revision_id,units)
    values(new_allocation_id,nullif(member->>'materialLineId','')::uuid,nullif(member->>'revisionId','')::uuid,
      coalesce((member->>'units')::integer,1));
  end loop;
  if (select coalesce(sum(units),0) from public.ap_capacity_allocation_members where allocation_id=new_allocation_id) not in (0,p_units)
    then raise exception 'capacity_member_units_mismatch'; end if;
  if p_resource='MATERIALS' and (jsonb_array_length(p_members)=0
    or exists(select 1 from public.ap_capacity_allocation_members where allocation_id=new_allocation_id and material_line_id is null)
    or (select coalesce(sum(units),0) from public.ap_capacity_allocation_members where allocation_id=new_allocation_id)<>p_units)
    then raise exception 'materials_capacity_requires_complete_line_members'; end if;
  insert into public.ap_capacity_audit(allocation_id,to_lifecycle,to_debit,reason_code)
    values(new_allocation_id,'RESERVED','HELD','RESERVED');
  return new_allocation_id;
end;
$$;

create or replace function public.ap_begin_search_checkout(
  p_draft_id uuid,
  p_secret_hash text,
  p_snapshot_id uuid,
  p_assessment_id uuid,
  p_request_key text,
  p_quote_id uuid,
  p_quote_sha256 text,
  p_command_id uuid,
  p_provider_idempotency_key text,
  p_checkout_attempt_id uuid,
  p_payment_attempt_id uuid,
  p_browser_secret_hash text,
  p_email_secret_hash text,
  p_access_payload_id uuid default null
)
returns table(
  quote_id uuid, command_id uuid, checkout_attempt_id uuid, payment_attempt_id uuid,
  allocation_id uuid, provider_idempotency_key text, lease_expires_at timestamptz,
  reservation_expires_at timestamptz, access_email text
) language plpgsql security definer set search_path = '' as $$
declare d public.ap_anonymous_drafts; assessment public.ap_feasibility_assessments;
  configuration public.ap_commerce_configuration; allocation_id_local uuid; now_at timestamptz:=clock_timestamp();
  lease_until timestamptz:=clock_timestamp()+interval '5 minutes';
  reservation_until timestamptz:=date_trunc('second',clock_timestamp())+interval '30 minutes 5 seconds';
  existing public.ap_quotes;
begin
  if p_quote_sha256 !~ '^[0-9a-f]{64}$' or p_browser_secret_hash !~ '^[0-9a-f]{64}$'
    or p_email_secret_hash !~ '^[0-9a-f]{64}$' or nullif(btrim(p_request_key),'') is null
    or nullif(btrim(p_provider_idempotency_key),'') is null then raise exception 'invalid_checkout_request'; end if;
  select * into d from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash
    and expires_at>now_at for update;
  if not found or d.state<>'COMPLETE' or d.finalized_snapshot_id<>p_snapshot_id then raise exception 'draft_capability_invalid'; end if;
  select * into assessment from public.ap_feasibility_assessments where id=p_assessment_id and snapshot_id=p_snapshot_id
    and state='COMPLETE' and outcome='LIKELY' and resolution_blocker='NONE' and invalidated_at is null
    and expires_at>now_at for update;
  if not found then raise exception 'current_likely_feasibility_required'; end if;
  if not exists(select 1 from public.ap_intake_snapshots where id=p_snapshot_id and draft_id=p_draft_id) then
    raise exception 'snapshot_not_current';
  end if;
  select * into configuration from public.ap_commerce_configuration where singleton for update;
  if not found or not configuration.checkout_enabled or configuration.pricing_version is null
    or configuration.tax_version is null or configuration.terms_version is null or configuration.privacy_version is null
    or configuration.canonical_site_url is null or configuration.access_callback_url is null
    or configuration.payment_provider is distinct from 'stripe' or configuration.payment_api_version is null
    or configuration.immediate_payment_methods is distinct from array['card']::text[]
    or not configuration.provider_idempotent_email_approved
    or configuration.provider_email_approval_reference is null
    then raise exception 'commerce_configuration_unset_blocking'; end if;
  if not exists(select 1 from public.ap_snapshot_legal_acceptances l where l.snapshot_id=p_snapshot_id and l.draft_id=p_draft_id
    and l.terms_version=configuration.terms_version and l.privacy_version=configuration.privacy_version)
    then raise exception 'current_legal_acceptance_required'; end if;
  if p_access_payload_id is null or not exists(select 1 from public.ap_sensitive_payloads where id=p_access_payload_id and draft_id=p_draft_id)
    then raise exception 'access_payload_subject_mismatch'; end if;

  select * into existing from public.ap_quotes where idempotency_key=p_request_key;
  if found then
    if existing.draft_id<>p_draft_id or existing.snapshot_id<>p_snapshot_id or existing.feasibility_assessment_id<>p_assessment_id
      or existing.content_sha256<>p_quote_sha256 then raise exception 'quote_idempotency_conflict'; end if;
    return query select q.id,c.id,x.id,p.id,q.capacity_allocation_id,c.provider_idempotency_key,c.lease_expires_at,
      q.expires_at,s.access_email_normalized
    from public.ap_quotes q join public.ap_checkout_attempts x on x.quote_id=q.id
    join public.ap_external_commands c on c.id=x.command_id
    join public.ap_payment_attempts p on p.checkout_attempt_id=x.id
    join public.ap_intake_snapshots s on s.id=q.snapshot_id where q.id=existing.id;
    return;
  end if;

  allocation_id_local:=public.ap_reserve_capacity(null,'SEARCH',1,'search-checkout:'||p_request_key,lease_until,'[]',p_draft_id);
  update public.ap_capacity_allocations set criteria_revision_id=p_snapshot_id where id=allocation_id_local;
  insert into public.ap_quotes(id,draft_id,snapshot_id,feasibility_assessment_id,capacity_allocation_id,price_cents,currency,
    tax_inclusive,pricing_version,tax_version,terms_version,privacy_version,idempotency_key,content_sha256,expires_at)
  values(p_quote_id,p_draft_id,p_snapshot_id,p_assessment_id,allocation_id_local,2000,'USD',true,
    configuration.pricing_version,configuration.tax_version,configuration.terms_version,configuration.privacy_version,
    p_request_key,p_quote_sha256,reservation_until);
  insert into public.ap_external_commands(id,draft_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,
    state,lease_expires_at,reconciliation_state)
  values(p_command_id,p_draft_id,'CREATE_SEARCH_CHECKOUT','stripe',p_quote_sha256,p_provider_idempotency_key,
    'CREATING',lease_until,'REQUIRED');
  insert into public.ap_checkout_attempts(id,draft_id,quote_id,command_id,capacity_allocation_id,state,
    browser_capability_secret_hash,email_capability_secret_hash,access_payload_id,expires_at)
  values(p_checkout_attempt_id,p_draft_id,p_quote_id,p_command_id,allocation_id_local,'NONE',p_browser_secret_hash,
    p_email_secret_hash,p_access_payload_id,lease_until);
  insert into public.ap_payment_attempts(id,draft_id,checkout_attempt_id,provider,amount_cents,currency,settlement)
  values(p_payment_attempt_id,p_draft_id,p_checkout_attempt_id,'stripe',2000,'USD','UNPAID');
  insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version)
  values('CHECKOUT_PROVISIONED','CHECKOUT_ATTEMPT',p_checkout_attempt_id,
    jsonb_build_object('quoteId',p_quote_id,'allocationId',allocation_id_local,'leaseSeconds',300),'chunk4-v1');
  return query select p_quote_id,p_command_id,p_checkout_attempt_id,p_payment_attempt_id,allocation_id_local,
    p_provider_idempotency_key,lease_until,reservation_until,
    (select s.access_email_normalized from public.ap_intake_snapshots s where s.id=p_snapshot_id);
end;
$$;

create or replace function public.ap_promote_search_checkout(
  p_checkout_attempt_id uuid,
  p_provider_session_id text,
  p_provider_session_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare checkout_row public.ap_checkout_attempts; command_row public.ap_external_commands; quote_row public.ap_quotes;
  allocation_row public.ap_capacity_allocations; now_at timestamptz:=clock_timestamp();
begin
  select * into checkout_row from public.ap_checkout_attempts where id=p_checkout_attempt_id for update;
  if not found then raise exception 'checkout_attempt_not_found'; end if;
  if checkout_row.state='OPEN' and checkout_row.provider_checkout_session_id=p_provider_session_id
    and checkout_row.expires_at=p_provider_session_expires_at then return true; end if;
  select * into command_row from public.ap_external_commands where id=checkout_row.command_id for update;
  select * into quote_row from public.ap_quotes where id=checkout_row.quote_id for update;
  select * into allocation_row from public.ap_capacity_allocations where id=checkout_row.capacity_allocation_id for update;
  if checkout_row.state<>'NONE' or command_row.state<>'CREATING' or command_row.lease_expires_at<=now_at
    or quote_row.invalidated_at is not null or quote_row.expires_at<p_provider_session_expires_at
    or allocation_row.lifecycle<>'RESERVED' or allocation_row.debit_disposition<>'HELD'
    or p_provider_session_expires_at<=now_at
    or p_provider_session_expires_at>now_at+interval '30 minutes 5 seconds'
    or nullif(btrim(p_provider_session_id),'') is null then raise exception 'checkout_promotion_invalid'; end if;
  update public.ap_external_commands set state='CREATED',provider_object_id=p_provider_session_id,updated_at=now_at where id=command_row.id;
  update public.ap_external_commands set state='APPLYING',updated_at=now_at where id=command_row.id;
  update public.ap_capacity_allocations set expires_at=p_provider_session_expires_at,updated_at=now_at where id=allocation_row.id;
  update public.ap_checkout_attempts set state='OPEN',provider_checkout_session_id=p_provider_session_id,
    expires_at=p_provider_session_expires_at,promoted_at=now_at,updated_at=now_at where id=checkout_row.id;
  update public.ap_external_commands set state='APPLIED',applied_at=now_at,reconciliation_state='RECONCILED',updated_at=now_at where id=command_row.id;
  update public.ap_anonymous_drafts set state='LOCKED_TO_CHECKOUT',checkout_attempt_id=checkout_row.id,version=version+1,updated_at=now_at
    where id=checkout_row.draft_id and state='COMPLETE';
  if not found then raise exception 'draft_checkout_lock_failed'; end if;
  insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version)
  values('CHECKOUT_OPENED','CHECKOUT_ATTEMPT',checkout_row.id,
    jsonb_build_object('allocationId',allocation_row.id,'expiresAt',p_provider_session_expires_at),'chunk4-v1');
  return true;
end;
$$;

create or replace function public.ap_reopen_provisional_search_checkout(
  p_checkout_attempt_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare checkout_row public.ap_checkout_attempts; command_row public.ap_external_commands;
  allocation_row public.ap_capacity_allocations; quote_row public.ap_quotes; now_at timestamptz:=clock_timestamp();
begin
  select * into checkout_row from public.ap_checkout_attempts where id=p_checkout_attempt_id for update;
  if not found or checkout_row.state<>'NONE' then return false; end if;
  select * into command_row from public.ap_external_commands where id=checkout_row.command_id for update;
  select * into allocation_row from public.ap_capacity_allocations where id=checkout_row.capacity_allocation_id for update;
  select * into quote_row from public.ap_quotes where id=checkout_row.quote_id for update;
  if command_row.state<>'CREATING' or command_row.reconciliation_state<>'REQUIRED'
    or allocation_row.lifecycle<>'RESERVED' or allocation_row.debit_disposition<>'HELD'
    or quote_row.invalidated_at is not null or quote_row.expires_at<=now_at then return false; end if;
  update public.ap_external_commands set lease_expires_at=now_at+interval '5 minutes',updated_at=now_at where id=command_row.id;
  update public.ap_capacity_allocations set expires_at=now_at+interval '5 minutes',updated_at=now_at where id=allocation_row.id;
  return true;
end;
$$;

create or replace function public.ap_compensate_search_checkout(
  p_checkout_attempt_id uuid, p_failure_code text, p_provider_session_id text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare checkout_row public.ap_checkout_attempts; command_row public.ap_external_commands; allocation_row public.ap_capacity_allocations;
  now_at timestamptz:=clock_timestamp();
begin
  select * into checkout_row from public.ap_checkout_attempts where id=p_checkout_attempt_id for update;
  if not found then return false; end if;
  if checkout_row.state='FAILED' then return true; end if;
  if checkout_row.state<>'NONE' then raise exception 'opened_checkout_requires_expiry_transition'; end if;
  select * into command_row from public.ap_external_commands where id=checkout_row.command_id for update;
  if nullif(btrim(p_provider_session_id),'') is null then
    update public.ap_external_commands set reconciliation_state='REQUIRED',failure_code=p_failure_code,
      lease_expires_at=least(lease_expires_at,now_at),updated_at=now_at
      where id=command_row.id and state='CREATING';
    return false;
  end if;
  if command_row.state in ('CREATING','CREATED','APPLYING') then
    update public.ap_external_commands set state='COMPENSATING',provider_object_id=coalesce(provider_object_id,p_provider_session_id),
      reconciliation_state='RECONCILED',
      failure_code=p_failure_code,updated_at=now_at where id=command_row.id;
  end if;
  select * into allocation_row from public.ap_capacity_allocations where id=checkout_row.capacity_allocation_id for update;
  if allocation_row.lifecycle='RESERVED' and allocation_row.debit_disposition='HELD' then
    update public.ap_capacity_allocations set lifecycle='RELEASED',debit_disposition='RETURNED',returned_at=now_at,updated_at=now_at where id=allocation_row.id;
    insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
      values(allocation_row.id,allocation_row.lifecycle,'RELEASED',allocation_row.debit_disposition,'RETURNED','CHECKOUT_COMPENSATED');
  end if;
  update public.ap_quotes set invalidated_at=coalesce(invalidated_at,now_at) where id=checkout_row.quote_id;
  update public.ap_checkout_attempts set provider_checkout_session_id=coalesce(provider_checkout_session_id,p_provider_session_id),
    invalidated_at=coalesce(invalidated_at,now_at),stale_reason=p_failure_code,updated_at=now_at
    where id=checkout_row.id;
  update public.ap_external_commands set state='COMPENSATED',compensated_at=now_at,updated_at=now_at
    where id=command_row.id and state='COMPENSATING';
  return true;
end;
$$;

create or replace function public.ap_expire_search_checkout(
  p_checkout_attempt_id uuid, p_reason text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare checkout_row public.ap_checkout_attempts; allocation_row public.ap_capacity_allocations;
  command_row public.ap_external_commands; now_at timestamptz:=clock_timestamp();
begin
  select * into checkout_row from public.ap_checkout_attempts where id=p_checkout_attempt_id for update;
  if not found then return false; end if;
  if checkout_row.state='NONE' then
    select * into allocation_row from public.ap_capacity_allocations where id=checkout_row.capacity_allocation_id for update;
    if allocation_row.lifecycle='RESERVED' and allocation_row.debit_disposition='HELD' then
      update public.ap_capacity_allocations set lifecycle='EXPIRED',debit_disposition='RETURNED',
        returned_at=now_at,updated_at=now_at where id=allocation_row.id;
      insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
      values(allocation_row.id,allocation_row.lifecycle,'EXPIRED',allocation_row.debit_disposition,'RETURNED',p_reason);
    end if;
    select * into command_row from public.ap_external_commands where id=checkout_row.command_id for update;
    update public.ap_external_commands set state='COMPENSATED',compensated_at=coalesce(compensated_at,now_at),
      reconciliation_state='RECONCILED',failure_code=p_reason,updated_at=now_at
      where id=command_row.id and state='CREATING';
    update public.ap_quotes set invalidated_at=coalesce(invalidated_at,now_at) where id=checkout_row.quote_id;
    update public.ap_checkout_attempts set invalidated_at=coalesce(invalidated_at,now_at),
      stale_reason=p_reason,updated_at=now_at where id=checkout_row.id;
    return true;
  end if;
  if checkout_row.state in ('EXPIRED','CANCELED','FAILED') then return true; end if;
  if checkout_row.state='COMPLETED' then return false; end if;
  select * into allocation_row from public.ap_capacity_allocations where id=checkout_row.capacity_allocation_id for update;
  if allocation_row.lifecycle='RESERVED' and allocation_row.debit_disposition='HELD' then
    update public.ap_capacity_allocations set lifecycle='EXPIRED',debit_disposition='RETURNED',returned_at=now_at,updated_at=now_at where id=allocation_row.id;
    insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
      values(allocation_row.id,allocation_row.lifecycle,'EXPIRED',allocation_row.debit_disposition,'RETURNED',p_reason);
  end if;
  update public.ap_checkout_attempts set state=case when p_reason='CUSTOMER_CANCELED' then 'CANCELED'::public.ap_checkout_state else 'EXPIRED'::public.ap_checkout_state end,
    stale_reason=p_reason,updated_at=now_at where id=checkout_row.id;
  update public.ap_quotes set invalidated_at=coalesce(invalidated_at,now_at) where id=checkout_row.quote_id;
  update public.ap_anonymous_drafts set state='COMPLETE',checkout_attempt_id=null,version=version+1,updated_at=now_at
    where id=checkout_row.draft_id and state='LOCKED_TO_CHECKOUT' and checkout_attempt_id=checkout_row.id;
  return true;
end;
$$;

create or replace function public.ap_cancel_search_checkout(
  p_checkout_attempt_id uuid, p_browser_secret_hash text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare checkout_row public.ap_checkout_attempts;
begin
  select * into checkout_row from public.ap_checkout_attempts
    where id=p_checkout_attempt_id and browser_capability_secret_hash=p_browser_secret_hash for update;
  if not found then raise exception 'checkout_status_unavailable'; end if;
  return public.ap_expire_search_checkout(checkout_row.id,'CUSTOMER_CANCELED');
end;
$$;

create or replace function public.ap_begin_pre_activation_edit(
  p_draft_id uuid,p_secret_hash text
) returns bigint language plpgsql security definer set search_path = '' as $$
declare draft_row public.ap_anonymous_drafts; checkout_row public.ap_checkout_attempts;
  allocation_row public.ap_capacity_allocations; now_at timestamptz:=clock_timestamp(); next_version bigint;
begin
  select * into draft_row from public.ap_anonymous_drafts
    where id=p_draft_id and capability_secret_hash=p_secret_hash and expires_at>now_at for update;
  if not found or draft_row.state not in ('COMPLETE','LOCKED_TO_CHECKOUT')
    then raise exception 'draft_capability_invalid'; end if;
  if draft_row.state='LOCKED_TO_CHECKOUT' then
    select * into checkout_row from public.ap_checkout_attempts
      where id=draft_row.checkout_attempt_id and draft_id=draft_row.id for update;
    if not found or checkout_row.state<>'OPEN' then raise exception 'open_checkout_binding_invalid'; end if;
    select * into allocation_row from public.ap_capacity_allocations
      where id=checkout_row.capacity_allocation_id for update;
    if allocation_row.lifecycle='RESERVED' and allocation_row.debit_disposition='HELD' then
      update public.ap_capacity_allocations set lifecycle='SUPERSEDED',debit_disposition='RETURNED',
        returned_at=now_at,updated_at=now_at where id=allocation_row.id;
      insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
      values(allocation_row.id,'RESERVED','SUPERSEDED','HELD','RETURNED','PRE_ACTIVATION_EDIT');
    end if;
    update public.ap_quotes set invalidated_at=coalesce(invalidated_at,now_at)
      where id=checkout_row.quote_id;
    update public.ap_checkout_attempts set invalidated_at=coalesce(invalidated_at,now_at),
      stale_reason='PRE_ACTIVATION_EDIT',updated_at=now_at where id=checkout_row.id;
    insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
    values('CHECKOUT_PROVIDER_EXPIRE',checkout_row.id,'checkout-provider-expire:'||checkout_row.id::text,now_at)
    on conflict(idempotency_key) do nothing;
    update public.ap_anonymous_drafts set state='COMPLETE',checkout_attempt_id=null,updated_at=now_at
      where id=draft_row.id;
  else
    update public.ap_feasibility_assessments set invalidated_at=coalesce(invalidated_at,now_at)
      where snapshot_id=draft_row.finalized_snapshot_id;
    update public.ap_quotes set invalidated_at=coalesce(invalidated_at,now_at)
      where snapshot_id=draft_row.finalized_snapshot_id;
  end if;
  update public.ap_match_evaluations set invalidated_at=coalesce(invalidated_at,now_at)
    where snapshot_id=draft_row.finalized_snapshot_id;
  update public.ap_human_review_records set invalidated_at=coalesce(invalidated_at,now_at)
    where snapshot_id=draft_row.finalized_snapshot_id;
  update public.ap_anonymous_drafts set state='IN_PROGRESS',version=version+1,updated_at=now_at
    where id=draft_row.id returning version into next_version;
  insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version)
  values('PRE_ACTIVATION_EDIT_BEGUN','ANONYMOUS_DRAFT',draft_row.id,
    jsonb_build_object('priorSnapshotId',draft_row.finalized_snapshot_id,'checkoutAttemptId',checkout_row.id),'chunk4-v1');
  return next_version;
end;
$$;

create or replace function public.ap_queue_search_refund(
  p_payment_attempt_id uuid,
  p_customer_id uuid,
  p_scope public.ap_refund_scope,
  p_reason_code text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare payment_row public.ap_payment_attempts; refund_id uuid; command_id uuid; operation_key text;
  command_key text; input_hash text; now_at timestamptz:=clock_timestamp();
begin
  select * into payment_row from public.ap_payment_attempts where id=p_payment_attempt_id for update;
  if not found or payment_row.customer_id is distinct from p_customer_id or payment_row.settlement<>'PAID'
    then raise exception 'verified_payment_required_for_refund'; end if;
  operation_key:='search-refund:'||p_payment_attempt_id::text||':'||p_reason_code;
  select id into refund_id from public.ap_refund_operations
    where payment_attempt_id=p_payment_attempt_id and scope=p_scope and superseded_at is null
    order by requested_at,id limit 1;
  if refund_id is not null then return refund_id; end if;
  select id into refund_id from public.ap_refund_operations where idempotency_key=operation_key and superseded_at is null;
  if refund_id is not null then return refund_id; end if;
  refund_id:=gen_random_uuid(); command_id:=gen_random_uuid(); command_key:='stripe:'||operation_key;
  input_hash:=encode(extensions.digest(convert_to(operation_key||':2000:USD','UTF8'),'sha256'),'hex');
  insert into public.ap_external_commands(id,customer_id,draft_id,command_kind,provider,immutable_input_sha256,
    provider_idempotency_key,state,lease_expires_at,reconciliation_state)
  values(command_id,p_customer_id,payment_row.draft_id,'CREATE_FULL_REFUND','stripe',input_hash,command_key,
    'CREATING',now_at+interval '5 minutes','REQUIRED');
  insert into public.ap_refund_operations(id,customer_id,payment_attempt_id,scope,amount_cents,currency,
    idempotency_key,provider_command_id,state,required,reason_code,requested_at)
  values(refund_id,p_customer_id,p_payment_attempt_id,p_scope,2000,'USD',operation_key,command_id,'PENDING',true,
    p_reason_code,now_at);
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('REFUND_SUBMIT',refund_id,'refund-submit:'||refund_id::text,now_at)
  on conflict(idempotency_key) do nothing;
  declare
    refund_outbox_id uuid:=gen_random_uuid();
    refund_order_id uuid;
  begin
    select legacy_order_id into refund_order_id from public.ap_search_services
      where winning_payment_attempt_id=p_payment_attempt_id;
    insert into public.ap_outbox_messages(id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,
      provider_idempotency_key,state,next_attempt_at)
    values(refund_outbox_id,p_customer_id,refund_order_id,'REFUND_INITIATED',p_payment_attempt_id::text,
      'refund-initiated:'||refund_id::text,refund_outbox_id::text,'QUEUED',now_at)
    on conflict(deduplication_key) do nothing;
  end;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'REFUND_REQUIRED','REFUND_OPERATION',refund_id,jsonb_build_object(
    'reasonCode',p_reason_code,'scope',p_scope::text,'amountCents',2000),'chunk4-v1');
  return refund_id;
end;
$$;

create or replace function public.ap_queue_material_line_refund(
  p_payment_attempt_id uuid,
  p_customer_id uuid,
  p_material_line_id uuid,
  p_reason_code text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare payment_row public.ap_payment_attempts; line_row public.ap_material_lines;
  purchase_row public.ap_material_purchases; refund_id uuid; command_id uuid;
  operation_key text; command_key text; input_hash text; now_at timestamptz:=clock_timestamp();
  refund_outbox_id uuid:=gen_random_uuid();
begin
  select * into payment_row from public.ap_payment_attempts where id=p_payment_attempt_id for update;
  select * into line_row from public.ap_material_lines
    where id=p_material_line_id and payment_attempt_id=p_payment_attempt_id for update;
  if not found then raise exception 'material_line_payment_binding_missing'; end if;
  select * into purchase_row from public.ap_material_purchases
    where id=line_row.purchase_id and payment_attempt_id=p_payment_attempt_id for update;
  if payment_row.id is null or purchase_row.id is null
    or payment_row.customer_id is distinct from p_customer_id
    or purchase_row.customer_id is distinct from p_customer_id
    or payment_row.settlement<>'PAID' then raise exception 'verified_material_payment_required_for_refund'; end if;
  select id into refund_id from public.ap_refund_operations
    where payment_attempt_id=p_payment_attempt_id and scope='MATERIAL_LINE'
      and material_line_id=p_material_line_id and superseded_at is null;
  if refund_id is not null then return refund_id; end if;
  operation_key:='material-line-refund:'||p_material_line_id::text;
  refund_id:=gen_random_uuid(); command_id:=gen_random_uuid(); command_key:='stripe:'||operation_key;
  input_hash:=encode(extensions.digest(convert_to(operation_key||':'||line_row.allocated_amount_cents::text||':USD','UTF8'),'sha256'),'hex');
  insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,
    provider_idempotency_key,state,lease_expires_at,reconciliation_state)
  values(command_id,p_customer_id,'CREATE_MATERIAL_LINE_REFUND','stripe',input_hash,command_key,
    'CREATING',now_at+interval '5 minutes','REQUIRED');
  insert into public.ap_refund_operations(id,customer_id,payment_attempt_id,material_line_id,scope,
    amount_cents,currency,idempotency_key,provider_command_id,state,required,reason_code,requested_at)
  values(refund_id,p_customer_id,p_payment_attempt_id,p_material_line_id,'MATERIAL_LINE',
    line_row.allocated_amount_cents,'USD',operation_key,command_id,'PENDING',true,p_reason_code,now_at);
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('REFUND_SUBMIT',refund_id,'refund-submit:'||refund_id::text,now_at)
  on conflict(idempotency_key) do nothing;
  insert into public.ap_outbox_messages(id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,
    provider_idempotency_key,state,next_attempt_at)
  values(refund_outbox_id,p_customer_id,line_row.delivered_order_id,'REFUND_INITIATED',p_payment_attempt_id::text,
    'refund-initiated:'||refund_id::text,refund_outbox_id::text,'QUEUED',now_at)
  on conflict(deduplication_key) do nothing;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'REFUND_REQUIRED','REFUND_OPERATION',refund_id,jsonb_build_object(
    'reasonCode',p_reason_code,'scope','MATERIAL_LINE','materialLineId',p_material_line_id,
    'amountCents',line_row.allocated_amount_cents),'chunk4-v1');
  return refund_id;
end;
$$;

create or replace function public.ap_apply_verified_search_payment(
  p_provider_event_id text,
  p_event_type text,
  p_payload_sha256 text,
  p_signature_verified_at timestamptz,
  p_payment_succeeded_at timestamptz,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_payment_status text,
  p_payment_method_type text,
  p_amount_cents integer,
  p_currency text,
  p_payer_receipt_email text,
  p_customer_id uuid,
  p_intake_id uuid,
  p_order_id uuid,
  p_search_service_id uuid,
  p_payment_command_id uuid,
  p_rotated_draft_secret_hash text,
  p_immediate_access_capability_id uuid,
  p_email_access_capability_id uuid,
  p_started_outbox_id uuid,
  p_exception_outbox_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare provider_event public.ap_provider_events; checkout_row public.ap_checkout_attempts;
  payment_row public.ap_payment_attempts; quote_row public.ap_quotes; snapshot_row public.ap_intake_snapshots;
  allocation_row public.ap_capacity_allocations; winner public.ap_search_services; active_allocation_id uuid;
  refund_id uuid; now_at timestamptz:=clock_timestamp(); started_at timestamptz; due_at timestamptz;
  resume_path text; payment_hash text; result_value jsonb; reacquired uuid; outbox_key text;
begin
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' or p_rotated_draft_secret_hash !~ '^[0-9a-f]{64}$'
    or p_signature_verified_at is null
    or nullif(btrim(p_provider_event_id),'') is null or nullif(btrim(p_checkout_session_id),'') is null
    or nullif(btrim(p_payment_intent_id),'') is null then raise exception 'invalid_verified_payment_input'; end if;
  insert into public.ap_provider_events(provider,provider_event_id,event_type,payload_sha256,signature_verified_at)
  values('stripe',p_provider_event_id,p_event_type,p_payload_sha256,p_signature_verified_at)
  on conflict(provider_event_id) do nothing;
  if not found then
    select * into provider_event from public.ap_provider_events where provider_event_id=p_provider_event_id for update;
    if provider_event.payload_sha256<>p_payload_sha256 or provider_event.event_type<>p_event_type
      then raise exception 'provider_event_identity_conflict'; end if;
    if provider_event.applied_at is not null then return provider_event.result||jsonb_build_object('replayed',true); end if;
    if provider_event.failure_code is not null then return provider_event.result||jsonb_build_object('replayed',true); end if;
    raise exception 'provider_event_in_progress';
  end if;
  select * into checkout_row from public.ap_checkout_attempts
    where provider_checkout_session_id=p_checkout_session_id for update;
  if not found then raise exception 'checkout_attempt_not_found'; end if;
  select * into payment_row from public.ap_payment_attempts where checkout_attempt_id=checkout_row.id for update;
  select * into quote_row from public.ap_quotes where id=checkout_row.quote_id for update;
  select * into snapshot_row from public.ap_intake_snapshots where id=quote_row.snapshot_id;
  if not found or payment_row.id is null or snapshot_row.id is null then raise exception 'checkout_binding_incomplete'; end if;

  if p_payment_status<>'succeeded' or p_payment_method_type<>'card'
    or p_amount_cents<>2000 or upper(p_currency)<>'USD' then
    update public.ap_payment_attempts set settlement=case when p_payment_status in ('processing','requires_action')
      then 'PROCESSING'::public.ap_payment_settlement else 'FAILED'::public.ap_payment_settlement end,
      provider_checkout_session_id=p_checkout_session_id,provider_payment_status=p_payment_status,
      payment_method_type=p_payment_method_type,updated_at=now_at where id=payment_row.id;
    result_value:=jsonb_build_object('outcome','UNSETTLED_OR_UNSUPPORTED','searchActive',false);
    update public.ap_provider_events set applied_at=now_at,result=result_value where provider_event_id=p_provider_event_id;
    return result_value;
  end if;
  if p_payment_succeeded_at is null or nullif(btrim(p_payment_intent_id),'') is null then
    raise exception 'settled_payment_evidence_incomplete';
  end if;
  if not exists(select 1 from public.profiles where id=p_customer_id and lower(email)=snapshot_row.access_email_normalized)
    then raise exception 'access_identity_mismatch'; end if;
  if payment_row.settlement='PAID' and payment_row.provider_payment_id=p_payment_intent_id then
    select * into winner from public.ap_search_services where winning_payment_attempt_id=payment_row.id;
    result_value:=jsonb_build_object('outcome',case when winner.id is null then 'PAID_REFUND_PENDING' else 'SEARCH_ACTIVE' end,
      'searchActive',winner.id is not null,'orderId',winner.legacy_order_id,'serviceId',winner.id);
    update public.ap_provider_events set applied_at=now_at,result=result_value where provider_event_id=p_provider_event_id;
    return result_value;
  end if;

  payment_hash:=encode(extensions.digest(convert_to(p_checkout_session_id||':'||p_payment_intent_id||':'||p_payload_sha256,'UTF8'),'sha256'),'hex');
  insert into public.ap_external_commands(id,customer_id,draft_id,command_kind,provider,immutable_input_sha256,
    provider_idempotency_key,state,lease_expires_at,reconciliation_state)
  values(p_payment_command_id,p_customer_id,payment_row.draft_id,'APPLY_VERIFIED_CHARGE','stripe',payment_hash,
    'stripe:apply-payment:'||p_payment_intent_id,'CREATING',now_at+interval '5 minutes','REQUIRED')
  on conflict(provider_idempotency_key) do nothing;
  update public.ap_external_commands set state='CREATED',provider_object_id=p_payment_intent_id,updated_at=now_at
    where provider_idempotency_key='stripe:apply-payment:'||p_payment_intent_id and state='CREATING';
  update public.ap_external_commands set state='APPLYING',updated_at=now_at
    where provider_idempotency_key='stripe:apply-payment:'||p_payment_intent_id and state='CREATED';
  select id into p_payment_command_id from public.ap_external_commands
    where provider_idempotency_key='stripe:apply-payment:'||p_payment_intent_id and immutable_input_sha256=payment_hash for update;
  if p_payment_command_id is null then raise exception 'payment_command_idempotency_conflict'; end if;
  update public.ap_payment_attempts set customer_id=p_customer_id,provider_checkout_session_id=p_checkout_session_id,
    provider_payment_id=p_payment_intent_id,provider_event_id=p_provider_event_id,payer_receipt_email=nullif(lower(btrim(p_payer_receipt_email)),''),
    provider_payment_status=p_payment_status,payment_method_type=p_payment_method_type,immediate_charge_verified=true,
    payment_command_id=p_payment_command_id,settlement='PAID',payment_verified_at=p_payment_succeeded_at,updated_at=now_at
    where id=payment_row.id and settlement in ('UNPAID','PROCESSING');
  if not found then raise exception 'payment_attempt_transition_conflict'; end if;
  select * into payment_row from public.ap_payment_attempts where id=payment_row.id;

  select * into winner from public.ap_search_services
    where search_activated_at is not null and (quote_id=quote_row.id or original_snapshot_id=snapshot_row.id) for update;
  if winner.id is not null then
    select * into allocation_row from public.ap_capacity_allocations
      where id=checkout_row.capacity_allocation_id for update;
    if allocation_row.lifecycle='RESERVED' and allocation_row.debit_disposition='HELD' then
      update public.ap_capacity_allocations set lifecycle='RELEASED',debit_disposition='RETURNED',
        returned_at=now_at,updated_at=now_at where id=allocation_row.id;
      insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
      values(allocation_row.id,allocation_row.lifecycle,'RELEASED',allocation_row.debit_disposition,'RETURNED',
        'DUPLICATE_PAID_ATTEMPT');
    end if;
    update public.ap_checkout_attempts set state=case when state='OPEN' then 'COMPLETED'::public.ap_checkout_state else state end,
      invalidated_at=coalesce(invalidated_at,now_at),
      stale_reason='DUPLICATE_PAID_ATTEMPT',updated_at=now_at where id=checkout_row.id;
    refund_id:=public.ap_queue_search_refund(payment_row.id,p_customer_id,'DUPLICATE_ATTEMPT','DUPLICATE_PAID_ATTEMPT');
    outbox_key:='capacity-refund:'||payment_row.id::text;
    insert into public.ap_outbox_messages(id,customer_id,message_kind,recipient_ref,payload_ref,deduplication_key,
      provider_idempotency_key,state,next_attempt_at)
    values(p_exception_outbox_id,p_customer_id,'DUPLICATE_PAYMENT_REFUND',snapshot_row.id::text,null,outbox_key,
      p_exception_outbox_id::text,'QUEUED',now_at) on conflict(deduplication_key) do nothing;
    result_value:=jsonb_build_object('outcome','DUPLICATE_REFUND_PENDING','searchActive',false,'refundId',refund_id,
      'winningOrderId',winner.legacy_order_id);
    update public.ap_external_commands set state='APPLIED',applied_at=now_at,reconciliation_state='RECONCILED',updated_at=now_at where id=p_payment_command_id and state='APPLYING';
    update public.ap_provider_events set applied_at=now_at,result=result_value where provider_event_id=p_provider_event_id;
    return result_value;
  end if;

  if quote_row.invalidated_at is not null
    or checkout_row.invalidated_at is not null
    or checkout_row.state in ('CANCELED','FAILED')
    or not exists(select 1 from public.ap_anonymous_drafts where id=checkout_row.draft_id and finalized_snapshot_id=snapshot_row.id)
  then
    select * into allocation_row from public.ap_capacity_allocations
      where id=checkout_row.capacity_allocation_id for update;
    if allocation_row.lifecycle='RESERVED' and allocation_row.debit_disposition='HELD' then
      update public.ap_capacity_allocations set lifecycle='RELEASED',debit_disposition='RETURNED',
        returned_at=now_at,updated_at=now_at where id=allocation_row.id;
      insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
      values(allocation_row.id,allocation_row.lifecycle,'RELEASED',allocation_row.debit_disposition,'RETURNED',
        'STALE_CHECKOUT_PAID');
    end if;
    update public.ap_checkout_attempts set state=case when state='OPEN' then 'COMPLETED'::public.ap_checkout_state else state end,
      invalidated_at=coalesce(invalidated_at,now_at),
      stale_reason='STALE_CHECKOUT_PAID',updated_at=now_at where id=checkout_row.id;
    refund_id:=public.ap_queue_search_refund(payment_row.id,p_customer_id,'STALE_ATTEMPT','STALE_CHECKOUT_PAID');
    insert into public.ap_outbox_messages(id,customer_id,message_kind,recipient_ref,payload_ref,deduplication_key,
      provider_idempotency_key,state,next_attempt_at)
    values(p_exception_outbox_id,p_customer_id,'STALE_PAYMENT_REFUND',snapshot_row.id::text,null,
      'capacity-refund:'||payment_row.id::text,p_exception_outbox_id::text,'QUEUED',now_at)
    on conflict(deduplication_key) do nothing;
    update public.ap_anonymous_drafts set checkout_attempt_id=null,updated_at=now_at
      where id=checkout_row.draft_id and checkout_attempt_id=checkout_row.id;
    result_value:=jsonb_build_object('outcome','STALE_REFUND_PENDING','searchActive',false,'refundId',refund_id);
    update public.ap_external_commands set state='APPLIED',applied_at=now_at,reconciliation_state='RECONCILED',updated_at=now_at where id=p_payment_command_id and state='APPLYING';
    update public.ap_provider_events set applied_at=now_at,result=result_value where provider_event_id=p_provider_event_id;
    return result_value;
  end if;

  select * into allocation_row from public.ap_capacity_allocations where id=checkout_row.capacity_allocation_id for update;
  if allocation_row.lifecycle='RESERVED' and allocation_row.debit_disposition='HELD' and allocation_row.expires_at>=now_at then
    active_allocation_id:=allocation_row.id;
  else
    if checkout_row.reacquisition_attempted_at is not null then raise exception 'capacity_reacquisition_already_attempted'; end if;
    update public.ap_checkout_attempts set reacquisition_attempted_at=now_at,updated_at=now_at where id=checkout_row.id;
    if allocation_row.lifecycle='RESERVED' and allocation_row.debit_disposition='HELD' then
      update public.ap_capacity_allocations set lifecycle='EXPIRED',debit_disposition='RETURNED',returned_at=now_at,updated_at=now_at where id=allocation_row.id;
      insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
      values(allocation_row.id,allocation_row.lifecycle,'EXPIRED',allocation_row.debit_disposition,'RETURNED','PAYMENT_AFTER_RESERVATION_EXPIRY');
    end if;
    begin
      reacquired:=public.ap_reserve_capacity(p_customer_id,'SEARCH',1,'search-reacquire:'||checkout_row.id::text,
        now_at+interval '5 minutes','[]',null);
    exception when others then
      reacquired:=null;
    end;
    if reacquired is null then
      update public.ap_checkout_attempts set capacity_exception_at=now_at,capacity_exception_reason='REACQUISITION_UNAVAILABLE',
        state='COMPLETED',updated_at=now_at where id=checkout_row.id;
      refund_id:=public.ap_queue_search_refund(payment_row.id,p_customer_id,'FULL_SEARCH','CAPACITY_EXCEPTION');
      insert into public.ap_outbox_messages(id,customer_id,message_kind,recipient_ref,payload_ref,deduplication_key,
        provider_idempotency_key,state,next_attempt_at)
      values(p_exception_outbox_id,p_customer_id,'CAPACITY_EXCEPTION_REFUND',snapshot_row.id::text,null,
        'capacity-refund:'||payment_row.id::text,p_exception_outbox_id::text,'QUEUED',now_at)
      on conflict(deduplication_key) do nothing;
      update public.ap_anonymous_drafts set capability_secret_hash=p_rotated_draft_secret_hash,capability_version=capability_version+1,
        capability_rotated_at=now_at,state='EXPIRED',checkout_attempt_id=null,updated_at=now_at where id=checkout_row.draft_id;
      result_value:=jsonb_build_object('outcome','CAPACITY_EXCEPTION','searchActive',false,'refundId',refund_id);
      update public.ap_external_commands set state='APPLIED',applied_at=now_at,reconciliation_state='RECONCILED',updated_at=now_at where id=p_payment_command_id and state='APPLYING';
      update public.ap_provider_events set applied_at=now_at,result=result_value where provider_event_id=p_provider_event_id;
      return result_value;
    end if;
    update public.ap_capacity_allocations set criteria_revision_id=snapshot_row.id where id=reacquired;
    update public.ap_checkout_attempts set reacquired_capacity_allocation_id=reacquired,updated_at=now_at where id=checkout_row.id;
    active_allocation_id:=reacquired;
  end if;

  select storage_path into resume_path from public.ap_document_versions where draft_id=checkout_row.draft_id
    and kind='RESUME' and is_current and processing_state='READY' order by version desc limit 1;
  if resume_path is null then raise exception 'activation_resume_missing'; end if;
  -- The customer promise starts only after all three independently recorded
  -- gates are complete: intake, the provider's successful charge, and the
  -- database-confirmed capacity consumption performed in this transaction.
  started_at:=greatest(snapshot_row.finalized_at,p_payment_succeeded_at,now_at);
  due_at:=started_at+interval '24 hours';
  insert into public.intakes(id,customer_id,email,direction,priorities,dealbreakers,location_preference,schedule_preference,
    minimum_salary,experience_summary,resume_path,status,criteria_version,criteria_approved_at,source_scan_status,source_scanned_at)
  values(p_intake_id,p_customer_id,snapshot_row.access_email_normalized,'Immutable corrected intake '||snapshot_row.id::text,
    snapshot_row.desired_activities,coalesce(snapshot_row.dealbreakers::text,'[]'),
    coalesce(snapshot_row.us_state_or_dc,'See immutable criteria'),coalesce(snapshot_row.schedules::text,'[]'),
    snapshot_row.salary_hard_minimum_cents::text,'See immutable candidate facts',resume_path,'paid',snapshot_row.version,
    snapshot_row.finalized_at,'clean',snapshot_row.finalized_at);
  insert into public.orders(id,customer_id,intake_id,product_kind,amount_cents,status,stripe_checkout_session_id,
    stripe_payment_intent_id,paid_at,delivery_deadline,checkout_expires_at)
  values(p_order_id,p_customer_id,p_intake_id,'job_search',2000,'paid',p_checkout_session_id,p_payment_intent_id,
    p_payment_succeeded_at,due_at,checkout_row.expires_at);
  update public.ap_capacity_allocations set customer_id=p_customer_id,order_id=p_order_id,lifecycle='CONSUMED',
    debit_disposition='SPENT',consumed_at=now_at,expires_at=null,updated_at=now_at where id=active_allocation_id;
  insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
  values(active_allocation_id,'RESERVED','CONSUMED','HELD','SPENT','SEARCH_ACTIVATED');
  insert into public.ap_search_services(id,legacy_order_id,customer_id,quote_id,winning_payment_attempt_id,
    original_snapshot_id,active_snapshot_id,capacity_allocation_id,fulfillment,adjustment,intake_completed_at,
    capacity_confirmed_at,service_started_at,delivery_due_at,search_activated_at,version_bundle)
  values(p_search_service_id,p_order_id,p_customer_id,quote_row.id,payment_row.id,snapshot_row.id,snapshot_row.id,
    active_allocation_id,'RESEARCHING','NONE',snapshot_row.finalized_at,now_at,started_at,due_at,now_at,
    jsonb_build_object('pricingVersion',quote_row.pricing_version,'taxVersion',quote_row.tax_version,
      'termsVersion',quote_row.terms_version,'privacyVersion',quote_row.privacy_version,'paymentEventId',p_provider_event_id,
      'paymentSucceededAt',p_payment_succeeded_at,'signatureVerifiedAt',p_signature_verified_at));
  insert into public.ap_search_deadline_history(search_service_id,revision,reason,started_at,due_at,
    capacity_allocation_id,criteria_snapshot_id)
  values(p_search_service_id,1,'INITIAL_ACTIVATION',started_at,due_at,active_allocation_id,snapshot_row.id);
  insert into public.ap_order_access_capabilities(id,checkout_attempt_id,order_id,customer_id,kind,secret_hash,state,created_at,issued_at,expires_at)
  values(p_immediate_access_capability_id,checkout_row.id,p_order_id,p_customer_id,'IMMEDIATE_ORDER',
    checkout_row.browser_capability_secret_hash,'ISSUED',now_at,now_at,now_at+interval '15 minutes'),
    (p_email_access_capability_id,checkout_row.id,p_order_id,p_customer_id,'EMAIL_ACCESS',
    checkout_row.email_capability_secret_hash,'ISSUED',now_at,now_at,now_at+interval '15 minutes');
  update public.ap_checkout_attempts set customer_id=p_customer_id,state='COMPLETED',updated_at=now_at where id=checkout_row.id;
  update public.ap_anonymous_drafts set capability_secret_hash=p_rotated_draft_secret_hash,capability_version=capability_version+1,
    capability_rotated_at=now_at,state='CONVERTED',converted_customer_id=p_customer_id,converted_intake_id=p_intake_id,
    checkout_attempt_id=null,version=version+1,updated_at=now_at where id=checkout_row.draft_id;
  insert into public.ap_outbox_messages(id,customer_id,order_id,message_kind,recipient_ref,payload_ref,deduplication_key,
    provider_idempotency_key,state,next_attempt_at)
  values(p_started_outbox_id,p_customer_id,p_order_id,'PAYMENT_VERIFIED_SEARCH_STARTED',snapshot_row.id::text,
    checkout_row.access_payload_id,'search-started:'||p_order_id::text,p_started_outbox_id::text,'QUEUED',now_at);
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('SEARCH_DEADLINE',p_search_service_id,'search-deadline:'||p_search_service_id::text||':1',due_at),
    ('OUTBOX_SEND',p_started_outbox_id,'outbox-send:'||p_started_outbox_id::text,now_at)
  on conflict(idempotency_key) do nothing;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'SEARCH_ACTIVATED','SEARCH_SERVICE',p_search_service_id,jsonb_build_object(
    'orderId',p_order_id,'allocationId',active_allocation_id,'deadlineRevision',1,'dueAt',due_at),'chunk4-v1');
  result_value:=jsonb_build_object('outcome','SEARCH_ACTIVE','searchActive',true,'orderId',p_order_id,
    'serviceId',p_search_service_id,'deliveryDueAt',due_at);
  update public.ap_external_commands set state='APPLIED',applied_at=now_at,reconciliation_state='RECONCILED',updated_at=now_at
    where id=p_payment_command_id and state='APPLYING';
  update public.ap_provider_events set applied_at=now_at,result=result_value where provider_event_id=p_provider_event_id;
  return result_value;
end;
$$;

create or replace function public.ap_read_current_feasibility(
  p_draft_id uuid, p_secret_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.ap_anonymous_drafts; request_row public.ap_feasibility_requests;
  assessment public.ap_feasibility_assessments; configuration public.ap_commerce_configuration;
  capacity_ready boolean:=false; checkout_ready boolean:=false; effective_state text; now_at timestamptz:=clock_timestamp();
begin
  select * into d from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash
    and expires_at>now_at;
  if not found then raise exception 'draft_capability_invalid'; end if;
  if d.finalized_snapshot_id is null then
    return jsonb_build_object('state','PENDING','outcome',null,'checkoutEligible',false,'reasons','[]'::jsonb);
  end if;
  select * into request_row from public.ap_feasibility_requests where snapshot_id=d.finalized_snapshot_id
    order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('state','PENDING','outcome',null,'checkoutEligible',false,'reasons','[]'::jsonb);
  end if;
  if request_row.state='COMPLETED' then
    select * into assessment from public.ap_feasibility_assessments where id=request_row.completed_assessment_id;
    effective_state:=case when assessment.invalidated_at is not null or assessment.expires_at<=now_at then 'STALE' else assessment.state::text end;
  elsif request_row.state in ('STALE','ERROR') then effective_state:=request_row.state;
  else effective_state:='PENDING';
  end if;
  select exists(
    select 1 from public.ap_capacity_pools p join public.ap_capacity_buckets b on b.pool_id=p.id
    where p.resource='SEARCH' and p.enabled and b.starts_at<=now_at and b.ends_at>=now_at+interval '30 minutes'
      and public.ap_capacity_available(b.id)>=1
  ) into capacity_ready;
  select * into configuration from public.ap_commerce_configuration where singleton;
  checkout_ready:=effective_state='COMPLETE' and assessment.outcome='LIKELY' and assessment.resolution_blocker='NONE'
    and capacity_ready and configuration.checkout_enabled and configuration.pricing_version is not null
    and configuration.tax_version is not null and configuration.terms_version is not null and configuration.privacy_version is not null
    and configuration.canonical_site_url is not null and configuration.access_callback_url is not null
    and configuration.payment_provider='stripe' and configuration.payment_api_version is not null
    and configuration.immediate_payment_methods=array['card']::text[]
    and configuration.provider_idempotent_email_approved
    and exists(select 1 from public.ap_snapshot_legal_acceptances l where l.snapshot_id=d.finalized_snapshot_id
      and l.terms_version=configuration.terms_version and l.privacy_version=configuration.privacy_version);
  return jsonb_build_object(
    'state',effective_state,
    'outcome',case when effective_state='COMPLETE' then assessment.outcome::text else null end,
    'assessmentId',case when effective_state='COMPLETE' then assessment.id else null end,
    'snapshotId',d.finalized_snapshot_id,
    'checkoutEligible',checkout_ready,
    'capacityAvailable',capacity_ready,
    'reasons',case when effective_state='COMPLETE' then to_jsonb(assessment.reasons) else '[]'::jsonb end,
    'primaryReason',case when effective_state='COMPLETE' then assessment.primary_reason::text else request_row.error_code end,
    'preliminarilyDeliverableCount',case when effective_state='COMPLETE' then assessment.preliminarily_deliverable_count else null end,
    'reviewableCount',case when effective_state='COMPLETE' then assessment.reviewable_count else null end
  );
end;
$$;

create or replace function public.ap_find_customer_by_access_email(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select profile.id from public.profiles profile
  where lower(profile.email)=lower(btrim(p_email))
  order by profile.created_at,profile.id limit 1
$$;

create or replace function public.ap_find_latest_access_order(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select service.legacy_order_id from public.ap_search_services service
  join public.ap_intake_snapshots snapshot on snapshot.id=service.original_snapshot_id
  where snapshot.access_email_normalized=lower(btrim(p_email))
    and service.refund_started_at is null
  order by service.search_activated_at desc,service.id limit 1
$$;

create or replace function public.ap_read_checkout_status(
  p_checkout_attempt_id uuid, p_browser_secret_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare checkout_row public.ap_checkout_attempts; payment_row public.ap_payment_attempts;
  service_row public.ap_search_services; refund_aggregate record; capability public.ap_order_access_capabilities;
begin
  select * into checkout_row from public.ap_checkout_attempts
    where id=p_checkout_attempt_id and browser_capability_secret_hash=p_browser_secret_hash;
  if not found then raise exception 'checkout_status_unavailable'; end if;
  select * into payment_row from public.ap_payment_attempts where checkout_attempt_id=checkout_row.id;
  if payment_row.settlement='PAID' then
    select * into service_row from public.ap_search_services where winning_payment_attempt_id=payment_row.id;
    select * into refund_aggregate from public.ap_payment_refund_aggregates where payment_attempt_id=payment_row.id;
  end if;
  if service_row.id is not null then
    select * into capability from public.ap_order_access_capabilities where checkout_attempt_id=checkout_row.id
      and kind='IMMEDIATE_ORDER' and secret_hash=p_browser_secret_hash and state='ISSUED' and expires_at>clock_timestamp();
    if not found then raise exception 'checkout_status_capability_expired'; end if;
    return jsonb_build_object('state',case
      when service_row.fulfillment='DELIVERED' then 'DELIVERED'
      when service_row.adjustment='PROPOSED' then 'ADJUSTMENT_REQUIRED'
      when service_row.refund_started_at is not null and refund_aggregate.refund_aggregate='FULL' then 'REFUNDED'
      when service_row.refund_started_at is not null and refund_aggregate.refund_aggregate='FAILED' then 'REFUND_PROBLEM'
      when service_row.refund_started_at is not null then 'REFUND_PROCESSING'
      else 'SEARCH_ACTIVE' end,
      'searchActive',true,'orderId',service_row.legacy_order_id,'fulfillment',service_row.fulfillment::text,
      'deliveryDueAt',service_row.delivery_due_at,'refundState',refund_aggregate.refund_aggregate);
  end if;
  return jsonb_build_object('state',case
    when checkout_row.capacity_exception_at is not null then 'CAPACITY_EXCEPTION'
    when payment_row.settlement='PAID' then 'REFUND_PROCESSING'
    when checkout_row.state in ('EXPIRED','CANCELED','FAILED') then checkout_row.state::text
    else 'CONFIRMING_PAYMENT' end,'searchActive',false);
end;
$$;

create or replace function public.ap_consume_order_access(
  p_capability_id uuid, p_secret_hash text
) returns table(order_id uuid, customer_id uuid, access_email text)
language plpgsql security definer set search_path = '' as $$
declare capability public.ap_order_access_capabilities; snapshot_email text;
begin
  select * into capability from public.ap_order_access_capabilities where id=p_capability_id and kind='EMAIL_ACCESS'
    and secret_hash=p_secret_hash for update;
  if not found or capability.state<>'ISSUED' or capability.expires_at<=clock_timestamp() then
    raise exception 'access_capability_invalid'; end if;
  select s.access_email_normalized into snapshot_email from public.ap_search_services service
    join public.ap_intake_snapshots s on s.id=service.original_snapshot_id
    where service.legacy_order_id=capability.order_id and service.customer_id=capability.customer_id;
  if snapshot_email is null then raise exception 'access_capability_subject_missing'; end if;
  update public.ap_order_access_capabilities set state='CONSUMED',consumed_at=clock_timestamp() where id=capability.id;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(capability.customer_id,'ACCESS_LINK_USED','ORDER',capability.order_id,
    jsonb_build_object('capabilityKind','EMAIL_ACCESS'),'chunk4-v1');
  return query select capability.order_id,capability.customer_id,snapshot_email;
end;
$$;

create or replace function public.ap_claim_outbox_messages(p_owner text,p_limit integer default 10)
returns setof public.ap_outbox_messages language plpgsql security definer set search_path = '' as $$
begin
  if length(btrim(p_owner))<3 or p_limit not between 1 and 25 then raise exception 'invalid_outbox_claim'; end if;
  if not coalesce((select provider_idempotent_email_approved and provider_email_approval_reference is not null
    from public.ap_commerce_configuration where singleton),false) then raise exception 'email_provider_guarantee_unapproved'; end if;
  return query with candidates as (
    select id from public.ap_outbox_messages where coalesce(next_attempt_at,created_at)<=clock_timestamp()
      and (state in ('QUEUED','RETRY') or (state='SENDING' and lease_expires_at<=clock_timestamp()))
    order by coalesce(next_attempt_at,created_at),id for update skip locked limit p_limit
  ) update public.ap_outbox_messages message set state='SENDING',lease_owner=p_owner,
    lease_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1,
    first_submitted_at=coalesce(first_submitted_at,clock_timestamp()),
    provider_idempotency_expires_at=coalesce(provider_idempotency_expires_at,clock_timestamp()+interval '24 hours'),
    updated_at=clock_timestamp()
    from candidates where message.id=candidates.id returning message.*;
end;
$$;

create or replace function public.ap_renew_outbox_lease(p_message_id uuid,p_owner text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare renewed_until timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  update public.ap_outbox_messages set lease_expires_at=renewed_until,updated_at=clock_timestamp()
  where id=p_message_id and state='SENDING' and lease_owner=p_owner
    and lease_expires_at>clock_timestamp();
  if not found then raise exception 'outbox_lease_mismatch'; end if;
  return renewed_until;
end;
$$;

create or replace function public.ap_append_material_entitlement_state(p_line_id uuid,p_state text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare prior public.ap_material_entitlement_history; next_id uuid;
begin
  if p_state not in ('REFUND_PENDING','DISPUTED','FULLY_REFUNDED') then
    raise exception 'invalid_material_entitlement_state';
  end if;
  select * into prior from public.ap_material_entitlement_history
    where line_id=p_line_id order by created_at desc,id desc limit 1 for update;
  if not found then return null; end if;
  if prior.state=p_state then return prior.id; end if;
  insert into public.ap_material_entitlement_history(
    line_id,delivered_order_id,delivered_match_id,revision_id,state,supersedes_id
  ) values(prior.line_id,prior.delivered_order_id,prior.delivered_match_id,prior.revision_id,p_state,prior.id)
  returning id into next_id;
  update public.ap_material_entitlement_claims set entitlement_history_id=next_id
    where entitlement_history_id=prior.id;
  return next_id;
end;
$$;

create or replace function public.ap_record_search_refund_result(
  p_refund_id uuid,p_provider_refund_id text,p_provider_status text,p_provider_event_id text default null,
  p_error_code text default null,p_payload_sha256 text default null,
  p_signature_verified_at timestamptz default null,p_event_type text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare refund_row public.ap_refund_operations; command_row public.ap_external_commands;
  service_row public.ap_search_services; line_row public.ap_material_lines;
  now_at timestamptz:=clock_timestamp(); next_state public.ap_refund_state; outbox_id uuid:=gen_random_uuid();
  event_hash text; entitlement_state_id uuid; notification_order_id uuid;
  provider_event_row public.ap_provider_events; result_value jsonb;
begin
  select * into refund_row from public.ap_refund_operations where id=p_refund_id for update;
  if not found then raise exception 'refund_operation_not_found'; end if;
  if nullif(btrim(p_provider_refund_id),'') is null then raise exception 'refund_provider_identity_missing'; end if;
  if refund_row.provider_refund_id is not null and refund_row.provider_refund_id<>p_provider_refund_id
    then raise exception 'refund_provider_identity_conflict'; end if;
  next_state:=case when p_provider_status='succeeded' then 'SUCCEEDED'::public.ap_refund_state
    when p_provider_status in ('failed','canceled') then 'FAILED'::public.ap_refund_state else 'PENDING'::public.ap_refund_state end;
  if p_provider_event_id is not null then
    event_hash:=coalesce(p_payload_sha256,encode(extensions.digest(convert_to(p_provider_refund_id||':'||p_provider_status||':'||coalesce(p_error_code,''),'UTF8'),'sha256'),'hex'));
    if event_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_provider_payload_hash'; end if;
    insert into public.ap_provider_events(provider,provider_event_id,event_type,payload_sha256,signature_verified_at)
    values('stripe',p_provider_event_id,coalesce(nullif(p_event_type,''),'refund.'||lower(p_provider_status)),event_hash,
      coalesce(p_signature_verified_at,now_at))
    on conflict(provider_event_id) do nothing;
    if not found then
      select * into provider_event_row from public.ap_provider_events
        where provider_event_id=p_provider_event_id for update;
      if provider_event_row.payload_sha256<>event_hash
        or provider_event_row.event_type<>coalesce(nullif(p_event_type,''),'refund.'||lower(p_provider_status))
        then raise exception 'provider_event_identity_conflict'; end if;
      if provider_event_row.applied_at is not null or provider_event_row.failure_code is not null then
        return provider_event_row.result||jsonb_build_object('replayed',true);
      end if;
      raise exception 'provider_event_in_progress';
    end if;
  end if;
  if refund_row.state='SUCCEEDED' or (refund_row.state='FAILED' and next_state<>'SUCCEEDED') then
    result_value:=jsonb_build_object('refundId',refund_row.id,'state',refund_row.state::text,
      'ignoredStale',true);
    if p_provider_event_id is not null then
      update public.ap_provider_events set applied_at=now_at,result=result_value
        where provider_event_id=p_provider_event_id and applied_at is null and failure_code is null;
    end if;
    return result_value;
  end if;
  update public.ap_refund_operations set provider_refund_id=p_provider_refund_id,state=next_state,
    completed_at=case when next_state='SUCCEEDED' then now_at else null end,
    failed_at=case when next_state='FAILED' then now_at else null end,last_error_code=p_error_code,
    provider_event_id=coalesce(p_provider_event_id,provider_event_id) where id=refund_row.id;
  select * into command_row from public.ap_external_commands where id=refund_row.provider_command_id for update;
  if command_row.state='CREATING' then
    update public.ap_external_commands set state='CREATED',provider_object_id=p_provider_refund_id,updated_at=now_at where id=command_row.id;
  end if;
  update public.ap_external_commands set state='APPLYING',updated_at=now_at where id=command_row.id and state='CREATED';
  update public.ap_external_commands set state='APPLIED',applied_at=now_at,reconciliation_state=case when next_state='PENDING' then 'REQUIRED' else 'RECONCILED' end,
    failure_code=p_error_code,updated_at=now_at where id=command_row.id and state='APPLYING';
  update public.ap_external_commands set reconciliation_state=case when next_state='PENDING' then 'REQUIRED' else 'RECONCILED' end,
    failure_code=p_error_code,updated_at=now_at where id=command_row.id and state='APPLIED';
  select * into service_row from public.ap_search_services where winning_payment_attempt_id=refund_row.payment_attempt_id for update;
  notification_order_id:=service_row.legacy_order_id;
  if service_row.id is not null then
    update public.orders set status=case when next_state='SUCCEEDED' then 'refunded'::public.order_status else 'refund_pending'::public.order_status end,
      updated_at=now_at where id=service_row.legacy_order_id and status<>'delivered';
  end if;
  if refund_row.material_line_id is not null then
    select * into line_row from public.ap_material_lines where id=refund_row.material_line_id for update;
    if not found then raise exception 'material_refund_line_missing'; end if;
    notification_order_id:=line_row.delivered_order_id;
    if next_state='PENDING' then
      entitlement_state_id:=public.ap_append_material_entitlement_state(line_row.id,'REFUND_PENDING');
    elsif next_state='SUCCEEDED' then
      entitlement_state_id:=public.ap_append_material_entitlement_state(line_row.id,'FULLY_REFUNDED');
      if entitlement_state_id is not null then
        perform public.ap_release_fully_refunded_entitlement(entitlement_state_id);
      end if;
    end if;
  end if;
  insert into public.ap_outbox_messages(id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,
    provider_idempotency_key,state,next_attempt_at)
  values(outbox_id,refund_row.customer_id,notification_order_id,
    case when next_state='SUCCEEDED' then 'REFUND_COMPLETED' when next_state='FAILED' then 'REFUND_PROBLEM' else 'REFUND_PROCESSING' end,
    refund_row.id::text,'refund-state:'||refund_row.id::text||':'||next_state::text,outbox_id::text,'QUEUED',now_at)
  on conflict(deduplication_key) do nothing;
  if next_state='PENDING' then
    insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
    values('REFUND_RECONCILE',refund_row.id,'refund-reconcile:'||refund_row.id::text,now_at+interval '5 minutes')
    on conflict(idempotency_key) do update set state='RETRY',run_at=excluded.run_at,lease_owner=null,lease_expires_at=null,updated_at=now_at;
  elsif next_state='FAILED' then
    insert into public.ap_operational_alerts(alert_key,category,severity,reference_id,non_sensitive_details)
    values('refund-failed:'||refund_row.id::text,'REFUND','CRITICAL',refund_row.id,
      jsonb_build_object('amountCents',refund_row.amount_cents,'errorCode',p_error_code))
    on conflict(alert_key) do nothing;
  end if;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(refund_row.customer_id,'REFUND_STATE_CHANGED','REFUND_OPERATION',refund_row.id,
    jsonb_build_object('state',next_state::text,'amountCents',refund_row.amount_cents),'chunk4-v1');
  result_value:=jsonb_build_object('refundId',refund_row.id,'state',next_state::text);
  if p_provider_event_id is not null then
    update public.ap_provider_events set applied_at=now_at,result=result_value
      where provider_event_id=p_provider_event_id and applied_at is null and failure_code is null;
  end if;
  return result_value;
end;
$$;

create or replace function public.ap_start_search_service_refund(
  p_search_service_id uuid,p_reason_code text,p_require_overdue boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare service_row public.ap_search_services; allocation_row public.ap_capacity_allocations;
  refund_id uuid; now_at timestamptz:=clock_timestamp();
begin
  select * into service_row from public.ap_search_services where id=p_search_service_id for update;
  if not found then raise exception 'search_service_not_found'; end if;
  if exists(select 1 from public.ap_releases where order_id=service_row.legacy_order_id and release_kind='SEARCH_EXACT_TEN')
    then return null; end if;
  if service_row.refund_started_at is not null then
    select id into refund_id from public.ap_refund_operations where payment_attempt_id=service_row.winning_payment_attempt_id
      and scope='FULL_SEARCH' and superseded_at is null;
    return refund_id;
  end if;
  if p_require_overdue and now_at<=service_row.delivery_due_at then return null; end if;
  refund_id:=public.ap_queue_search_refund(service_row.winning_payment_attempt_id,service_row.customer_id,'FULL_SEARCH',p_reason_code);
  update public.ap_search_services set refund_started_at=now_at,fulfillment='CANCELED',canceled_at=now_at,updated_at=now_at
    where id=service_row.id;
  update public.orders set status='refund_pending',updated_at=now_at where id=service_row.legacy_order_id
    and status not in ('delivered','delivered_refunded','refunded');
  select * into allocation_row from public.ap_capacity_allocations where id=service_row.capacity_allocation_id for update;
  if allocation_row.debit_disposition='SPENT' then
    update public.ap_capacity_allocations set lifecycle='SUPERSEDED',updated_at=now_at where id=allocation_row.id;
    insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
    values(allocation_row.id,allocation_row.lifecycle,'SUPERSEDED',allocation_row.debit_disposition,'SPENT',p_reason_code);
  elsif allocation_row.debit_disposition='HELD' then
    update public.ap_capacity_allocations set lifecycle='RELEASED',debit_disposition='RETURNED',returned_at=now_at,updated_at=now_at
      where id=allocation_row.id;
    insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
    values(allocation_row.id,allocation_row.lifecycle,'RELEASED',allocation_row.debit_disposition,'RETURNED',p_reason_code);
  end if;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(service_row.customer_id,'SEARCH_REFUND_STARTED','SEARCH_SERVICE',service_row.id,
    jsonb_build_object('reasonCode',p_reason_code,'refundId',refund_id),'chunk4-v1');
  return refund_id;
end;
$$;

create or replace function public.ap_enqueue_chunk4_due_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare now_at timestamptz:=clock_timestamp(); inserted_count integer:=0; step_count integer;
begin
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  select 'CHECKOUT_PROVISIONAL_CLEANUP',x.id,'checkout-provisional:'||x.id::text,c.lease_expires_at
  from public.ap_checkout_attempts x join public.ap_external_commands c on c.id=x.command_id
  where x.state='NONE' and c.state='CREATING' and c.lease_expires_at<=now_at
  on conflict(idempotency_key) do nothing;
  get diagnostics step_count=row_count; inserted_count:=inserted_count+step_count;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  select 'CHECKOUT_EXPIRY',id,'checkout-expiry:'||id::text,expires_at
  from public.ap_checkout_attempts where state='OPEN' and expires_at<=now_at
  on conflict(idempotency_key) do nothing;
  get diagnostics step_count=row_count; inserted_count:=inserted_count+step_count;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  select 'CHECKOUT_PROVIDER_EXPIRE',checkout.id,'checkout-provider-expire:'||checkout.id::text,now_at
  from public.ap_checkout_attempts checkout
  join public.ap_quotes quote on quote.id=checkout.quote_id
  where checkout.state='OPEN' and quote.invalidated_at is not null
  on conflict(idempotency_key) do nothing;
  get diagnostics step_count=row_count; inserted_count:=inserted_count+step_count;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  select 'PROPOSAL_EXPIRY',id,'proposal-expiry:'||id::text,proposal_expires_at
  from public.ap_criteria_amendments where state='PROPOSED' and proposal_expires_at<=now_at
  on conflict(idempotency_key) do nothing;
  get diagnostics step_count=row_count; inserted_count:=inserted_count+step_count;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  select 'SEARCH_DEADLINE',id,'search-deadline:'||id::text||':'||active_deadline_revision::text,
    delivery_due_at+interval '1 microsecond'
  from public.ap_search_services where fulfillment<>'DELIVERED' and refund_started_at is null
    and delivery_due_at<now_at
  on conflict(idempotency_key) do nothing;
  get diagnostics step_count=row_count; inserted_count:=inserted_count+step_count;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  select 'OUTBOX_SEND',id,'outbox-send:'||id::text,coalesce(next_attempt_at,created_at)
  from public.ap_outbox_messages where state in ('QUEUED','RETRY') and coalesce(next_attempt_at,created_at)<=now_at
  on conflict(idempotency_key) do update set state='RETRY',run_at=excluded.run_at,lease_owner=null,lease_expires_at=null,updated_at=now_at
    where public.ap_scheduled_jobs.state in ('COMPLETED','DEAD_LETTER');
  get diagnostics step_count=row_count; inserted_count:=inserted_count+step_count;
  return jsonb_build_object('databaseNow',now_at,'jobsEnqueued',inserted_count);
end;
$$;

create or replace function public.ap_apply_local_scheduled_job(p_job_id uuid,p_owner text)
returns text language plpgsql security definer set search_path = '' as $$
declare job public.ap_scheduled_jobs; amendment public.ap_criteria_amendments; result_id uuid;
  now_at timestamptz:=clock_timestamp(); result text;
begin
  select * into job from public.ap_scheduled_jobs where id=p_job_id and state='LEASED' and lease_owner=p_owner
    and lease_expires_at>now_at for update;
  if not found then raise exception 'scheduled_job_lease_mismatch'; end if;
  if job.job_kind='CHECKOUT_PROVISIONAL_CLEANUP' then
    return 'EXTERNAL_HANDLER_REQUIRED';
  elsif job.job_kind='CHECKOUT_EXPIRY' then
    perform public.ap_expire_search_checkout(job.reference_id,'CHECKOUT_EXPIRED');
    result:='COMPLETED';
  elsif job.job_kind='PROPOSAL_EXPIRY' then
    select * into amendment from public.ap_criteria_amendments where id=job.reference_id for update;
    if found and amendment.state='PROPOSED' and amendment.proposal_expires_at<=now_at then
      update public.ap_criteria_amendments set state='EXPIRED' where id=amendment.id;
      update public.ap_search_services set adjustment='EXPIRED',updated_at=now_at
        where id=amendment.search_service_id and adjustment='PROPOSED';
      result_id:=public.ap_start_search_service_refund(amendment.search_service_id,'ADJUSTMENT_NO_RESPONSE',false);
    end if;
    result:='COMPLETED';
  elsif job.job_kind='SEARCH_DEADLINE' then
    result_id:=public.ap_start_search_service_refund(job.reference_id,'MISSED_ACTIVE_DEADLINE',true);
    result:=case when result_id is null then 'NOOP_BOUNDARY_OR_RELEASED' else 'COMPLETED' end;
  else
    return 'EXTERNAL_HANDLER_REQUIRED';
  end if;
  update public.ap_scheduled_jobs set state='COMPLETED',lease_owner=null,lease_expires_at=null,last_error_code=null,updated_at=now_at
    where id=job.id;
  return result;
end;
$$;

create or replace function public.ap_retry_scheduled_job(
  p_job_id uuid,p_owner text,p_error_code text,p_retry_at timestamptz,p_dead_letter boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.ap_scheduled_jobs; now_at timestamptz:=clock_timestamp();
begin
  select * into job from public.ap_scheduled_jobs where id=p_job_id and state='LEASED' and lease_owner=p_owner for update;
  if not found then raise exception 'scheduled_job_lease_mismatch'; end if;
  update public.ap_scheduled_jobs set state=case when p_dead_letter then 'DEAD_LETTER'::public.ap_scheduled_job_state else 'RETRY'::public.ap_scheduled_job_state end,
    run_at=case when p_dead_letter then run_at else p_retry_at end,lease_owner=null,lease_expires_at=null,
    last_error_code=p_error_code,updated_at=now_at where id=job.id;
  if p_dead_letter then
    insert into public.ap_operational_alerts(alert_key,category,severity,reference_id,non_sensitive_details)
    values('worker-dead-letter:'||job.id::text,'WORKER','CRITICAL',job.id,
      jsonb_build_object('jobKind',job.job_kind,'attempts',job.attempts,'errorCode',p_error_code))
    on conflict(alert_key) do nothing;
  end if;
  return true;
end;
$$;

create or replace function public.ap_complete_external_scheduled_job(
  p_job_id uuid,p_owner text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ap_scheduled_jobs set state='COMPLETED',lease_owner=null,lease_expires_at=null,
    last_error_code=null,updated_at=clock_timestamp()
  where id=p_job_id and state='LEASED' and lease_owner=p_owner;
  if not found then raise exception 'scheduled_job_lease_mismatch'; end if;
  return true;
end;
$$;

create or replace function public.ap_renew_scheduled_job_lease(p_job_id uuid,p_owner text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare renewed_until timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  update public.ap_scheduled_jobs set lease_expires_at=renewed_until,updated_at=clock_timestamp()
  where id=p_job_id and state='LEASED' and lease_owner=p_owner
    and lease_expires_at>clock_timestamp();
  if not found then raise exception 'scheduled_job_lease_mismatch'; end if;
  return renewed_until;
end;
$$;

create or replace function public.ap_chunk4_monitor_snapshot()
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object(
  'databaseNow',clock_timestamp(),
  'capacityHeld',(select coalesce(sum(a.units),0) from public.ap_capacity_allocations a
    where a.debit_disposition='HELD'),
  'capacitySpent',(select coalesce(sum(a.units),0) from public.ap_capacity_allocations a
    where a.debit_disposition='SPENT'),
  'capacityExhausted',(select count(*) from public.ap_capacity_pools p where p.enabled and not exists(
    select 1 from public.ap_capacity_buckets b where b.pool_id=p.id and b.starts_at<=clock_timestamp()
      and b.ends_at>=clock_timestamp() and public.ap_capacity_available(b.id)>0)),
  'webhookFailures',(
    (select count(*) from public.ap_provider_events where failure_code is not null)+
    (select count(*) from public.webhook_events where processing_status='failed')),
  'webhookDispatcherFailures',(select count(*) from public.webhook_events where processing_status='failed'),
  'webhooksPending',(
    (select count(*) from public.ap_provider_events where applied_at is null and failure_code is null)+
    (select count(*) from public.webhook_events where processing_status in ('received','processing'))),
  'webhookDispatcherPending',(select count(*) from public.webhook_events where processing_status in ('received','processing')),
  'oldestWebhookLagSeconds',(select coalesce(max(greatest(0,extract(epoch from (clock_timestamp()-pending.received_at)))),0)
    from (select received_at from public.ap_provider_events where applied_at is null and failure_code is null
      union all select received_at from public.webhook_events where processing_status in ('received','processing')) pending),
  'ordersApproachingDeadline',(select count(*) from public.ap_search_services where fulfillment<>'DELIVERED'
    and refund_started_at is null and delivery_due_at between clock_timestamp() and clock_timestamp()+interval '2 hours'),
  'ordersPastDeadline',(select count(*) from public.ap_search_services where fulfillment<>'DELIVERED'
    and refund_started_at is null and delivery_due_at<clock_timestamp()),
  'adjustmentsAwaitingResponse',(select count(*) from public.ap_criteria_amendments where state='PROPOSED'),
  'refundFailures',(select count(*) from public.ap_refund_operations where state='FAILED' and superseded_at is null),
  'outboxDeadLetters',(select count(*) from public.ap_outbox_messages where state='DEAD_LETTER'),
  'oldestOutboxRetrySeconds',(select coalesce(max(greatest(0,extract(epoch from (clock_timestamp()-created_at)))),0)
    from public.ap_outbox_messages where state in ('QUEUED','RETRY','SENDING')),
  'staleReviews',(select count(*) from public.ap_job_release_reviews where decision='APPROVED'
    and invalidated_at is null and reviewed_at<clock_timestamp()-interval '60 minutes'),
  'leasedJobsOverdue',(select count(*) from public.ap_scheduled_jobs where state='LEASED' and lease_expires_at<=clock_timestamp())
);
$$;

create or replace function public.ap_propose_search_adjustment(
  p_search_service_id uuid,p_reviewer_id uuid,p_current_valid_count integer,p_reason_codes text[],
  p_blocking_constraints jsonb,p_criteria_diff jsonb,p_snapshot_patch jsonb,p_proposal_expires_at timestamptz,
  p_estimated_revision_seconds integer,p_idempotency_key text,p_outbox_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare service_row public.ap_search_services; amendment_id uuid; now_at timestamptz:=clock_timestamp();
begin
  if not exists(select 1 from public.profiles where id=p_reviewer_id and role in ('operator','admin'))
    then raise exception 'authorized_reviewer_required'; end if;
  if p_current_valid_count not between 0 and 9 or cardinality(p_reason_codes)=0
    or jsonb_typeof(p_blocking_constraints)<>'object' or p_blocking_constraints='{}'::jsonb
    or jsonb_typeof(p_criteria_diff)<>'object' or p_criteria_diff='{}'::jsonb
    or jsonb_typeof(p_snapshot_patch)<>'object' or p_snapshot_patch='{}'::jsonb
    or (p_snapshot_patch-array['desiredActivities','avoidedActivities','optionalTitles','confirmedTitleRestriction',
      'optionalIndustries','blockedIndustries','searchBreadth','workModes','preferredWorkMode','stateOrDc',
      'employmentTypes','preferredEmploymentType','schedules','travel','benefits','workConditionPreferences',
      'dealbreakers','salaryTargetCents','salaryHardMinimumCents','salaryMinimumFlexible','salaryPeriod',
      'salaryBasis','salaryOverlapPolicy','salaryUnpublishedPolicy','salaryNoncomparablePolicy',
      'salaryVariablePayPolicy','employerUnknownPolicies'])<>'{}'::jsonb
    or p_estimated_revision_seconds<=0 then raise exception 'invalid_adjustment_proposal'; end if;
  select * into service_row from public.ap_search_services where id=p_search_service_id for update;
  if not found or service_row.search_activated_at is null or service_row.fulfillment='DELIVERED'
    or service_row.refund_started_at is not null or p_proposal_expires_at<=now_at
    or p_proposal_expires_at>service_row.delivery_due_at
    or exists(select 1 from public.ap_releases where order_id=service_row.legacy_order_id and release_kind='SEARCH_EXACT_TEN')
    then raise exception 'adjustment_proposal_not_allowed'; end if;
  select id into amendment_id from public.ap_criteria_amendments where idempotency_key=p_idempotency_key;
  if amendment_id is not null then return amendment_id; end if;
  amendment_id:=gen_random_uuid();
  insert into public.ap_criteria_amendments(id,search_service_id,parent_snapshot_id,state,criteria_diff,
    proposal_expires_at,current_valid_count,reason_codes,blocking_constraints,proposed_snapshot_patch,
    estimated_revision_seconds,idempotency_key)
  values(amendment_id,service_row.id,service_row.active_snapshot_id,'PROPOSED',p_criteria_diff,p_proposal_expires_at,
    p_current_valid_count,p_reason_codes,p_blocking_constraints,p_snapshot_patch,p_estimated_revision_seconds,p_idempotency_key);
  update public.ap_search_services set fulfillment='ADJUSTMENT_REQUIRED',adjustment='PROPOSED',updated_at=now_at
    where id=service_row.id;
  insert into public.ap_outbox_messages(id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,
    provider_idempotency_key,state,next_attempt_at)
  values(p_outbox_id,service_row.customer_id,service_row.legacy_order_id,'ADJUSTMENT_REQUIRED',amendment_id::text,
    'adjustment-required:'||amendment_id::text,p_outbox_id::text,'QUEUED',now_at);
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('PROPOSAL_EXPIRY',amendment_id,'proposal-expiry:'||amendment_id::text,p_proposal_expires_at),
    ('OUTBOX_SEND',p_outbox_id,'outbox-send:'||p_outbox_id::text,now_at)
  on conflict(idempotency_key) do nothing;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(service_row.customer_id,p_reviewer_id,'ADJUSTMENT_PROPOSED','CRITERIA_AMENDMENT',amendment_id,
    jsonb_build_object('currentValidCount',p_current_valid_count,'reasonCodes',p_reason_codes,
      'proposalExpiresAt',p_proposal_expires_at),'chunk4-v1');
  return amendment_id;
end;
$$;

create or replace function public.ap_complete_outbox_message(
  p_message_id uuid,p_owner text,p_provider_message_id text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ap_outbox_messages set state='SENT',provider_message_id=p_provider_message_id,
    reconciliation_state='RECONCILED',lease_owner=null,lease_expires_at=null,last_error_code=null,updated_at=clock_timestamp()
    where id=p_message_id and state='SENDING' and lease_owner=p_owner;
  if not found then raise exception 'outbox_lease_mismatch'; end if;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  select customer_id,'OUTBOX_SENT','OUTBOX_MESSAGE',id,
    jsonb_build_object('messageKind',message_kind,'attempts',attempts),'chunk4-v1'
  from public.ap_outbox_messages where id=p_message_id;
  return true;
end;
$$;

create or replace function public.ap_fail_outbox_message(
  p_message_id uuid,p_owner text,p_error_code text,p_retry_at timestamptz,p_dead_letter boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare message public.ap_outbox_messages; now_at timestamptz:=clock_timestamp();
begin
  select * into message from public.ap_outbox_messages where id=p_message_id and state='SENDING'
    and lease_owner=p_owner for update;
  if not found then raise exception 'outbox_lease_mismatch'; end if;
  if message.first_submitted_at is not null and now_at>=message.first_submitted_at+interval '24 hours' then
    p_dead_letter:=true;
  end if;
  update public.ap_outbox_messages set state=case when p_dead_letter then 'DEAD_LETTER'::public.ap_outbox_state else 'RETRY'::public.ap_outbox_state end,
    next_attempt_at=case when p_dead_letter then null else p_retry_at end,
    dead_lettered_at=case when p_dead_letter then now_at else null end,
    reconciliation_state=case when p_dead_letter then 'FAILED' else 'REQUIRED' end,
    lease_owner=null,lease_expires_at=null,last_error_code=p_error_code,updated_at=now_at
  where id=message.id;
  if p_dead_letter then
    insert into public.ap_operational_alerts(alert_key,category,severity,reference_id,non_sensitive_details)
    values('outbox-dead-letter:'||message.id::text,'OUTBOX','CRITICAL',message.id,
      jsonb_build_object('messageKind',message.message_kind,'attempts',message.attempts))
    on conflict(alert_key) do nothing;
  end if;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(message.customer_id,case when p_dead_letter then 'OUTBOX_DEAD_LETTERED' else 'OUTBOX_RETRY_QUEUED' end,
    'OUTBOX_MESSAGE',message.id,jsonb_build_object('messageKind',message.message_kind,'attempts',message.attempts),'chunk4-v1');
  return true;
end;
$$;

create or replace function public.ap_align_access_capability_to_outbox(
  p_message_id uuid,p_owner text,p_secret_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare message public.ap_outbox_messages; capability_id uuid; aligned_expiry timestamptz;
begin
  select * into message from public.ap_outbox_messages where id=p_message_id and state='SENDING'
    and lease_owner=p_owner for update;
  if not found or message.message_kind not in ('PAYMENT_VERIFIED_SEARCH_STARTED','SECURE_ACCESS_RESEND')
    or message.payload_ref is null or message.order_id is null then raise exception 'access_outbox_lease_invalid'; end if;
  aligned_expiry:=message.first_submitted_at+interval '15 minutes';
  update public.ap_order_access_capabilities capability
    set issued_at=message.first_submitted_at,expires_at=aligned_expiry
    where capability.order_id=message.order_id and capability.kind='EMAIL_ACCESS'
      and capability.secret_hash=p_secret_hash and capability.state='ISSUED'
    returning capability.id into capability_id;
  if capability_id is null or aligned_expiry<=clock_timestamp() then raise exception 'access_outbox_capability_expired'; end if;
  return capability_id;
end;
$$;

create or replace function public.ap_issue_order_access_capability(
  p_order_id uuid,p_secret_hash text,p_capability_id uuid,p_payload_id uuid,p_outbox_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare service_row public.ap_search_services; payment_row public.ap_payment_attempts;
  checkout_row public.ap_checkout_attempts; now_at timestamptz:=clock_timestamp();
begin
  if p_secret_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_access_capability_hash'; end if;
  select * into service_row from public.ap_search_services where legacy_order_id=p_order_id for update;
  if not found or service_row.refund_started_at is not null then raise exception 'order_access_unavailable'; end if;
  select * into payment_row from public.ap_payment_attempts where id=service_row.winning_payment_attempt_id;
  select * into checkout_row from public.ap_checkout_attempts where id=payment_row.checkout_attempt_id for update;
  if checkout_row.id is null or not exists(
    select 1 from public.ap_sensitive_payloads where id=p_payload_id and draft_id=checkout_row.draft_id
  ) then raise exception 'access_payload_subject_mismatch'; end if;
  update public.ap_order_access_capabilities set state='REVOKED',revoked_at=now_at
    where checkout_attempt_id=checkout_row.id and kind='EMAIL_ACCESS' and state='ISSUED';
  insert into public.ap_order_access_capabilities(
    id,checkout_attempt_id,order_id,customer_id,kind,secret_hash,state,created_at,issued_at,expires_at
  ) values(
    p_capability_id,checkout_row.id,p_order_id,service_row.customer_id,'EMAIL_ACCESS',p_secret_hash,
    'ISSUED',now_at,now_at,now_at+interval '15 minutes'
  );
  insert into public.ap_outbox_messages(
    id,customer_id,order_id,message_kind,recipient_ref,payload_ref,deduplication_key,
    provider_idempotency_key,state,next_attempt_at
  ) values(
    p_outbox_id,service_row.customer_id,p_order_id,'SECURE_ACCESS_RESEND',service_row.original_snapshot_id::text,
    p_payload_id,'access-resend:'||p_capability_id::text,p_outbox_id::text,'QUEUED',now_at
  );
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('OUTBOX_SEND',p_outbox_id,'outbox-send:'||p_outbox_id::text,now_at)
  on conflict(idempotency_key) do nothing;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(service_row.customer_id,'ACCESS_LINK_ISSUED','ORDER',p_order_id,
    jsonb_build_object('capabilityKind','EMAIL_ACCESS','expiresAt',now_at+interval '15 minutes'),'chunk4-v1');
  return p_capability_id;
end;
$$;

create or replace function public.ap_record_job_release_review(
  p_search_service_id uuid,p_evaluation_id uuid,p_reviewer_id uuid,
  p_decision public.ap_staff_review_decision,p_rationale text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare service_row public.ap_search_services; evaluation_row public.ap_match_evaluations;
  review_id uuid:=gen_random_uuid(); now_at timestamptz:=clock_timestamp();
begin
  if length(btrim(p_rationale))<20 or not exists(
    select 1 from public.profiles where id=p_reviewer_id and role in ('operator','admin')
  ) then raise exception 'authorized_release_review_required'; end if;
  select * into service_row from public.ap_search_services where id=p_search_service_id for update;
  select * into evaluation_row from public.ap_match_evaluations where id=p_evaluation_id;
  if service_row.id is null or evaluation_row.id is null or evaluation_row.snapshot_id<>service_row.active_snapshot_id
    or evaluation_row.customer_id<>service_row.customer_id or evaluation_row.invalidated_at is not null
    then raise exception 'release_review_binding_invalid'; end if;
  if p_decision='APPROVED' and (
    evaluation_row.eligibility not in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS')
    or evaluation_row.root_result<>'PASS'
    or 'BLOCK'=any(evaluation_row.unknown_treatments)
    or evaluation_row.resolution_issues && array['CANDIDATE_MISSING','PARSER_UNCERTAIN','EVIDENCE_CONFLICT']::public.ap_resolution_issue[]
    or evaluation_row.salary_disposition not in ('PASS','ALLOWED_WITH_WARNING','NOT_APPLICABLE')
    or not evaluation_row.categorical_evidence_sufficient
    or evaluation_row.usefulness_result<>'PASS'
    or evaluation_row.application_readiness<>'READY'
  ) then raise exception 'confirmed_hard_failure_not_approvable'; end if;
  update public.ap_job_release_reviews set invalidated_at=now_at
    where search_service_id=service_row.id and evaluation_id=evaluation_row.id and invalidated_at is null;
  insert into public.ap_job_release_reviews(
    id,customer_id,search_service_id,evaluation_id,reviewer_id,decision,bound_snapshot_id,
    bound_job_snapshot_id,bound_fact_ids,bound_version_bundle,reviewed_at,rationale
  ) values(
    review_id,service_row.customer_id,service_row.id,evaluation_row.id,p_reviewer_id,p_decision,
    evaluation_row.snapshot_id,evaluation_row.job_snapshot_id,evaluation_row.candidate_fact_ids,
    evaluation_row.version_bundle,now_at,p_rationale
  );
  update public.ap_search_services set fulfillment=case
    when p_decision='CUSTOMER_INPUT_REQUIRED' then 'ADJUSTMENT_REQUIRED'::public.ap_search_fulfillment
    else 'HUMAN_REVIEW'::public.ap_search_fulfillment end,updated_at=now_at
  where id=service_row.id and fulfillment not in ('DELIVERED','CANCELED');
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(service_row.customer_id,p_reviewer_id,'JOB_RELEASE_REVIEWED','MATCH_EVALUATION',evaluation_row.id,
    jsonb_build_object('decision',p_decision::text,'jobSnapshotId',evaluation_row.job_snapshot_id),'chunk4-v1');
  return review_id;
end;
$$;

create or replace function public.ap_commit_exact_ten_release(
  p_search_service_id uuid,p_reviewer_id uuid,p_selection_run_id uuid,p_members jsonb,
  p_review_checklist jsonb,p_reviewer_rationale text,p_release_id uuid,p_outbox_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare service_row public.ap_search_services; selection_row public.ap_match_selection_runs;
  allocation_row public.ap_capacity_allocations; member jsonb; evaluation_row public.ap_match_evaluations;
  job_row public.ap_job_snapshots; match_id uuid; position_value integer; now_at timestamptz:=clock_timestamp();
  evaluation_ids uuid[]; configured_ttl integer; existing_release uuid;
begin
  if jsonb_typeof(p_members)<>'array' or jsonb_array_length(p_members)<>10
    or jsonb_typeof(p_review_checklist)<>'object' or length(btrim(p_reviewer_rationale))<20
    or coalesce((p_review_checklist->>'criteriaCompared')::boolean,false) is not true
    or coalesce((p_review_checklist->>'allListingsRechecked')::boolean,false) is not true
    or coalesce((p_review_checklist->>'exactlyTenApplicationWorthy')::boolean,false) is not true
    or coalesce((p_review_checklist->>'noPadding')::boolean,false) is not true
    or coalesce((p_review_checklist->>'humanReleaseApproved')::boolean,false) is not true
    then raise exception 'exact_ten_review_incomplete'; end if;
  if not exists(select 1 from public.profiles where id=p_reviewer_id and role in ('operator','admin'))
    then raise exception 'authorized_reviewer_required'; end if;
  select * into service_row from public.ap_search_services where id=p_search_service_id for update;
  if not found then raise exception 'search_service_not_found'; end if;
  select id into existing_release from public.ap_releases
    where order_id=service_row.legacy_order_id and release_kind='SEARCH_EXACT_TEN';
  if existing_release is not null then return existing_release; end if;
  if service_row.search_activated_at is null or service_row.fulfillment='DELIVERED'
    or service_row.fulfillment='ADJUSTMENT_REQUIRED' or service_row.adjustment='PROPOSED'
    or service_row.refund_started_at is not null or service_row.delivery_due_at is null
    or now_at>service_row.delivery_due_at then raise exception 'search_release_not_allowed'; end if;
  select release_verification_ttl_seconds into configured_ttl
    from public.ap_commerce_configuration
    where singleton and provider_idempotent_email_approved and provider_email_approval_reference is not null;
  if configured_ttl is distinct from 3600 then raise exception 'release_configuration_unset_blocking'; end if;
  select * into selection_row from public.ap_match_selection_runs where id=p_selection_run_id;
  if not found or selection_row.snapshot_id<>service_row.active_snapshot_id or selection_row.purpose<>'RELEASE'
    or selection_row.requested_count<>10 or selection_row.selector_version<>'bounded-diversity-v2'
    then raise exception 'current_release_selection_required'; end if;
  select array_agg((value->>'evaluationId')::uuid order by (value->>'position')::integer)
    into evaluation_ids from jsonb_array_elements(p_members);
  if cardinality(evaluation_ids)<>10 or cardinality(array(select distinct unnest(evaluation_ids)))<>10
    or exists(
      select 1 from generate_subscripts(evaluation_ids,1) n
      where not exists(
        select 1 from public.ap_match_selection_members sm
        where sm.selection_run_id=p_selection_run_id and sm.evaluation_id=evaluation_ids[n]
          and sm.selected_rank=n
      )
    ) then raise exception 'release_selection_members_invalid'; end if;

  if exists(
    select 1
    from unnest(evaluation_ids) evaluation_id
    join public.ap_match_evaluations evaluation on evaluation.id=evaluation_id
    join public.ap_job_snapshots job on job.id=evaluation.job_snapshot_id
    join public.ap_intake_snapshots active_snapshot on active_snapshot.id=service_row.active_snapshot_id
    left join public.ap_source_authorizations linked_auth on linked_auth.id=job.source_authorization_id
    where evaluation.customer_id<>service_row.customer_id
      or evaluation.snapshot_id<>service_row.active_snapshot_id or evaluation.invalidated_at is not null
      or evaluation.legacy_compatibility or job.legacy_compatibility
      or evaluation.calculation_version<>'matching-rules-v3'
      or evaluation.version_bundle->>'matching'<>'matching-rules-v3'
      or evaluation.version_bundle->>'catalog'<>'matching-rules-v3'
      or evaluation.version_bundle->>'selector'<>'bounded-diversity-v2'
      or evaluation.version_bundle->>'parser'<>job.parser_version
      or evaluation.version_bundle->>'criteria'<>active_snapshot.schema_version
      or evaluation.version_bundle->>'jobSnapshot'<>job.content_sha256
      or evaluation.version_bundle->>'sourceAuthorization'<>linked_auth.authorization_version
      or evaluation.eligibility not in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS')
      or not evaluation.categorical_evidence_sufficient or evaluation.usefulness_result<>'PASS'
      or evaluation.application_readiness<>'READY'
      or evaluation.salary_disposition not in ('PASS','ALLOWED_WITH_WARNING','NOT_APPLICABLE')
      or 'BLOCK'=any(evaluation.unknown_treatments)
      or evaluation.resolution_issues && array['CANDIDATE_MISSING','PARSER_UNCERTAIN','EVIDENCE_CONFLICT']::public.ap_resolution_issue[]
      or ('ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING'=any(evaluation.unknown_treatments)
        and jsonb_array_length(evaluation.warnings)=0)
      or job.legacy_job_id is null or job.requirement_completeness<>100
      or job.legitimacy_result<>'PASS' or job.listing_activity_result<>'PASS' or job.application_path_result<>'PASS'
      or job.live_verified_at<now_at-make_interval(secs=>configured_ttl) or job.live_verified_at>now_at
      or linked_auth.id is null or linked_auth.state not in ('AUTHORIZED_AUTOMATED','AUTHORIZED_MANUAL_ONLY')
      or exists(select 1 from public.ap_source_authorizations current_auth
        where current_auth.source_id=linked_auth.source_id and
          (current_auth.created_at>linked_auth.created_at
            or (current_auth.created_at=linked_auth.created_at and current_auth.authorization_version>linked_auth.authorization_version)))
      or lower(concat_ws(' ',job.discovery_source,job.company,job.source_url,job.canonical_application_url,
        job.canonical_employer_listing_url)) ~ 'live[[:space:]]*ops|liveops'
      or exists(select 1 from public.ap_job_snapshots successor where successor.supersedes_job_snapshot_id=job.id)
      or exists(select 1 from unnest(evaluation.candidate_fact_ids) fact_id where not exists(
        select 1 from public.ap_candidate_facts fact where fact.id=fact_id
          and fact.snapshot_id=service_row.active_snapshot_id and fact.superseded_at is null
          and fact.verification in ('CUSTOMER_CONFIRMED','HUMAN_VERIFIED')
      ))
      or exists(select 1 from unnest(array['whatJobInvolves','whyMadeList','howExperienceConnects','whatMayBeNew','whatToKnow']) section
        where jsonb_typeof(evaluation.explanation_evidence->section) is distinct from 'object'
          or jsonb_typeof(evaluation.explanation_evidence->section->'sourceEvidenceNodeIds') is distinct from 'array'
          or jsonb_array_length(evaluation.explanation_evidence->section->'sourceEvidenceNodeIds')=0)
      or exists(
        select 1
        from unnest(array['whatJobInvolves','whyMadeList','howExperienceConnects','whatMayBeNew','whatToKnow']) section
        cross join lateral jsonb_array_elements_text(
          case when jsonb_typeof(evaluation.explanation_evidence->section->'sourceEvidenceNodeIds')='array'
            then evaluation.explanation_evidence->section->'sourceEvidenceNodeIds' else '[]'::jsonb end
        ) evidence_node_id
        where not exists(
          select 1 from public.ap_requirement_nodes evidence_node
          where evidence_node.id::text=evidence_node_id
            and evidence_node.job_snapshot_id=evaluation.job_snapshot_id
        )
      )
  ) then raise exception 'release_candidate_gate_failed'; end if;

  if exists(
    select 1
    from unnest(evaluation_ids) with ordinality left_id(id,left_position)
    join unnest(evaluation_ids) with ordinality right_id(id,right_position)
      on left_id.left_position<right_id.right_position
    join public.ap_match_evaluations left_eval on left_eval.id=left_id.id
    join public.ap_job_snapshots left_job on left_job.id=left_eval.job_snapshot_id
    join public.ap_match_evaluations right_eval on right_eval.id=right_id.id
    join public.ap_job_snapshots right_job on right_job.id=right_eval.job_snapshot_id
    where (
      left_job.external_job_id is not null and right_job.external_job_id is not null
      and left_job.external_job_id=right_job.external_job_id
      and left_job.canonical_employer_domain is not distinct from right_job.canonical_employer_domain
    ) or (
      coalesce(left_job.canonical_employer_listing_url,left_job.canonical_application_url)
        =coalesce(right_job.canonical_employer_listing_url,right_job.canonical_application_url)
    ) or (
      (left_job.external_job_id is null or right_job.external_job_id is null)
      and (left_job.canonical_employer_listing_url is null or right_job.canonical_employer_listing_url is null)
      and left_job.normalized_fingerprint=right_job.normalized_fingerprint
    )
  ) then raise exception 'release_jobs_not_pairwise_unique'; end if;

  insert into public.ap_releases(
    id,customer_id,order_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by
  ) values(
    p_release_id,service_row.customer_id,service_row.legacy_order_id,'SEARCH_EXACT_TEN',now_at,
    service_row.delivery_due_at,jsonb_build_object('selectionRunId',p_selection_run_id,
      'selectorVersion',selection_row.selector_version,'activeSnapshotId',service_row.active_snapshot_id),
    p_reviewer_id
  );
  update public.ap_job_release_reviews set invalidated_at=now_at
    where search_service_id=service_row.id and invalidated_at is null;
  update public.ap_search_package_reviews set invalidated_at=now_at
    where search_service_id=service_row.id and invalidated_at is null;
  for member in select value from jsonb_array_elements(p_members) order by (value->>'position')::integer loop
    position_value:=(member->>'position')::integer;
    if position_value not between 1 and 10 or member->>'evaluationId' is null
      or jsonb_typeof(member->'releaseExplanation') is distinct from 'object'
      or exists(select 1 from unnest(array['whatJobInvolves','whyMadeList','howExperienceConnects','whatMayBeNew','whatToKnow']) section
        where nullif(btrim(member->'releaseExplanation'->>section),'') is null)
      then raise exception 'release_member_payload_invalid'; end if;
    select * into evaluation_row from public.ap_match_evaluations where id=(member->>'evaluationId')::uuid;
    select * into job_row from public.ap_job_snapshots where id=evaluation_row.job_snapshot_id;
    if job_row.legacy_job_id<>(member->>'jobId')::uuid then raise exception 'release_member_job_mismatch'; end if;
    insert into public.ap_job_release_reviews(
      customer_id,search_service_id,evaluation_id,reviewer_id,decision,bound_snapshot_id,
      bound_job_snapshot_id,bound_fact_ids,bound_version_bundle,reviewed_at,rationale
    ) values(
      service_row.customer_id,service_row.id,evaluation_row.id,p_reviewer_id,'APPROVED',
      evaluation_row.snapshot_id,evaluation_row.job_snapshot_id,evaluation_row.candidate_fact_ids,
      evaluation_row.version_bundle,now_at,p_reviewer_rationale
    );
    match_id:=gen_random_uuid();
    insert into public.job_matches(
      id,search_order_id,job_id,position,fit_summary,matching_experience,primary_outcome,
      core_responsibilities,requirements,hidden_job_functions,concerns,criteria_checks,
      ranking_score,ranking_reason_codes,reviewed_by,reviewed_at,delivered_at,release_evaluation_id,
      release_explanation,allowed_unknown_warnings,source_provenance,compensation_status,
      posted_on,posted_date_unknown,last_checked_at
    ) values(
      match_id,service_row.legacy_order_id,job_row.legacy_job_id,position_value,member->>'fitSummary',
      coalesce(member->'matchingExperience','[]'::jsonb),member->>'primaryOutcome',
      coalesce(member->'coreResponsibilities','[]'::jsonb),coalesce(member->'requirements','[]'::jsonb),
      coalesce(member->'hiddenJobFunctions','[]'::jsonb),coalesce(member->'warnings','[]'::jsonb),
      coalesce(member->'criteriaChecks','{}'::jsonb),round(coalesce(evaluation_row.fit_score,0))::integer,
      coalesce(member->'rankingReasonCodes','[]'::jsonb),p_reviewer_id,now_at,now_at,evaluation_row.id,
      member->'releaseExplanation',coalesce(member->'warnings','[]'::jsonb),
      jsonb_build_object('discoverySource',job_row.discovery_source,'sourceUrl',job_row.source_url,
        'applicationUrl',job_row.canonical_application_url,'applicationHostType',job_row.application_host_type,
        'liveVerifiedAt',job_row.live_verified_at),evaluation_row.salary_status::text,
      job_row.posted_on,job_row.posted_date_unknown,job_row.live_verified_at
    );
    insert into public.ap_release_members(release_id,member_type,member_id,position)
      values(p_release_id,'JOB_MATCH',match_id,position_value);
  end loop;
  insert into public.ap_search_package_reviews(
    customer_id,search_service_id,selection_run_id,reviewer_id,decision,evaluation_ids,
    version_bundle,checklist,rationale,reviewed_at
  ) values(
    service_row.customer_id,service_row.id,p_selection_run_id,p_reviewer_id,'APPROVED',evaluation_ids,
    jsonb_build_object('selectionRunId',p_selection_run_id,'selectorVersion',selection_row.selector_version,
      'activeSnapshotId',service_row.active_snapshot_id),p_review_checklist,p_reviewer_rationale,now_at
  );
  select * into allocation_row from public.ap_capacity_allocations where id=service_row.capacity_allocation_id for update;
  if allocation_row.debit_disposition<>'SPENT' or allocation_row.lifecycle not in ('CONSUMED','SUPERSEDED')
    then raise exception 'consumed_search_capacity_required'; end if;
  update public.ap_capacity_allocations set lifecycle='COMPLETED',updated_at=now_at where id=allocation_row.id;
  insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,actor_id,reason_code)
  values(allocation_row.id,allocation_row.lifecycle,'COMPLETED','SPENT','SPENT',p_reviewer_id,'EXACT_TEN_RELEASED');
  update public.ap_search_services set fulfillment='DELIVERED',revenue_earned_at=now_at,updated_at=now_at
    where id=service_row.id;
  update public.orders set status='delivered',delivered_at=now_at,human_review_checklist=p_review_checklist,
    human_reviewed_by=p_reviewer_id,human_reviewed_at=now_at,updated_at=now_at
    where id=service_row.legacy_order_id;
  insert into public.ap_outbox_messages(
    id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at
  ) values(
    p_outbox_id,service_row.customer_id,service_row.legacy_order_id,'SEARCH_EXACT_TEN_DELIVERED',
    p_release_id::text,'search-delivered:'||service_row.legacy_order_id::text,p_outbox_id::text,'QUEUED',now_at
  );
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('OUTBOX_SEND',p_outbox_id,'outbox-send:'||p_outbox_id::text,now_at)
  on conflict(idempotency_key) do nothing;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(service_row.customer_id,p_reviewer_id,'EXACT_TEN_RELEASED','RELEASE',p_release_id,
    jsonb_build_object('orderId',service_row.legacy_order_id,'memberCount',10,
      'selectionRunId',p_selection_run_id,'committedAt',now_at),'chunk4-v1');
  return p_release_id;
end;
$$;

create or replace function public.ap_accept_search_adjustment(
  p_amendment_id uuid,p_customer_id uuid,p_child_snapshot_id uuid,p_child_content_sha256 text,
  p_acceptance_idempotency_key text,p_capacity_request_key text,p_outbox_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare amendment_row public.ap_criteria_amendments; service_row public.ap_search_services;
  parent_row public.ap_intake_snapshots; payment_row public.ap_payment_attempts;
  legacy_order public.orders;
  prior_allocation public.ap_capacity_allocations; revised_allocation_id uuid;
  accepted_at_value timestamptz:=clock_timestamp(); capacity_confirmed_at_value timestamptz;
  revision_started_at_value timestamptz; revision_due_at_value timestamptz; next_revision integer;
  refund_id uuid; patch jsonb;
begin
  if p_child_content_sha256 !~ '^[0-9a-f]{64}$'
    or nullif(btrim(p_acceptance_idempotency_key),'') is null
    or nullif(btrim(p_capacity_request_key),'') is null then raise exception 'invalid_adjustment_acceptance'; end if;
  select * into amendment_row from public.ap_criteria_amendments where id=p_amendment_id for update;
  if not found then raise exception 'adjustment_not_found'; end if;
  select * into service_row from public.ap_search_services where id=amendment_row.search_service_id for update;
  if service_row.customer_id<>p_customer_id then raise exception 'adjustment_access_denied'; end if;
  if amendment_row.acceptance_idempotency_key=p_acceptance_idempotency_key and amendment_row.state='ACCEPTED' then
    return jsonb_build_object('outcome','ACCEPTED','snapshotId',amendment_row.child_snapshot_id,
      'deliveryDueAt',amendment_row.revision_due_at,'replayed',true);
  end if;
  if amendment_row.state<>'PROPOSED' or amendment_row.proposal_expires_at<=accepted_at_value
    or amendment_row.parent_snapshot_id<>service_row.active_snapshot_id
    or service_row.fulfillment='DELIVERED' or service_row.refund_started_at is not null
    or exists(select 1 from public.ap_releases where order_id=service_row.legacy_order_id and release_kind='SEARCH_EXACT_TEN')
    then raise exception 'adjustment_not_acceptable'; end if;
  patch:=amendment_row.proposed_snapshot_patch;
  begin
    revised_allocation_id:=public.ap_reserve_capacity(
      p_customer_id,'SEARCH',1,p_capacity_request_key,accepted_at_value+interval '5 minutes','[]'::jsonb,null
    );
  exception when others then
    update public.ap_criteria_amendments set state='DECLINED',declined_at=accepted_at_value,
      decline_reason='REVISED_CAPACITY_UNAVAILABLE',decline_idempotency_key=p_acceptance_idempotency_key
      where id=amendment_row.id;
    refund_id:=public.ap_start_search_service_refund(service_row.id,'REVISED_CAPACITY_UNAVAILABLE',false);
    return jsonb_build_object('outcome','CAPACITY_EXCEPTION','refundId',refund_id);
  end;
  capacity_confirmed_at_value:=clock_timestamp();
  select * into parent_row from public.ap_intake_snapshots where id=amendment_row.parent_snapshot_id;
  select * into payment_row from public.ap_payment_attempts where id=service_row.winning_payment_attempt_id;
  select * into legacy_order from public.orders where id=service_row.legacy_order_id;
  select coalesce(max(version),0)+1 into next_revision from public.ap_intake_snapshots
    where draft_id=parent_row.draft_id;
  insert into public.ap_intake_snapshots(
    id,draft_id,intake_id,customer_id,parent_snapshot_id,version,snapshot_kind,access_email_normalized,
    payer_receipt_email,document_contact_email,desired_activities,avoided_activities,optional_titles,
    confirmed_title_restriction,optional_industries,blocked_industries,search_breadth,guidance_requested,
    work_modes,preferred_work_mode,us_state_or_dc,employment_types,preferred_employment_type,schedules,
    travel,benefits,work_condition_preferences,dealbreakers,currency,salary_target_cents,
    salary_hard_minimum_cents,salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,
    salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,
    prior_cover_letter_use,targeted_authorization_answers,sensitive_payload_id,content_sha256,
    canonicalization_version,schema_version,finalized_at
  ) select
    p_child_snapshot_id,parent_row.draft_id,legacy_order.intake_id,p_customer_id,
    parent_row.id,next_revision,'SEARCH_ADJUSTMENT',parent_row.access_email_normalized,parent_row.payer_receipt_email,
    parent_row.document_contact_email,
    case when patch?'desiredActivities' then patch->'desiredActivities' else parent_row.desired_activities end,
    case when patch?'avoidedActivities' then patch->'avoidedActivities' else parent_row.avoided_activities end,
    case when patch?'optionalTitles' then patch->'optionalTitles' else parent_row.optional_titles end,
    case when patch?'confirmedTitleRestriction' then
      case when patch->'confirmedTitleRestriction'='null'::jsonb then null else patch->'confirmedTitleRestriction' end
      else parent_row.confirmed_title_restriction end,
    case when patch?'optionalIndustries' then patch->'optionalIndustries' else parent_row.optional_industries end,
    case when patch?'blockedIndustries' then patch->'blockedIndustries' else parent_row.blocked_industries end,
    case when patch?'searchBreadth' then patch->>'searchBreadth' else parent_row.search_breadth end,
    parent_row.guidance_requested,
    case when patch?'workModes' then patch->'workModes' else parent_row.work_modes end,
    case when patch?'preferredWorkMode' then nullif(patch->>'preferredWorkMode','') else parent_row.preferred_work_mode end,
    case when patch?'stateOrDc' then nullif(patch->>'stateOrDc','') else parent_row.us_state_or_dc end,
    case when patch?'employmentTypes' then patch->'employmentTypes' else parent_row.employment_types end,
    case when patch?'preferredEmploymentType' then nullif(patch->>'preferredEmploymentType','') else parent_row.preferred_employment_type end,
    case when patch?'schedules' then patch->'schedules' else parent_row.schedules end,
    case when patch?'travel' then patch->'travel' else parent_row.travel end,
    case when patch?'benefits' then patch->'benefits' else parent_row.benefits end,
    case when patch?'workConditionPreferences' then patch->'workConditionPreferences' else parent_row.work_condition_preferences end,
    case when patch?'dealbreakers' then patch->'dealbreakers' else parent_row.dealbreakers end,
    'USD',
    case when patch?'salaryTargetCents' then nullif(patch->>'salaryTargetCents','')::integer else parent_row.salary_target_cents end,
    case when patch?'salaryHardMinimumCents' then nullif(patch->>'salaryHardMinimumCents','')::integer else parent_row.salary_hard_minimum_cents end,
    case when patch?'salaryMinimumFlexible' then (patch->>'salaryMinimumFlexible')::boolean else parent_row.salary_minimum_flexible end,
    case when patch?'salaryPeriod' then nullif(patch->>'salaryPeriod','') else parent_row.salary_period end,
    case when patch?'salaryBasis' then nullif(patch->>'salaryBasis','') else parent_row.salary_basis end,
    case when patch?'salaryOverlapPolicy' then patch->>'salaryOverlapPolicy' else parent_row.salary_overlap_policy end,
    case when patch?'salaryUnpublishedPolicy' then patch->>'salaryUnpublishedPolicy' else parent_row.salary_unpublished_policy end,
    case when patch?'salaryNoncomparablePolicy' then patch->>'salaryNoncomparablePolicy' else parent_row.salary_noncomparable_policy end,
    case when patch?'salaryVariablePayPolicy' then patch->>'salaryVariablePayPolicy' else parent_row.salary_variable_pay_policy end,
    case when patch?'employerUnknownPolicies' then patch->'employerUnknownPolicies' else parent_row.employer_unknown_policy end,
    parent_row.prior_cover_letter_use,parent_row.targeted_authorization_answers,parent_row.sensitive_payload_id,
    p_child_content_sha256,parent_row.canonicalization_version,parent_row.schema_version,accepted_at_value;
  update public.ap_capacity_allocations set criteria_revision_id=p_child_snapshot_id,customer_id=p_customer_id,
    order_id=service_row.legacy_order_id,lifecycle='CONSUMED',debit_disposition='SPENT',
    consumed_at=capacity_confirmed_at_value,expires_at=null,updated_at=capacity_confirmed_at_value
    where id=revised_allocation_id;
  insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
  values(revised_allocation_id,'RESERVED','CONSUMED','HELD','SPENT','ADJUSTMENT_CAPACITY_CONFIRMED');
  select * into prior_allocation from public.ap_capacity_allocations where id=service_row.capacity_allocation_id for update;
  if prior_allocation.debit_disposition='SPENT' then
    update public.ap_capacity_allocations set lifecycle='SUPERSEDED',updated_at=capacity_confirmed_at_value
      where id=prior_allocation.id;
    insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
    values(prior_allocation.id,prior_allocation.lifecycle,'SUPERSEDED','SPENT','SPENT','ADJUSTMENT_ACCEPTED');
  elsif prior_allocation.debit_disposition='HELD' then
    update public.ap_capacity_allocations set lifecycle='SUPERSEDED',debit_disposition='RETURNED',
      returned_at=capacity_confirmed_at_value,updated_at=capacity_confirmed_at_value where id=prior_allocation.id;
    insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
    values(prior_allocation.id,prior_allocation.lifecycle,'SUPERSEDED','HELD','RETURNED','ADJUSTMENT_ACCEPTED');
  end if;
  insert into public.ap_candidate_facts(
    draft_id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,
    customer_assertion_snapshot_id,assertion_control_id,supplied_source_id,source_locator,human_reviewer_id,
    extraction_confidence,verification,confirmed_or_corrected_at,catalog_version,schema_version,starts_on,
    ends_on,calendar_duration_days,intensity_percent,capability_status,supersedes_fact_id,fact_tier,
    customer_display_label,customer_display_value
  ) select
    fact.draft_id,p_customer_id,p_child_snapshot_id,fact.semantic_key,fact.value_kind,fact.typed_value,
    fact.source_kind,fact.document_version_id,
    case when fact.source_kind='CUSTOMER_ASSERTION' then p_child_snapshot_id else null end,
    fact.assertion_control_id,fact.supplied_source_id,fact.source_locator,fact.human_reviewer_id,
    fact.extraction_confidence,fact.verification,fact.confirmed_or_corrected_at,fact.catalog_version,
    fact.schema_version,fact.starts_on,fact.ends_on,fact.calendar_duration_days,fact.intensity_percent,
    fact.capability_status,fact.id,fact.fact_tier,fact.customer_display_label,fact.customer_display_value
  from public.ap_candidate_facts fact
  where fact.snapshot_id=parent_row.id and fact.superseded_at is null;
  update public.ap_match_evaluations set invalidated_at=accepted_at_value
    where snapshot_id=parent_row.id and invalidated_at is null;
  update public.ap_human_review_records set invalidated_at=accepted_at_value
    where snapshot_id=parent_row.id and invalidated_at is null;
  update public.ap_job_release_reviews set invalidated_at=accepted_at_value
    where search_service_id=service_row.id and invalidated_at is null;
  update public.ap_search_package_reviews set invalidated_at=accepted_at_value
    where search_service_id=service_row.id and invalidated_at is null;
  revision_started_at_value:=greatest(accepted_at_value,capacity_confirmed_at_value,payment_row.payment_verified_at);
  revision_due_at_value:=revision_started_at_value+interval '24 hours';
  update public.ap_criteria_amendments set state='ACCEPTED',child_snapshot_id=p_child_snapshot_id,
    accepted_at=accepted_at_value,accepted_by=p_customer_id,acceptance_idempotency_key=p_acceptance_idempotency_key,
    accepted_snapshot_content_sha256=p_child_content_sha256,revised_capacity_allocation_id=revised_allocation_id,
    revision_started_at=revision_started_at_value,revision_due_at=revision_due_at_value
    where id=amendment_row.id;
  update public.ap_search_services set active_snapshot_id=p_child_snapshot_id,
    capacity_allocation_id=revised_allocation_id,adjustment='ACCEPTED',fulfillment='RESEARCHING',
    capacity_confirmed_at=capacity_confirmed_at_value,service_started_at=revision_started_at_value,
    delivery_due_at=revision_due_at_value,active_deadline_revision=active_deadline_revision+1,updated_at=accepted_at_value
    where id=service_row.id;
  insert into public.ap_search_deadline_history(
    search_service_id,revision,reason,started_at,due_at,capacity_allocation_id,criteria_snapshot_id
  ) values(
    service_row.id,service_row.active_deadline_revision+1,'ADJUSTMENT_ACCEPTED',
    revision_started_at_value,revision_due_at_value,revised_allocation_id,p_child_snapshot_id
  );
  insert into public.ap_outbox_messages(
    id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at
  ) values(
    p_outbox_id,p_customer_id,service_row.legacy_order_id,'ADJUSTMENT_ACCEPTED',amendment_row.id::text,
    'adjustment-accepted:'||amendment_row.id::text,p_outbox_id::text,'QUEUED',accepted_at_value
  );
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('SEARCH_DEADLINE',service_row.id,'search-deadline:'||service_row.id::text||':'||
    (service_row.active_deadline_revision+1)::text,revision_due_at_value+interval '1 microsecond'),
    ('OUTBOX_SEND',p_outbox_id,'outbox-send:'||p_outbox_id::text,accepted_at_value)
  on conflict(idempotency_key) do nothing;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,p_customer_id,'ADJUSTMENT_ACCEPTED','CRITERIA_AMENDMENT',amendment_row.id,
    jsonb_build_object('priorSnapshotId',parent_row.id,'childSnapshotId',p_child_snapshot_id,
      'revisedAllocationId',revised_allocation_id,'dueAt',revision_due_at_value),'chunk4-v1');
  return jsonb_build_object('outcome','ACCEPTED','snapshotId',p_child_snapshot_id,
    'deliveryDueAt',revision_due_at_value,'replayed',false);
end;
$$;

create or replace function public.ap_decline_search_adjustment(
  p_amendment_id uuid,p_customer_id uuid,p_idempotency_key text,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare amendment_row public.ap_criteria_amendments; service_row public.ap_search_services;
  refund_id uuid; now_at timestamptz:=clock_timestamp();
begin
  if nullif(btrim(p_idempotency_key),'') is null then raise exception 'invalid_adjustment_decline'; end if;
  select * into amendment_row from public.ap_criteria_amendments where id=p_amendment_id for update;
  if not found then raise exception 'adjustment_not_found'; end if;
  select * into service_row from public.ap_search_services where id=amendment_row.search_service_id for update;
  if service_row.customer_id<>p_customer_id then raise exception 'adjustment_access_denied'; end if;
  if amendment_row.decline_idempotency_key=p_idempotency_key and amendment_row.state in ('DECLINED','EXPIRED') then
    select id into refund_id from public.ap_refund_operations
      where payment_attempt_id=service_row.winning_payment_attempt_id and scope='FULL_SEARCH' and superseded_at is null;
    return jsonb_build_object('outcome','REFUND_PROCESSING','refundId',refund_id,'replayed',true);
  end if;
  if amendment_row.state<>'PROPOSED' or service_row.refund_started_at is not null
    or exists(select 1 from public.ap_releases where order_id=service_row.legacy_order_id and release_kind='SEARCH_EXACT_TEN')
    then raise exception 'adjustment_not_declineable'; end if;
  update public.ap_criteria_amendments set state='DECLINED',declined_at=now_at,
    decline_reason=coalesce(nullif(btrim(p_reason),''),'CUSTOMER_DECLINED'),
    decline_idempotency_key=p_idempotency_key where id=amendment_row.id;
  refund_id:=public.ap_start_search_service_refund(service_row.id,'ADJUSTMENT_DECLINED',false);
  return jsonb_build_object('outcome','REFUND_PROCESSING','refundId',refund_id,'replayed',false);
end;
$$;

create or replace function public.ap_retry_search_refund(
  p_refund_id uuid,p_requested_by uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare refund_row public.ap_refund_operations; command_id uuid:=gen_random_uuid();
  command_key text; input_hash text; now_at timestamptz:=clock_timestamp(); next_retry integer;
begin
  if not exists(select 1 from public.profiles where id=p_requested_by and role in ('operator','admin'))
    then raise exception 'authorized_refund_retry_required'; end if;
  select * into refund_row from public.ap_refund_operations where id=p_refund_id for update;
  if not found or refund_row.state<>'FAILED' or refund_row.superseded_at is not null
    then raise exception 'failed_refund_required'; end if;
  next_retry:=refund_row.retry_count+1;
  command_key:='stripe:refund:'||refund_row.id::text||':retry:'||next_retry::text;
  input_hash:=encode(extensions.digest(convert_to(command_key||':'||refund_row.amount_cents::text,'UTF8'),'sha256'),'hex');
  insert into public.ap_external_commands(
    id,customer_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,
    state,lease_expires_at,reconciliation_state
  ) values(
    command_id,refund_row.customer_id,
    case when refund_row.scope='MATERIAL_LINE' then 'CREATE_MATERIAL_LINE_REFUND' else 'CREATE_SEARCH_REFUND' end,
    'stripe',input_hash,command_key,
    'CREATING',now_at+interval '5 minutes','REQUIRED'
  );
  update public.ap_refund_operations set state='PENDING',provider_command_id=command_id,
    provider_refund_id=null,provider_event_id=null,retry_count=next_retry,last_error_code=null
    where id=refund_row.id;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
  values('REFUND_SUBMIT',refund_row.id,'refund-submit:'||refund_row.id::text||':retry:'||next_retry::text,now_at);
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(refund_row.customer_id,p_requested_by,'REFUND_RETRY_QUEUED','REFUND_OPERATION',refund_row.id,
    jsonb_build_object('retryCount',next_retry),'chunk4-v1');
  return jsonb_build_object('refundId',refund_row.id,'state','PENDING','retryCount',next_retry);
end;
$$;

create or replace function public.ap_apply_search_dispute(
  p_provider_event_id text,p_payload_sha256 text,p_signature_verified_at timestamptz,
  p_payment_intent_id text,p_dispute_state text,p_outbox_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare payment_row public.ap_payment_attempts; service_row public.ap_search_services;
  allocation_row public.ap_capacity_allocations; material_line public.ap_material_lines;
  now_at timestamptz:=clock_timestamp(); result_value jsonb; refund_id uuid;
  search_release_exists boolean:=false; material_line_release_exists boolean;
  allocation_has_delivery boolean; material_delivered_count integer:=0;
  material_canceled_count integer:=0; material_refund_ids jsonb:='[]'::jsonb;
  notification_order_id uuid; entitlement_state_id uuid;
begin
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' or p_signature_verified_at is null
    or p_dispute_state not in ('OPEN','WON','LOST')
    then raise exception 'invalid_dispute_event'; end if;
  insert into public.ap_provider_events(provider,provider_event_id,event_type,payload_sha256,signature_verified_at)
  values('stripe',p_provider_event_id,'charge.dispute.'||lower(p_dispute_state),p_payload_sha256,p_signature_verified_at)
  on conflict(provider_event_id) do nothing;
  if not found then
    select result into result_value from public.ap_provider_events
      where provider_event_id=p_provider_event_id and payload_sha256=p_payload_sha256;
    if result_value is null then raise exception 'provider_event_identity_conflict'; end if;
    return result_value||jsonb_build_object('replayed',true);
  end if;
  select * into payment_row from public.ap_payment_attempts
    where provider_payment_id=p_payment_intent_id and settlement='PAID' for update;
  if not found then raise exception 'disputed_payment_not_found'; end if;
  if payment_row.dispute in ('WON','LOST') and payment_row.dispute::text<>p_dispute_state then
    raise exception 'dispute_state_regression';
  end if;
  if p_dispute_state='OPEN' and payment_row.dispute in ('WON','LOST') then
    raise exception 'dispute_state_regression';
  end if;
  if p_dispute_state in ('WON','LOST') and payment_row.dispute='NONE' then
    raise exception 'dispute_open_event_required';
  end if;
  select * into service_row from public.ap_search_services
    where winning_payment_attempt_id=payment_row.id for update;
  if service_row.id is not null then
    notification_order_id:=service_row.legacy_order_id;
    select exists(select 1 from public.ap_releases
      where order_id=service_row.legacy_order_id and release_kind='SEARCH_EXACT_TEN') into search_release_exists;
  else
    select delivered_order_id into notification_order_id from public.ap_material_lines
      where payment_attempt_id=payment_row.id order by id limit 1;
  end if;
  select count(*) into material_delivered_count from public.ap_material_lines line
    where line.payment_attempt_id=payment_row.id and exists(
      select 1 from public.ap_releases release
      where release.material_line_id=line.id and release.release_kind in ('MATERIAL_PAIR','MATERIAL_TRIPLE'));
  if p_dispute_state='OPEN' then
    update public.ap_payment_attempts set dispute='OPEN',dispute_opened_at=coalesce(dispute_opened_at,now_at),
      updated_at=now_at where id=payment_row.id and dispute in ('NONE','OPEN');
    if service_row.id is not null and not search_release_exists and service_row.refund_started_at is null then
      update public.ap_search_services set fulfillment='CANCELED',canceled_at=coalesce(canceled_at,now_at),
        updated_at=now_at where id=service_row.id;
      update public.orders set status='cancelled',updated_at=now_at where id=service_row.legacy_order_id;
      select * into allocation_row from public.ap_capacity_allocations
        where id=service_row.capacity_allocation_id for update;
      if allocation_row.debit_disposition='SPENT' and allocation_row.lifecycle not in ('SUPERSEDED','COMPLETED') then
        update public.ap_capacity_allocations set lifecycle='SUPERSEDED',updated_at=now_at
          where id=allocation_row.id;
        insert into public.ap_capacity_audit(
          allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code
        ) values(allocation_row.id,allocation_row.lifecycle,'SUPERSEDED','SPENT','SPENT','DISPUTE_OPEN');
      elsif allocation_row.debit_disposition='HELD' and allocation_row.lifecycle='RESERVED' then
        update public.ap_capacity_allocations set lifecycle='RELEASED',debit_disposition='RETURNED',
          returned_at=now_at,updated_at=now_at where id=allocation_row.id;
        insert into public.ap_capacity_audit(
          allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code
        ) values(allocation_row.id,allocation_row.lifecycle,'RELEASED','HELD','RETURNED','DISPUTE_OPEN');
      end if;
    end if;
    for material_line in select * from public.ap_material_lines
      where payment_attempt_id=payment_row.id order by id for update loop
      select exists(select 1 from public.ap_releases release
        where release.material_line_id=material_line.id
          and release.release_kind in ('MATERIAL_PAIR','MATERIAL_TRIPLE')) into material_line_release_exists;
      if not material_line_release_exists then
        update public.ap_material_lines set fulfillment='CANCELED'
          where id=material_line.id and fulfillment<>'DELIVERED';
        entitlement_state_id:=public.ap_append_material_entitlement_state(material_line.id,'DISPUTED');
        material_canceled_count:=material_canceled_count+1;
      end if;
    end loop;
    for allocation_row in select allocation.* from public.ap_capacity_allocations allocation
      where allocation.material_line_id in (select id from public.ap_material_lines where payment_attempt_id=payment_row.id)
        or exists(select 1 from public.ap_capacity_allocation_members member
          join public.ap_material_lines line on line.id=member.material_line_id
          where member.allocation_id=allocation.id and line.payment_attempt_id=payment_row.id)
      order by allocation.id for update loop
      select exists(select 1 from public.ap_releases release
        where release.material_line_id is not null
          and (release.material_line_id=allocation_row.material_line_id or exists(
            select 1 from public.ap_capacity_allocation_members member
            where member.allocation_id=allocation_row.id and member.material_line_id=release.material_line_id)))
        into allocation_has_delivery;
      if allocation_row.debit_disposition='HELD' and allocation_row.lifecycle='RESERVED' and not allocation_has_delivery then
        update public.ap_capacity_allocations set lifecycle='RELEASED',debit_disposition='RETURNED',
          returned_at=now_at,updated_at=now_at where id=allocation_row.id;
        insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
        values(allocation_row.id,allocation_row.lifecycle,'RELEASED','HELD','RETURNED','MATERIAL_DISPUTE_OPEN');
      elsif allocation_row.debit_disposition='SPENT' and not allocation_has_delivery
        and allocation_row.lifecycle<>'SUPERSEDED' then
        update public.ap_capacity_allocations set lifecycle='SUPERSEDED',updated_at=now_at
          where id=allocation_row.id;
        insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,reason_code)
        values(allocation_row.id,allocation_row.lifecycle,'SUPERSEDED','SPENT','SPENT','MATERIAL_DISPUTE_OPEN');
      end if;
    end loop;
  elsif p_dispute_state='LOST' then
    update public.ap_payment_attempts set dispute='LOST',dispute_resolved_at=now_at,
      funds_reversed_at=coalesce(funds_reversed_at,now_at),updated_at=now_at
      where id=payment_row.id and dispute in ('OPEN','LOST');
  else
    update public.ap_payment_attempts set dispute='WON',dispute_resolved_at=now_at,
      funds_secured_at=coalesce(funds_secured_at,now_at),updated_at=now_at
      where id=payment_row.id and dispute in ('OPEN','WON');
    if service_row.id is not null and not search_release_exists then
      refund_id:=public.ap_start_search_service_refund(service_row.id,'DISPUTE_WON_UNDELIVERED',false);
    end if;
    for material_line in select * from public.ap_material_lines
      where payment_attempt_id=payment_row.id and fulfillment='CANCELED' order by id for update loop
      if not exists(select 1 from public.ap_releases release
        where release.material_line_id=material_line.id
          and release.release_kind in ('MATERIAL_PAIR','MATERIAL_TRIPLE')) then
        refund_id:=public.ap_queue_material_line_refund(payment_row.id,payment_row.customer_id,
          material_line.id,'DISPUTE_WON_UNDELIVERED');
        entitlement_state_id:=public.ap_append_material_entitlement_state(material_line.id,'REFUND_PENDING');
        material_refund_ids:=material_refund_ids||jsonb_build_array(refund_id);
      end if;
    end loop;
  end if;
  insert into public.ap_operational_alerts(alert_key,category,severity,reference_id,non_sensitive_details)
  values('payment-dispute:'||payment_row.id::text||':'||p_dispute_state,'REFUND',
    case when p_dispute_state='OPEN' then 'CRITICAL' else 'WARNING' end,payment_row.id,
    jsonb_build_object('state',p_dispute_state,'searchReleaseCommitted',search_release_exists,
      'materialDeliveredCount',material_delivered_count,'materialCanceledCount',material_canceled_count))
  on conflict(alert_key) do nothing;
  insert into public.ap_outbox_messages(
    id,customer_id,order_id,message_kind,recipient_ref,deduplication_key,
    provider_idempotency_key,state,next_attempt_at
  ) select p_outbox_id,payment_row.customer_id,notification_order_id,'PAYMENT_DISPUTE_'||p_dispute_state,
    payment_row.id::text,'payment-dispute:'||payment_row.id::text||':'||p_dispute_state,
    p_outbox_id::text,'QUEUED',now_at where notification_order_id is not null
  on conflict(deduplication_key) do nothing;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(payment_row.customer_id,'PAYMENT_DISPUTE_'||p_dispute_state,'PAYMENT_ATTEMPT',payment_row.id,
    jsonb_build_object('searchReleaseCommitted',search_release_exists,'refundId',refund_id,
      'materialRefundIds',material_refund_ids,'materialDeliveredCount',material_delivered_count,
      'materialCanceledCount',material_canceled_count),'chunk4-v1');
  result_value:=jsonb_build_object('paymentAttemptId',payment_row.id,'state',p_dispute_state,
    'searchReleaseCommitted',search_release_exists,'refundId',refund_id,
    'materialRefundIds',material_refund_ids,'materialDeliveredCount',material_delivered_count,
    'materialCanceledCount',material_canceled_count,'replayed',false);
  update public.ap_provider_events set applied_at=now_at,result=result_value
    where provider_event_id=p_provider_event_id;
  return result_value;
end;
$$;

create or replace function public.ap_claim_scheduled_jobs(p_owner text,p_limit integer default 10)
returns setof public.ap_scheduled_jobs language plpgsql security definer set search_path = '' as $$
begin
  if length(btrim(p_owner))<3 or p_limit not between 1 and 50 then raise exception 'invalid_job_claim'; end if;
  return query with candidates as (
    select id from public.ap_scheduled_jobs
    where run_at<=clock_timestamp()
      and (state in ('QUEUED','RETRY') or (state='LEASED' and lease_expires_at<=clock_timestamp()))
    order by run_at,id for update skip locked limit p_limit
  ) update public.ap_scheduled_jobs job set state='LEASED',lease_owner=p_owner,
    lease_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1,updated_at=clock_timestamp()
    from candidates where job.id=candidates.id returning job.*;
end;
$$;

create or replace view public.ap_staff_queue as
select case
    when service.refund_started_at is not null then 'REFUND'
    when service.delivery_due_at<clock_timestamp() and service.fulfillment<>'DELIVERED' then 'LATENESS'
    when service.adjustment='PROPOSED' then 'ADJUSTMENT'
    when service.fulfillment='READY_TO_RELEASE' then 'RELEASE'
    when service.fulfillment='HUMAN_REVIEW' and exists(
      select 1 from public.ap_job_release_reviews review
      where review.search_service_id=service.id and review.invalidated_at is null
    ) then 'PACKAGE_REVIEW'
    when service.fulfillment='HUMAN_REVIEW' then 'JOB_REVIEW'
    else 'RESEARCHING' end as queue_kind,
  service.id as subject_id,service.customer_id,service.legacy_order_id as order_id,
  service.delivery_due_at as due_at,service.fulfillment::text as state,
  jsonb_build_object('activeSnapshotId',service.active_snapshot_id,
    'deadlineRevision',service.active_deadline_revision,'adjustment',service.adjustment::text) as non_sensitive_metadata
from public.ap_search_services service
where service.fulfillment<>'DELIVERED'
union all
select 'PARSER_CORRECTION',job.id,null::uuid,null::uuid,null::timestamptz,'REQUIRED',
  jsonb_build_object('requirementCompleteness',job.requirement_completeness)
from public.ap_job_snapshots job
where not job.legacy_compatibility and job.requirement_completeness<100
union all
select 'EVIDENCE_QUESTION',review.id,review.customer_id,null::uuid,null::timestamptz,
  review.decision->>'disposition',jsonb_build_object('reviewKind',review.review_kind,
    'snapshotId',review.snapshot_id,'jobSnapshotId',review.job_snapshot_id)
from public.ap_human_review_records review
where review.invalidated_at is null and review.decision->>'disposition'='REQUIRES_MORE_EVIDENCE'
union all
select 'EMAIL_FAILURE',message.id,message.customer_id,message.order_id,
  message.next_attempt_at,message.state::text,
  jsonb_build_object('messageKind',message.message_kind,'attempts',message.attempts,
    'lastErrorCode',message.last_error_code)
from public.ap_outbox_messages message where message.state in ('RETRY','DEAD_LETTER');

alter table public.ap_snapshot_legal_acceptances enable row level security;
alter table public.ap_order_access_capabilities enable row level security;
alter table public.ap_search_deadline_history enable row level security;
alter table public.ap_job_release_reviews enable row level security;
alter table public.ap_search_package_reviews enable row level security;
alter table public.ap_operational_alerts enable row level security;

revoke all on public.ap_snapshot_legal_acceptances,public.ap_order_access_capabilities,
  public.ap_search_deadline_history,public.ap_job_release_reviews,public.ap_search_package_reviews,
  public.ap_operational_alerts from public,anon,authenticated;
grant all privileges on public.ap_snapshot_legal_acceptances,public.ap_order_access_capabilities,
  public.ap_search_deadline_history,public.ap_job_release_reviews,public.ap_search_package_reviews,
  public.ap_operational_alerts to service_role;

grant select on public.ap_search_deadline_history,public.ap_criteria_amendments to authenticated;
create policy ap_search_deadline_history_owner_select on public.ap_search_deadline_history
  for select to authenticated using(exists(
    select 1 from public.ap_search_services service
    where service.id=search_service_id and public.ap_can_access_customer(service.customer_id)
  ));
create policy ap_criteria_amendments_owner_select on public.ap_criteria_amendments
  for select to authenticated using(exists(
    select 1 from public.ap_search_services service
    where service.id=search_service_id and public.ap_can_access_customer(service.customer_id)
  ));

revoke all on public.ap_staff_queue from public,anon,authenticated;
grant select on public.ap_staff_queue to service_role;

do $$ declare signature regprocedure; begin
  foreach signature in array array[
    'public.ap_record_snapshot_legal_acceptance(uuid,text,uuid,text,text,text)'::regprocedure,
    'public.ap_begin_search_checkout(uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)'::regprocedure,
    'public.ap_promote_search_checkout(uuid,text,timestamptz)'::regprocedure,
    'public.ap_reopen_provisional_search_checkout(uuid)'::regprocedure,
    'public.ap_compensate_search_checkout(uuid,text,text)'::regprocedure,
    'public.ap_expire_search_checkout(uuid,text)'::regprocedure,
    'public.ap_cancel_search_checkout(uuid,text)'::regprocedure,
    'public.ap_begin_pre_activation_edit(uuid,text)'::regprocedure,
    'public.ap_queue_search_refund(uuid,uuid,public.ap_refund_scope,text)'::regprocedure,
    'public.ap_queue_material_line_refund(uuid,uuid,uuid,text)'::regprocedure,
    'public.ap_apply_verified_search_payment(text,text,text,timestamptz,timestamptz,text,text,text,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)'::regprocedure,
    'public.ap_read_current_feasibility(uuid,text)'::regprocedure,
    'public.ap_find_customer_by_access_email(text)'::regprocedure,
    'public.ap_find_latest_access_order(text)'::regprocedure,
    'public.ap_read_checkout_status(uuid,text)'::regprocedure,
    'public.ap_consume_order_access(uuid,text)'::regprocedure,
    'public.ap_claim_outbox_messages(text,integer)'::regprocedure,
    'public.ap_renew_outbox_lease(uuid,text)'::regprocedure,
    'public.ap_append_material_entitlement_state(uuid,text)'::regprocedure,
    'public.ap_record_search_refund_result(uuid,text,text,text,text,text,timestamptz,text)'::regprocedure,
    'public.ap_start_search_service_refund(uuid,text,boolean)'::regprocedure,
    'public.ap_enqueue_chunk4_due_jobs()'::regprocedure,
    'public.ap_apply_local_scheduled_job(uuid,text)'::regprocedure,
    'public.ap_retry_scheduled_job(uuid,text,text,timestamptz,boolean)'::regprocedure,
    'public.ap_complete_external_scheduled_job(uuid,text)'::regprocedure,
    'public.ap_renew_scheduled_job_lease(uuid,text)'::regprocedure,
    'public.ap_chunk4_monitor_snapshot()'::regprocedure,
    'public.ap_propose_search_adjustment(uuid,uuid,integer,text[],jsonb,jsonb,jsonb,timestamptz,integer,text,uuid)'::regprocedure,
    'public.ap_complete_outbox_message(uuid,text,text)'::regprocedure,
    'public.ap_fail_outbox_message(uuid,text,text,timestamptz,boolean)'::regprocedure,
    'public.ap_align_access_capability_to_outbox(uuid,text,text)'::regprocedure,
    'public.ap_issue_order_access_capability(uuid,text,uuid,uuid,uuid)'::regprocedure,
    'public.ap_record_job_release_review(uuid,uuid,uuid,public.ap_staff_review_decision,text)'::regprocedure,
    'public.ap_commit_exact_ten_release(uuid,uuid,uuid,jsonb,jsonb,text,uuid,uuid)'::regprocedure,
    'public.ap_accept_search_adjustment(uuid,uuid,uuid,text,text,text,uuid)'::regprocedure,
    'public.ap_decline_search_adjustment(uuid,uuid,text,text)'::regprocedure,
    'public.ap_retry_search_refund(uuid,uuid)'::regprocedure,
    'public.ap_apply_search_dispute(text,text,timestamptz,text,text,uuid)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',signature);
    execute format('grant execute on function %s to service_role',signature);
  end loop;
end $$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202609060030','CHUNK4_COMMERCE_RELEASE_V1',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
  set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;
